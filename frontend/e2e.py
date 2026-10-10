"""E2E do front num Chrome real (headless), em mobile (390x844, toque) e desktop.

Pré-requisitos: servidor rodando em localhost:8000 com admin/admin, conta
Google conectada e pelo menos 1 cavalo com tag. Cria um cavalo de teste e
o apaga no fim; não altera os outros.

    .venv\Scripts\python frontend\e2e.py <pasta_dos_prints> mobile|desktop
"""
import json
import sys
import time
import urllib.parse
import urllib.request

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

OUT, MODE = sys.argv[1], sys.argv[2]
BASE = 'http://localhost:8000/'
opts = webdriver.ChromeOptions()
opts.add_argument('--headless=new')
if MODE == 'mobile':
    opts.add_experimental_option('mobileEmulation', {
        'deviceMetrics': {'width': 390, 'height': 844, 'pixelRatio': 2, 'touch': True},
        'userAgent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Mobile Safari/537.36',
    })
else:
    opts.add_argument('--window-size=1440,900')
opts.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
d = webdriver.Chrome(options=opts)
wait = WebDriverWait(d, 25)
ok = []


def check(name, cond):
    ok.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name)


def js(script, *args):
    return d.execute_script(script, *args)


def shot(name):
    time.sleep(0.8)
    d.save_screenshot(f'{OUT}/{MODE}_{name}.png')


def until(fn, timeout=25):
    WebDriverWait(d, timeout).until(lambda _: js(f'return {fn}'))


def api(path, method='GET', body=None):
    token = js("return sessionStorage.getItem('token')")
    req = urllib.request.Request(BASE + path, method=method, headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b'null')


test_id = None
try:
    d.get(BASE)
    until("location.hash.startsWith('#/login') && !!document.getElementById('user')")
    until("customElements.get('md-outlined-text-field') !== undefined")
    shot('01_login')
    # login errado → mensagem; certo → entra
    js("document.getElementById('user').value='admin'; document.getElementById('pass').value='errada';"
       "document.getElementById('loginForm').requestSubmit()")
    until("document.getElementById('loginError').textContent.length > 0")
    check('login inválido mostra erro', 'inválidos' in js("return document.getElementById('loginError').textContent"))
    js("document.getElementById('pass').value='admin'")
    d.find_element(By.CSS_SELECTOR, '#loginForm md-filled-button').click()
    until("location.hash === '#/plantel' || location.hash === '#/google'")
    check('após login vai para plantel (conta conectada)', js('return location.hash') == '#/plantel')
    until("document.querySelectorAll('.horse-card').length > 0")
    seek = next(x for x in api('api/v1/horses/')['horses'] if x['tag_id'])  # cavalo real com tag
    check('plantel lista o cavalo real', seek['name'] in js("return document.getElementById('grid').textContent"))
    check('banner Google oculto (conectado)', js("return document.getElementById('googleBanner').hidden"))
    shot('02_plantel')

    # cadastro
    d.find_element(By.ID, 'fabCad').click()
    until("document.getElementById('cadDialog').open")
    until("document.getElementById('cadTag').querySelectorAll('md-select-option').length > 1", 40)
    time.sleep(1.5)
    shot('03_cadastro')
    check('select de tag lista rastreadores do Google', seek['name'] in js("return document.getElementById('cadTag').textContent"))
    js("document.getElementById('cadOk').click()")
    time.sleep(0.5)
    check('nome vazio bloqueia cadastro', js("return document.getElementById('cadNome').error === true && document.getElementById('cadDialog').open"))
    js("""const f = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
          f('cadNome', 'Teste UI'); f('cadRaca', 'Crioulo'); f('cadPeso', '480');
          const c = document.getElementById('cadClone'); c.value = 'manual'; c.dispatchEvent(new Event('change', {bubbles:true}));""")
    time.sleep(0.4)
    check('modo manual mostra slider da cerca', js("return !document.getElementById('manualPanel').hidden"))
    shot('04_cadastro_manual')
    js("document.getElementById('cadOk').click()")
    until("location.hash.startsWith('#/cavalo/')")
    test_id = int(js("return location.hash.split('/')[2]"))
    until("document.getElementById('hName') && document.getElementById('hName').textContent === 'Teste UI'")
    until("document.getElementById('nutriSub').textContent.length > 0")
    check('detalhe mostra raça e peso', js("return document.getElementById('hBreed').textContent") == 'Crioulo'
          and '480' in js("return document.getElementById('hWeight').textContent"))
    check('título da app bar = nome', js("return document.getElementById('title').textContent") == 'Teste UI')
    check('tile de localização: sem tag', js("return document.getElementById('locMain').textContent") == 'Sem tag')
    shot('05_cavalo')

    # nutrição: FAB → diário, depois edita uma célula só no dia
    d.find_element(By.ID, 'cNutri').click()
    until("location.hash.startsWith('#/nutricao/') && !!document.getElementById('calendar') && document.querySelectorAll('.meal').length === 21")
    check('calendário 3 turnos x 7 dias', js("return document.querySelectorAll('.meal--empty').length") == 21)
    d.find_element(By.ID, 'fabMeal').click()
    until("document.getElementById('mealDialog').open")
    js("""const s = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
          s('sx', 50);""")
    time.sleep(0.3)
    check('soma != 100 desabilita salvar', js("return document.getElementById('mealSave').disabled && document.getElementById('sumChip').textContent === 'Soma 110%'"))
    js("""const s = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
          s('sx', 40); document.querySelector('#shiftSeg [data-v=M]').click(); document.getElementById('mealTime').value = '06:45';""")
    time.sleep(0.3)
    shot('06_refeicao')
    js("document.getElementById('mealSave').click()")
    until("document.querySelectorAll('.meal:not(.meal--empty)').length === 7")
    check('recorrência diária cria 7 refeições', True)
    # célula de sexta/tarde vazia → só nesse dia
    js("document.querySelectorAll('.cal-row')[2].querySelectorAll('.meal')[4].click()")
    until("document.getElementById('mealDialog').open")
    check('célula abre com recorrência "Nunca"', js("return document.querySelector('#recSeg [aria-selected=true]').dataset.v") == 'nunca')
    js("document.getElementById('mealSave').click()")
    until("document.querySelectorAll('.meal:not(.meal--empty)').length === 8")
    check('salvar célula cria só 1 refeição', True)
    shot('07_nutricao')
    meals = api(f'api/v1/horses/{test_id}/meals')['meals']
    check('API confirma 8 refeições, manhã 06:45', len(meals) == 8 and all(m['time'] == '06:45' for m in meals if m['shift'] == 'M'))

    # volta ao cavalo: tile de nutrição mostra a próxima
    js(f"location.hash = '#/cavalo/{test_id}'")
    until("document.getElementById('nutriSub') && document.getElementById('nutriSub').textContent.startsWith('Próxima')")
    check('tile de nutrição mostra a próxima refeição', True)

    # localização do cavalo de teste: definir cerca
    js(f"location.hash = '#/localizacao/{test_id}'")
    until("!!document.querySelector('.leaflet-container') && !document.getElementById('notice').hidden")
    check('aviso "sem tag" no mapa', 'Sem tag' in js("return document.getElementById('notice').textContent"))
    js("document.getElementById('fenceStart').click()")
    time.sleep(0.5)
    check('modo edição mostra painel e mira', js("return !document.getElementById('fenceEdit').hidden && !document.getElementById('crosshair').hidden && document.getElementById('legend').hidden"))
    js("const s = document.getElementById('rslider'); s.value = 300; s.dispatchEvent(new Event('input', {bubbles:true}))")
    time.sleep(0.3)
    check('slider atualiza o raio', js("return document.getElementById('fenceRadius').textContent") == '300 m')
    shot('08_cerca_edicao')
    js("document.getElementById('fenceSave').click()")
    until("document.getElementById('fenceEdit').hidden")
    h = api(f'api/v1/horses/{test_id}')
    check('cerca salva na API (raio 300, centro definido)', h['fence_radius_m'] == 300 and h['fence_lat'] is not None)

    # localização real do cavalo com tag
    js(f"location.hash = '#/localizacao/{seek['id']}'")
    until("!!document.querySelector('.leaflet-container') && document.getElementById('statDist').textContent.length > 0")
    def count_30d():
        return len(api(f"api/v1/horses/{seek['id']}/positions?from={int(time.time()) - 30 * 86400}")['positions'])

    before = count_30d()
    js("document.querySelector('#range [data-v=\"30\"]').click()")
    until("document.getElementById('statDist').textContent.includes('ponto')")
    time.sleep(3)
    ui = int(js("return document.getElementById('statDist').textContent").split('·')[1].split()[0])
    after = count_30d()  # dado ao vivo: o poller pode gravar um ponto no meio
    check(f'30 dias: legenda bate com a API ({ui} pontos)', before <= ui <= after)
    check('pin com o nome do cavalo', seek['name'] in js("return document.querySelector('.pin') ? document.querySelector('.pin').textContent : ''"))
    tiles = js("return [...document.querySelectorAll('.leaflet-tile')].filter(t => t.complete && t.naturalWidth > 0).length")
    check(f'tiles do mapa carregaram ({tiles})', tiles > 0)
    check('botão "Consultar tag agora" na app bar', js("return !!document.querySelector('#actions md-icon-button[title=\"Consultar tag agora\"]')"))
    check('zoom do mapa no canto direito (não sob o segmentado)', js("return !!document.querySelector('.leaflet-top.leaflet-right .leaflet-control-zoom')"))
    shot('09_localizacao_seektag')

    # biometria / atividade
    js(f"location.hash = '#/biometria/{seek['id']}'")
    until("!!document.querySelector('.chart-empty')")
    shot('10_biometria')
    js(f"location.hash = '#/atividade/{seek['id']}'")
    until("!!document.querySelector('.counters')")
    shot('11_atividade')

    # alertas
    d.find_element(By.ID, 'bell').click()
    time.sleep(1.2)
    check('drawer de alertas abre', js("return document.getElementById('alertsDrawer').classList.contains('open')"))
    shot('12_alertas')
    js("document.getElementById('alertsClose').click()")

    # conta Google
    js("location.hash = '#/google'")
    until("document.getElementById('stLogin') && document.getElementById('stLogin').textContent.startsWith('Conectada')")
    until("document.getElementById('trackers').textContent.includes('Vinculada a')", 40)
    check('Conta Google: conectada e lista a tag vinculada', seek['name'] in js("return document.getElementById('trackers').textContent"))
    shot('13_google')

    # voltar do navegador funciona (hash routing)
    d.back()
    until(f"location.hash === '#/atividade/{seek['id']}'")
    check('botão voltar do navegador volta de tela', True)
    # "Cadastrar cavalo" da Conta Google abre o cadastro com a tag escolhida
    q = urllib.parse.urlencode({'tag': seek['tag_id'], 'name': 'Via Google'})
    js(f"location.hash = '#/plantel?{q}'")
    until("document.getElementById('cadDialog') && document.getElementById('cadDialog').open && document.getElementById('cadTag').value !== ''", 40)
    check('link da Conta Google pré-seleciona a tag', js("return document.getElementById('cadTag').value") == seek['tag_id']
          and js("return document.getElementById('cadNome').value") == 'Via Google')
    shot('14_cadastro_via_google')
    first = api('api/v1/horses/')['horses'][0]
    check('"Copiar de" já vem com o 1º cavalo', js("return document.getElementById('cadClone').value") == str(first['id']))
    # envia sem a tag real (não duplicar a consulta dela) → clona a cerca do 1º cavalo
    js("const t = document.getElementById('cadTag'); t.value = ''; t.dispatchEvent(new Event('change', {bubbles:true}))")
    js("document.getElementById('cadOk').click()")
    until("location.hash.startsWith('#/cavalo/') && location.hash !== '#/cavalo/%d'" % seek['id'])
    via = api(f"api/v1/horses/{js('return location.hash.split("/")[2]')}")
    check('cadastro clonou a cerca do 1º cavalo', via['fence_radius_m'] == first['fence_radius_m'] and via['fence_lat'] == first['fence_lat'] and via['tag_id'] is None)
    api(f"api/v1/horses/{via['id']}", 'DELETE')
finally:
    if test_id:
        api(f'api/v1/horses/{test_id}', 'DELETE')
        print('cavalo de teste removido')
    errors = [e for e in d.get_log('browser') if e['level'] == 'SEVERE' and 'favicon' not in e['message'] and 'Faça login' not in e['message'] and '401' not in e['message']
              and not ('/positions/latest' in e['message'] and '404' in e['message'])]  # 404 = cavalo ainda sem posição
    for e in errors:
        print('CONSOLE', e['message'][:220])
    check('sem erros no console', not errors)
    d.quit()
    print(f"{sum(1 for _, v in ok if v)}/{len(ok)} ok")
