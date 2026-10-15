"""Ingestão do sensor (ESP32 no cavalo).

O ESP32 manda os mesmos bytes que grava no cartão SD: um cabeçalho e uma
sequência de registros, cada um com ~1 min de um sinal. Cada registro vira uma
linha de `sensor_blocks`: o resumo alimenta os gráficos e as leituras brutas
ficam compactadas em `data`.

O ESP32 não tem relógio: carimba os registros com o tempo desde o boot e
informa, a cada contato, o uptime daquele instante. A conversão para hora real
é feita aqui.
"""

import math
import struct
import sys
import zlib
from array import array
from typing import NamedTuple

from sqlalchemy import select

from main.models import SensorBlock

MAGIC = b'CAV2'
# magic, leituras/s do acelerômetro, LSB por g, canais, reservado, boot
HEADER = struct.Struct('<4sHHBBI')
# tipo, flags, nº de leituras, uptime do fim do bloco (ms), duração (ms)
RECORD = struct.Struct('<BBHqI')

# tipo -> (formato do array, valores por leitura, escala); None = do cabeçalho
KINDS = {
    'A': ('h', None, None),  # acelerômetro: x, y, z (g = bruto / LSB por g)
    'H': ('H', 1, 1.0),  # intervalo entre batimentos (ms)
    'T': ('h', 1, 0.01),  # temperatura (centésimos de °C)
    'E': ('B', 1, 1.0),  # códigos de evento
}

# O relógio do ESP32 dormindo deriva alguns %; mais que isto é dado errado.
MAX_DRIFT = 0.1
# O uptime do envio é lido depois de gravar os registros; folga p/ arredondar.
SLACK_MS = 1000

# Último contato de cada sensor, vinculado ou não: o front lista para vincular
# a um cavalo. Em memória, como tracking.last_poll.
seen: dict[str, dict] = {}


class Contact(NamedTuple):
    """O ESP32 no momento do envio."""

    boot: int  # id do boot atual
    uptime_ms: int  # ms desde esse boot
    now_ms: int  # hora do servidor ao receber (epoch ms)


def _record(body, pos, accel):
    """Lê o registro em `pos`; devolve (bloco, posição do próximo)."""
    if pos + RECORD.size > len(body):
        raise ValueError('registro cortado')
    code, _flags, n, uptime_ms, dur_ms = RECORD.unpack_from(body, pos)
    kind = chr(code)
    if kind not in KINDS:
        raise ValueError(f'tipo de registro desconhecido: {code}')
    if dur_ms > uptime_ms:
        raise ValueError('bloco começa antes do boot')
    fmt, ch, scale = KINDS[kind]
    if ch is None:
        ch, scale = accel
    values = array(fmt)
    start = pos + RECORD.size
    end = start + n * ch * values.itemsize
    if end > len(body):
        raise ValueError('registro cortado')
    raw = body[start:end]
    values.frombytes(raw)
    if sys.byteorder == 'big':  # o ESP32 grava little-endian
        values.byteswap()
    block = {
        'kind': kind,
        'n': n,
        'ch': ch,
        'scale': scale,
        'uptime_ms': uptime_ms,
        'dur_ms': dur_ms,
        'values': values,
        'raw': raw,
    }
    return block, end


def parse(body):
    """Devolve (boot, blocos); ValueError se não for um envio válido."""
    if len(body) < HEADER.size:
        raise ValueError('corpo menor que o cabeçalho')
    magic, _rate, lsb_per_g, channels, _, boot = HEADER.unpack_from(body)
    if magic != MAGIC or not lsb_per_g or channels < 3:  # noqa: PLR2004
        raise ValueError('cabeçalho inválido')
    blocks, pos = [], HEADER.size
    while pos < len(body):
        block, pos = _record(body, pos, (channels, 1 / lsb_per_g))
        blocks.append(block)
    return boot, blocks


def summary(kind, values, ch, scale):
    """(mín, máx, média) na unidade do gráfico; None para eventos."""
    if kind == 'A':  # intensidade: quanto o módulo se afasta de 1 g (parado)
        v = [
            abs(math.hypot(*values[i : i + 3]) * scale - 1)
            for i in range(0, len(values), ch)
        ]
    elif kind == 'H':
        v = [60_000 / rr for rr in values if rr]  # bpm
    elif kind == 'T':
        v = [x * scale for x in values]
    else:
        v = []
    if not v:
        return None, None, None
    return min(v), max(v), sum(v) / len(v)


def decode(block):
    """Leituras brutas de uma linha de `sensor_blocks` (array de inteiros)."""
    values = array(KINDS[block.kind][0])
    values.frombytes(zlib.decompress(block.data))
    if sys.byteorder == 'big':
        values.byteswap()
    return values


def buckets(blocks, from_ms, to_ms, points):
    """Leituras de blocos 'A' em g: média por intervalo de uma janela.

    A janela [from_ms, to_ms) é cortada em `points` intervalos iguais; só os
    que têm leitura aparecem. Devolve {t (epoch ms, meio do intervalo), x, y,
    z}.
    """
    step = (to_ms - from_ms) / points
    sums = [[0.0, 0.0, 0.0, 0] for _ in range(points)]
    for b in blocks:
        values = decode(b)
        per = b.dur_ms / b.n  # ms entre leituras
        first = b.ts_ms + per / 2 - from_ms
        i = 0
        while i < b.n:
            # leituras i..j-1 caem no intervalo k: soma por fatia (rápido
            # mesmo num dia inteiro, que são milhões de leituras)
            k = int((first + i * per) // step)
            j = min(b.n, max(i + 1, math.ceil(((k + 1) * step - first) / per)))
            if 0 <= k < points:
                acc = sums[k]
                for c in range(3):
                    acc[c] += sum(values[i * b.ch + c : j * b.ch : b.ch]) * b.scale
                acc[3] += j - i
            i = j
    out = {'t': [], 'x': [], 'y': [], 'z': []}
    for k, (x, y, z, n) in enumerate(sums):
        if n:
            out['t'].append(round(from_ms + (k + 0.5) * step))
            for axis, total in (('x', x), ('y', y), ('z', z)):
                out[axis].append(round(total / n, 4))
    return out


def _clock(session, horse_id, boot, contact):
    """Função uptime (ms) -> epoch (ms) para os registros de `boot`.

    None se não há como datar: boot antigo que nunca falou com o servidor.
    """
    last = session.execute(
        select(SensorBlock.uptime_ms, SensorBlock.ts_ms, SensorBlock.dur_ms)
        .where(SensorBlock.horse_id == horse_id, SensorBlock.boot == boot)
        .order_by(SensorBlock.uptime_ms.desc())
        .limit(1)
    ).first()
    known = (last.uptime_ms, last.ts_ms + last.dur_ms) if last else None
    if boot != contact.boot:
        # Sobra de um boot anterior: continua do último bloco já datado.
        if not known:
            return None
        return lambda up: known[1] + (up - known[0])
    # Boot atual: "agora" é exato; entre o último bloco gravado e agora o
    # relógio do ESP32 é esticado/encolhido para os dois pontos baterem, o que
    # tira a deriva e emenda um contato no outro sem buraco nem sobreposição.
    rate = 1.0
    if known and contact.uptime_ms > known[0]:
        measured = (contact.now_ms - known[1]) / (contact.uptime_ms - known[0])
        if abs(measured - 1) <= MAX_DRIFT:
            rate = measured
    return lambda up: round(contact.now_ms - (contact.uptime_ms - up) * rate)


def ingest(session, horse_id, contact, body):
    """Grava os blocos novos de um envio.

    O corpo pode ser do boot atual do ESP32 ou sobra de um anterior. Devolve
    quantos blocos foram gravados, quantos já existiam (reenvio) e quantos
    ficaram sem data.
    """
    boot, blocks = parse(body)
    result = {'stored': 0, 'duplicates': 0, 'undated': 0}
    if not blocks:
        return result
    ups = [b['uptime_ms'] for b in blocks]
    if boot == contact.boot and max(ups) > contact.uptime_ms + SLACK_MS:
        raise ValueError('registro com uptime maior que o do envio')
    to_epoch = _clock(session, horse_id, boot, contact)
    if to_epoch is None:
        # ponytail: descarta. O trecho continua no cartão; um RTC no ESP32
        # (DS3231) acaba com este caso.
        result['undated'] = len(blocks)
        return result

    have = {
        tuple(row)
        for row in session.execute(
            select(SensorBlock.uptime_ms, SensorBlock.kind).where(
                SensorBlock.horse_id == horse_id,
                SensorBlock.boot == boot,
                SensorBlock.uptime_ms.between(min(ups), max(ups)),
            )
        )
    }
    for b in blocks:
        key = (b['uptime_ms'], b['kind'])
        if key in have:
            result['duplicates'] += 1
            continue
        have.add(key)
        start = to_epoch(b['uptime_ms'] - b['dur_ms'])
        v_min, v_max, v_avg = summary(
            b['kind'], b['values'], b['ch'], b['scale']
        )
        session.add(
            SensorBlock(
                horse_id=horse_id,
                kind=b['kind'],
                boot=boot,
                uptime_ms=b['uptime_ms'],
                ts_ms=start,
                dur_ms=to_epoch(b['uptime_ms']) - start,
                n=b['n'],
                ch=b['ch'],
                scale=b['scale'],
                v_min=v_min,
                v_max=v_max,
                v_avg=v_avg,
                data=zlib.compress(b['raw']),
            )
        )
        result['stored'] += 1
    session.commit()
    return result
