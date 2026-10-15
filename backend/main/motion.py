"""Padrões de movimento: o modelo que roda no ESP32.

O veterinário marca no portal trechos do acelerômetro (padrão, intervalo e
eixos). Para cada padrão sai um detector "é isto / não é": uma floresta de
árvores de decisão pequenas, treinada aqui em Python puro e mandada ao ESP32
como /modelo.bin. O ESP32 calcula as mesmas características sobre os últimos
segundos do acelerômetro e percorre as árvores: só comparações, sem TensorFlow.

As características não dependem da calibração do sensor: cada eixo perde a
própria média na janela (desvio de zero) e o módulo é dividido pela média
dele (erro de escala). O cálculo tem que bater com features() do firmware;
mudou aqui, sobe FEAT_VER e muda lá.
"""

import math
import random
import struct
from statistics import median

FEAT_VER = 1
HZ = 50  # accel_hz padrão do sensor; o modelo vale só para ele
AXES = 'xyz'
PER_AXIS = 6  # std, mín, máx, amplitude, variação média, cruzamentos por zero
N_FEATURES = 3 * PER_AXIS + 4  # + módulo: std, mín, máx, variação média
WIN_MIN_S, WIN_MAX_S = 1.0, 8.0
THRESHOLD = 0.5
TREES, DEPTH, MIN_LEAF = 15, 4, 2
MAX_NEG = 3000  # janelas negativas por padrão (sorteadas)
NEG_MARGIN_MS = 2 * 3600 * 1000  # negativos: até 2 h antes/depois das marcações

MAGIC = b'CVM1'
HEADER = struct.Struct('<4sIBHB')  # magic, versão, FEAT_VER, Hz, nº de padrões
# código, eixos, janela, limiar, N, M (min), árvores, nome (para a página ao vivo)
PATTERN = struct.Struct('<BBHfBHB16s')
NODE = struct.Struct('<bfBB')  # característica (-1 = folha), limiar/valor, esq., dir.


# --- características ---------------------------------------------------------
def features(xs, ys, zs, hz=HZ):
    """22 números de uma janela (listas em g, mesmo tamanho)."""
    n = len(xs)
    out = []
    for a in (xs, ys, zs):
        m = sum(a) / n
        d = [v - m for v in a]
        out += [
            math.sqrt(sum(v * v for v in d) / n),
            min(d),
            max(d),
            max(d) - min(d),
            sum(abs(d[i] - d[i - 1]) for i in range(1, n)) / (n - 1) * hz,
            sum((d[i - 1] < 0) != (d[i] < 0) for i in range(1, n)) * hz / n,
        ]
    mag = [math.sqrt(x * x + y * y + z * z) for x, y, z in zip(xs, ys, zs)]
    mm = sum(mag) / n
    r = [v / mm for v in mag] if mm > 0.05 else [1.0] * n  # noqa: PLR2004
    rm = sum(r) / n
    out += [
        math.sqrt(sum((v - rm) ** 2 for v in r) / n),
        min(r),
        max(r),
        sum(abs(r[i] - r[i - 1]) for i in range(1, n)) / (n - 1) * hz,
    ]
    return out


def allowed(axes):
    """Índices das características que um padrão com estes eixos pode usar."""
    idx = [AXES.index(a) * PER_AXIS + k for a in axes for k in range(PER_AXIS)]
    return sorted(idx) + list(range(3 * PER_AXIS, N_FEATURES))


# --- leituras contínuas ------------------------------------------------------
def segments(blocks, decode):
    """Blocos 'A' emendados em trechos contínuos: [(t0_ms, x, y, z)] em g.

    `decode` é sensor.decode. Trecho com taxa longe de HZ fica de fora (o
    modelo só vale para uma taxa).
    """
    out, cur = [], None
    for b in sorted(blocks, key=lambda b: b.ts_ms):
        if not b.n or abs(b.n * 1000 / b.dur_ms - HZ) > HZ * 0.1:
            cur = None
            continue
        v = decode(b)
        k = b.scale
        xs = [v[i] * k for i in range(0, len(v), b.ch)]
        ys = [v[i + 1] * k for i in range(0, len(v), b.ch)]
        zs = [v[i + 2] * k for i in range(0, len(v), b.ch)]
        end = cur[0] + len(cur[1]) * 1000 / HZ if cur else None
        if cur and abs(b.ts_ms - end) < 2000 / HZ:
            cur[1].extend(xs)
            cur[2].extend(ys)
            cur[3].extend(zs)
        else:
            cur = (b.ts_ms, xs, ys, zs)
            out.append(cur)
    return out


def windows(segs, win, from_ms, to_ms, step):
    """Janelas de `win` leituras dentro de [from_ms, to_ms): (t_ms, características)."""
    for t0, xs, ys, zs in segs:
        first = max(0, math.ceil((from_ms - t0) * HZ / 1000))
        last = min(len(xs), int((to_ms - t0) * HZ / 1000)) - win
        for i in range(first, last + 1, step):
            j = i + win
            yield t0 + i * 1000 / HZ, features(xs[i:j], ys[i:j], zs[i:j])


# --- floresta ----------------------------------------------------------------
def f32(v):
    """Arredonda como o float do ESP32: o corte fica igual dos dois lados."""
    return struct.unpack('<f', struct.pack('<f', v))[0]


def _gini(pos, n):
    p = pos / n
    return 2 * p * (1 - p)


def _tree(X, y, feats, rng, depth):
    """Árvore como lista de nós [feat, valor, esq, dir]; raiz no índice 0."""
    nodes = []

    def grow(idx, d):
        pos = sum(y[i] for i in idx)
        me = len(nodes)
        nodes.append([-1, pos / len(idx), 0, 0])
        if d >= depth or pos in (0, len(idx)) or len(idx) < 2 * MIN_LEAF:
            return me
        best = None
        n = len(idx)
        k = max(1, round(math.sqrt(len(feats))))
        for f in rng.sample(feats, min(k, len(feats))):
            order = sorted(idx, key=lambda i: X[i][f])
            lp = 0
            for j in range(n - 1):
                lp += y[order[j]]
                a, b = X[order[j]][f], X[order[j + 1]][f]
                nl = j + 1
                if a == b or nl < MIN_LEAF or n - nl < MIN_LEAF:
                    continue
                score = nl * _gini(lp, nl) + (n - nl) * _gini(pos - lp, n - nl)
                if best is None or score < best[0]:
                    best = (score, f, f32((a + b) / 2))
        if best is None or best[0] >= n * _gini(pos, n) - 1e-12:
            return me
        _, f, t = best
        left = [i for i in idx if X[i][f] <= t]
        right = [i for i in idx if X[i][f] > t]
        nodes[me][0], nodes[me][1] = f, t
        nodes[me][2] = grow(left, d + 1)
        nodes[me][3] = grow(right, d + 1)
        return me

    grow(list(range(len(X))), 0)
    return nodes


def forest(X, y, feats, seed=0):
    rng = random.Random(seed)
    trees = []
    pos = [i for i in range(len(y)) if y[i]]
    neg = [i for i in range(len(y)) if not y[i]]
    m = min(len(neg), 300)
    if not pos or not neg:
        return []
    for _ in range(TREES):
        # Bootstrap equilibrado: tantos positivos quanto negativos, senão os
        # poucos positivos somem nas folhas.
        pick = [rng.choice(pos) for _ in range(m)] + [rng.choice(neg) for _ in range(m)]
        trees.append(
            _tree([X[i] for i in pick], [y[i] for i in pick], feats, rng, DEPTH)
        )
    return trees


def predict(trees, f):
    if not trees:
        return 0.0
    total = 0.0
    for nodes in trees:
        i = 0
        while nodes[i][0] >= 0:
            i = nodes[i][2] if f[nodes[i][0]] <= nodes[i][1] else nodes[i][3]
        total += nodes[i][1]
    return total / len(trees)


def count(probs, win, step):
    """Detecções numa sequência de janelas, com a pausa de uma janela."""
    n, wait = 0, 0
    for p in probs:
        if wait > 0:
            wait -= step
        elif p >= THRESHOLD:
            n += 1
            wait = win - step
    return n


# --- treino ------------------------------------------------------------------
def train_pattern(labels, segs_of, seed=0):
    """Treina o detector de um padrão.

    labels: marcações dele [(horse_id, from_ms, to_ms, eixos)];
    segs_of(horse_id) -> segments() perto das marcações daquele cavalo.
    Negativos: o resto dessas leituras, inclusive as marcações de outros
    padrões; nada que encoste numa marcação deste.
    """
    axes = ''.join(a for a in AXES if any(a in lab[3] for lab in labels))
    feats = allowed(axes)
    win_s = min(WIN_MAX_S, max(WIN_MIN_S, median((t - f) / 1000 for _, f, t, _ in labels)))
    win = round(win_s * HZ)
    step_pos = max(1, win // 10)  # muitas janelas por marcação: poucos exemplos
    # A janela pode passar um pouco da marcação (20 %): o padrão aparece em
    # posições diferentes dentro dela, como vai acontecer no sensor.
    slack = 0.2 * win * 1000 / HZ

    pos = []  # (índice da marcação, características)
    for k, (horse, f, t, _) in enumerate(labels):
        for _, feat in windows(segs_of(horse), win, f - slack, t + slack, step_pos):
            pos.append((k, feat))
        if not any(k == j for j, _ in pos):  # marcação menor que a janela: centraliza
            mid = (f + t) / 2
            span = win * 500 / HZ
            for _, feat in windows(segs_of(horse), win, mid - span - 1, mid + span + 1, 1):
                pos.append((k, feat))
                break

    neg = []  # (grupo para validação, características)
    for horse in sorted({lab[0] for lab in labels}):
        mine = [(f - slack, t + slack) for h, f, t, _ in labels if h == horse]
        for seg in segs_of(horse):
            t0, t1 = seg[0], seg[0] + len(seg[1]) * 1000 / HZ
            for t, feat in windows([seg], win, t0, t1, win):
                if any(t < tt and t + win * 1000 / HZ > ff for ff, tt in mine):
                    continue
                # grupos de 10 janelas seguidas, para a validação cruzada
                neg.append((len(neg) // 10 % 4, feat))
    rng = random.Random(seed)
    if len(neg) > MAX_NEG:
        neg = rng.sample(neg, MAX_NEG)
    if not pos or not neg:
        return None

    X = [f for _, f in pos] + [f for _, f in neg]
    y = [1] * len(pos) + [0] * len(neg)
    trees = forest(X, y, feats, seed)
    return {
        'axes': axes,
        'win': win,
        'trees': trees,
        'metrics': _validate(labels, pos, neg, feats, win, seed),
    }


def _validate(labels, pos, neg, feats, win, seed):
    """Deixa uma marcação de fora por vez: ela foi achada? E os falsos alarmes."""
    out = {'labels': len(labels), 'windows': len(pos), 'negatives': len(neg)}
    if len(labels) < 2:  # noqa: PLR2004
        return {**out, 'recall': None, 'false_per_h': None}
    hits, false, tested = 0, 0, 0
    for k in range(len(labels)):
        tr = [f for j, f in pos if j != k]
        held = [f for j, f in pos if j == k]
        g = k % 4
        X = tr + [f for gg, f in neg if gg != g]
        y = [1] * len(tr) + [0] * (len(X) - len(tr))
        trees = forest(X, y, feats, seed + k + 1)
        hits += any(predict(trees, f) >= THRESHOLD for f in held)
        test = [predict(trees, f) for gg, f in neg if gg == g]
        false += sum(p >= THRESHOLD for p in test)
        tested += len(test)
    tested_h = tested * win / HZ / 3600  # janelas negativas não se sobrepõem
    return {
        **out,
        'recall': hits / len(labels),
        'false_per_h': round(false / tested_h, 1) if tested_h else None,
    }


# --- arquivo do ESP32 --------------------------------------------------------
def pack(ver, detectors):
    """detectors: [{code, name, axes, win, trees, alert_n, alert_min}] -> /modelo.bin."""
    out = [HEADER.pack(MAGIC, ver, FEAT_VER, HZ, len(detectors))]
    for d in detectors:
        mask = sum(1 << AXES.index(a) for a in d['axes'])
        out.append(
            PATTERN.pack(
                d['code'],
                mask,
                d['win'],
                THRESHOLD,
                d.get('alert_n') or 0,
                d.get('alert_min') or 0,
                len(d['trees']),
                d.get('name', '').encode()[:15],  # cabe com o \0 no fim
            )
        )
        for nodes in d['trees']:
            out.append(struct.pack('<H', len(nodes)))
            for f, v, left, right in nodes:
                out.append(NODE.pack(f, v, left, right))
    return b''.join(out)


def unpack(blob):
    """Inverso de pack() (testes e conferência)."""
    magic, ver, fv, hz, npat = HEADER.unpack_from(blob)
    if magic != MAGIC:
        raise ValueError('não é um modelo')
    pos = HEADER.size
    dets = []
    for _ in range(npat):
        code, mask, win, thr, an, am, nt, name = PATTERN.unpack_from(blob, pos)
        pos += PATTERN.size
        trees = []
        for _ in range(nt):
            (nn,) = struct.unpack_from('<H', blob, pos)
            pos += 2
            nodes = []
            for _ in range(nn):
                nodes.append(list(NODE.unpack_from(blob, pos)))
                pos += NODE.size
            trees.append(nodes)
        axes = ''.join(a for i, a in enumerate(AXES) if mask >> i & 1)
        dets.append({
            'code': code,
            'name': name.rstrip(b'\0').decode(errors='replace'),
            'axes': axes,
            'win': win,
            'threshold': thr,
            'alert_n': an,
            'alert_min': am,
            'trees': trees,
        })
    return {'ver': ver, 'feat_ver': fv, 'hz': hz, 'detectors': dets}
