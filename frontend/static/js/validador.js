const DEBUG = false; // Mude para true para ativar logs de diagnóstico
const _dbg = (...a) => { if (DEBUG) console.log(...a); };
const _dbgWarn = (...a) => { if (DEBUG) console.warn(...a); };

// ═══════════════════════════════════════════════════════
// CONFIGURAÇÕES — edite aqui para ajustar o comportamento
// ═══════════════════════════════════════════════════════
const CFG = {
  tolerancia: 0.05,
  descontoSegundaSaida: 0.30,
  aliquotas_validas: new Set(Array.from({length: 23}, (_, i) => i)),
  grisPercentDefault: 0.001, // 0,1% = Valor NF / 1000
  grisMinPct: 0.0005,  // 0,05% — mínimo aceito (editável nas configurações)
  grisMaxPct: 0.0020,  // 0,20% — máximo aceito (editável nas configurações)
  grisNfMinimo: 10.00, // NF abaixo deste valor → skip validação GRIS (arredondamento)
  grisBigsMinPct: 0.0005, // BIGS: GRIS % mínimo (configurável separado)
  grisBigsMaxPct: 0.0020, // BIGS: GRIS % máximo (configurável separado)
  feriadosNacionais: ["2024-01-01","2024-02-12","2024-02-13","2024-03-29","2024-05-30","2024-04-21","2024-05-01","2024-09-07","2024-10-12","2024-11-02","2024-11-15","2024-11-20","2024-12-25","2025-01-01","2025-03-03","2025-03-04","2025-04-18","2025-06-19","2025-04-21","2025-05-01","2025-09-07","2025-10-12","2025-11-02","2025-11-15","2025-11-20","2025-12-25","2026-01-01","2026-02-16","2026-02-17","2026-04-03","2026-06-04","2026-04-21","2026-05-01","2026-09-07","2026-10-12","2026-11-02","2026-11-15","2026-11-20","2026-12-25","2027-01-01","2027-02-08","2027-02-09","2027-03-26","2027-05-27","2027-04-21","2027-05-01","2027-09-07","2027-10-12","2027-11-02","2027-11-15","2027-11-20","2027-12-25","2028-01-01","2028-02-28","2028-02-29","2028-04-14","2028-06-15","2028-04-21","2028-05-01","2028-09-07","2028-10-12","2028-11-02","2028-11-15","2028-11-20","2028-12-25"],

  // Regras: true = ativa, false = desativada
  regras: {
    fiscal_vfr:         { on: true,  label: 'Valor Final à Receber (VFR)',              desc: 'Regra oficial PMO: Valor Final = Tarifa Aplicada + GRIS + Valor ICMS/ISS + Outros Valores + Tarifa de Espera - Descontos.',       badge: 'err' },
    fiscal_iss:         { on: true,  label: 'Validação ICMS/ISS por operação',           desc: 'FM e FM Big\'s usam validação mista: Base/VFR = soma_base + imposto. Demais operações usam gross-up.', badge: 'err' },
    fiscal_isento:      { on: true,  label: 'Isento (alíq 0%) sem ICMS/ISS',           desc: 'Se a alíquota estiver zerada, o valor do imposto também deve estar zerado. Caso exista imposto com alíquota 0%, provavelmente houve cálculo incorreto.',             badge: 'err' },
    base_negativa:      { on: true,  label: 'Base Calc ICMS/ISS negativa',              desc: 'A base de cálculo ficou negativa. Isso normalmente acontece quando os descontos ficaram maiores que a soma do frete + adicionais.',      badge: 'err' },
    tarifa_base_zerada:{ on: true,  label: 'Tarifa/Frete Base zerada',                    desc: 'O frete base ou tarifa aplicada veio zerado. Isso pode indicar tabela não aplicada, rota sem precificação ou erro de preenchimento.',              badge: 'warn' },
    valor_final_zerado:{ on: true,  label: 'Valor Final zerado',                          desc: 'O valor final veio zerado. Normalmente isso não deveria acontecer em linhas faturáveis.',                            badge: 'warn' },
    segunda_saida_desc: { on: true,  label: 'Desconto de Segunda Saída',                desc: 'Tipo da Rota = Segunda Saída valida o desconto conforme a base disponível. Para regra exata, crie uma customizada com Basic Shipping Fee.',    badge: 'err' },
    normal_com_desc:    { on: true,  label: 'Rota NORMAL sem desconto indevido',        desc: 'Rotas NORMAIS não devem ter campo Descontos preenchido.',                badge: 'warn' },
    aliquota_invalida:  { on: true,  label: 'Alíquotas válidas',                        desc: 'A porcentagem do imposto está fora do padrão esperado. Exemplo: 0%, 5%, 12%, 18%. Verifique se a alíquota foi preenchida corretamente.',                badge: 'err' },
    imposto_aliquota:   { on: true,  label: 'IMPOSTO compatível com alíquota',          desc: 'Regra oficial PMO: Base Calc = (Tarifa + GRIS + Outros + Espera - Descontos) ÷ (1 - Alíquota).', badge: 'err' },
    cnpj_tomador:       { on: true,  label: 'CNPJ Tomador único por arquivo',           desc: 'Alerta quando o arquivo tem apenas um CNPJ Tomador — o esperado é mais de um.',  badge: 'warn' },
    cnpj_invalido:      { on: true,  label: 'CNPJ encerrado / inválido',                desc: 'Detecta CNPJs da lista de encerrados configurada abaixo.',              badge: 'err' },
    gris_valor_nf:     { on: true,  label: 'GRIS % dentro da faixa aceita (0,05% a 0,15%)', desc: 'Valida se o percentual de GRIS está dentro da faixa esperada. O sistema calcula automaticamente usando GRIS ÷ Valor da NF quando necessário.', badge: 'err' },
    colunas_ausentes:   { on: true,  label: 'Colunas obrigatórias presentes',           desc: 'Verifica se o arquivo contém as colunas globais esperadas. Colunas específicas por operação não são cobradas globalmente.', badge: 'err' },
    isencao_sp:         { on: false, label: 'Isenção ICMS — origem SP',                 desc: 'Alerta quando UF Origem = SP e ICMS != 0. Desligado por padrão em FM.', badge: 'warn' },
    air_haul_veiculo:   { on: true,  label: 'Air Haul — Tipo de Veículo', desc: 'Linhas Air Haul devem ter Tipo do Veículo compatível (AIR/AVIÃO).', badge: 'warn' },
    bigs_infrutifera:   { on: true,  label: 'Big\'s com Segunda Saída/Infrutífera',      desc: 'Para FM/FMH, identifica Big\'s pelo nome da transportadora e acusa erro se Tipo da Rota for Segunda Saída ou Infrutífera.', badge: 'err' },
    domingo_feriado_add:{ on: true,  label: 'Domingo/Feriado +20% sobre Frete Base (Data Prestação)', desc: 'Quando a Data da Prestação do Serviço cair em domingo, feriado nacional ou feriado estadual da UF Origem, valida adicional de 20% sobre Frete/Tarifa Base em Observações/Outros Valores.', badge: 'err' },
    observacoes_outros: { on: true,  label: 'Observações/Comentários = Outros Valores', desc: 'Regra geral para todas as operações e transportadoras: soma componentes em Observações/Comentários e compara com Outros Valores.', badge: 'err' },
    feriado_estadual:   { on: false, label: 'Feriado Estadual +20% (legado)',              desc: 'Substituído pela regra Domingo/Feriado, que agora também verifica feriados estaduais da UF Origem. Mantido aqui apenas para referência.', badge: 'warn' },
    vfr_igual_base:     { on: false,  label: '[LEGADO] VFR = Base Calc ICMS/ISS',          desc: 'O valor final do arquivo deveria bater exatamente com a Base Calc ICMS/ISS. Diferenças normalmente indicam erro de cálculo ou arredondamento incorreto.', badge: 'err'  },
    colunas_100pct:     { on: true,  label: 'Colunas obrigatórias 100% preenchidas',      desc: 'Campos obrigatórios não podem ficar vazios. Em operações FM, pelo menos um dos campos Hub ou SOC precisa existir em cada linha.', badge: 'warn' },
    cnpj_tomador_unico: { on: true,  label: 'CNPJ Tomador — alerta se só um no arquivo',  desc: 'Arquivos com somente um CNPJ Tomador podem indicar erro de filtragem.', badge: 'warn' },
    bigs_fm_ajudante:   { on: true,  label: 'FM/BIGS sem ajudante e sem infrutífera',     desc: 'Para FM e BIGS, Outros Valores não deve incluir ajudante e Tipo da Rota não deve ser Infrutífera.', badge: 'err'  },
    cnpj_prefixo_42:    { on: true,  label: 'CNPJ Tomador deve iniciar com 42',        desc: 'Todos os CNPJs tomadores deveriam começar com 42. Quando isso não acontece, normalmente o arquivo possui contratante incorreto ou cadastro divergente.', badge: 'err' },
    deferimento_estado: { on: true,  label: 'Diferimento por estado/CNPJ Tomador',        desc: 'Valida diferimento intra-SP para LM e LH: UF Origem pacote = SP + UF Origem = SP + CNPJ Tomador SP → ICMS deveria ser 0%. Não se aplica a FM/FMH pois UF Origem representa a rota, não a origem fiscal da mercadoria.', badge: 'warn' },
    minihub_vol_zero:   { on: false, label: 'Minihub — volumes zerados fora de S/D/F',    desc: 'Em operação Minihub, pacotes zerados em dias úteis (fora de sábado, domingo e feriados) geram alerta.', badge: 'warn' },
  },

  cnpjsInvalidos: [
    { cnpj: '42446277010821', msg: 'Encerrado — substituto: 42446277027392 (Lauro de Freitas)' }
  ],

  // Colunas obrigatórias GLOBAIS.
  // Não incluir aqui colunas específicas de uma operação, porque LM, LH e FM têm layouts diferentes.
  // Ex.: LM não tem id_rota nem Tipo da Rota; FM pode ter.
  colunasObrigatorias: [
    'Operação','Frete/Tarifa Base (Peso/KM/Veículo)',
    'GRIS','Outros Valores',
    'Descontos','Aliquota ICMS/ISS','IMPOSTO','Base Calc ICMS/ISS',
    'Valor ICMS/ISS','Valor Final à Receber','CNPJ Tomador','UF Origem',
    'UF Origem pacote','Data da Prestação do Serviço'
  ]
};



// ═══════════════════════════════════════════════════════
// ORGANIZAÇÃO DE REGRAS POR OPERAÇÃO
// Mantém as regras antigas de FM, apenas organizadas por aba.
// ═══════════════════════════════════════════════════════
const RULE_GROUP_LABELS = {
  GLOBAL: 'Globais',
  FIRST_MILE: 'First Mile / FM Hub',
  LINE_HAUL: 'Line Haul',
  LAST_MILE: 'Last Mile'
};

const RULE_GROUPS = {
  GLOBAL: ['cnpj_prefixo_42','fiscal_vfr','base_negativa','tarifa_base_zerada','valor_final_zerado','gris_valor_nf','aliquota_invalida','imposto_aliquota','cnpj_invalido','colunas_ausentes','domingo_feriado_add','vfr_igual_base','colunas_100pct','cnpj_tomador_unico','feriado_estadual','deferimento_estado','minihub_vol_zero'],
  FIRST_MILE: ['fiscal_iss','fiscal_isento','segunda_saida_desc','normal_com_desc','cnpj_tomador','isencao_sp','bigs_infrutifera','bigs_fm_ajudante'],
  LINE_HAUL: ['fiscal_vfr','fiscal_iss','fiscal_isento','base_negativa','observacoes_outros','air_haul_veiculo'],
  LAST_MILE: ['fiscal_vfr','fiscal_iss','fiscal_isento','base_negativa','observacoes_outros','cnpj_invalido']
};

const DEFAULT_COLUMN_OPTIONS = [
  'Tipo do Serviço','Operação','SOC','Hub','Rota','Período (Ano_Mês_Quinzena)',
  '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
  'Data da Prestação do Serviço','Nome Tomador do Serviço','CNPJ Tomador',
  'Nome Transportadora (3PL)','CNPJ Emitente (3PL)','Cidade Origem','UF Origem','UF Origem pacote',
  'Cidade Entrega','UF Entrega','Data da Entrega','Quantidade Volume','KM Rodado',
  'Tipo do Veículo','Fator Agrupador (p/ Cobrança por Veiculo)',
  'Valor nota Fiscal Mercadoria','GRIS %','Tarifa Aplicada','Basic Shipping Fee',
  'Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado','ADV','GRIS',
  'Tarifa de Espera','Aliquota ICMS/ISS','IMPOSTO','Base Calc ICMS/ISS',
  'Valor ICMS/ISS','ICMS Subst','Outros Valores','Descontos',
  'Valor Final à Receber','Comentários','id_rota','Tipo da Rota',
  'active_deferral','Flag Agrupamento Misto'
];

// ═══════════════════════════════════════════════════════
// COLUNAS ESPERADAS POR OPERAÇÃO
// ═══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// LAYOUT OFICIAL DE COLUNAS POR OPERAÇÃO — fonte: spec PMO
// Todas as colunas são obrigatórias. Arquivo sem qualquer delas gera erro.
// ══════════════════════════════════════════════════════════════════════════
const COLUNAS_POR_OPERACAO = {

  // FM — layout oficial
  FM: [
    'Tipo do Serviço','Operação','SOC','Hub','Rota','Período (Ano_Mês_Quinzena)',
    '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
    '3PL Tracking Number (Enviado por API pela Transportadora)',
    'Data da Prestação do Serviço','Nome Tomador do Serviço','CNPJ Tomador',
    'Nome Transportadora (3PL)','CNPJ Emitente (3PL)',
    'CEP Origem','Cidade Origem','UF Origem',
    'CEP Entrega','Cidade Entrega','UF Entrega',
    'Dados do Seller','Data da Entrega','Quantidade Volume',
    'Peso Real','Peso Cubado','Peso Calculado/Cobrado','KM Rodado','Tipo do Veículo',
    'Fator Agrupador (p/ Cobrança por Veiculo)','Placa',
    'Valor nota Fiscal Mercadoria',
    'Tarifa Aplicada','Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado',
    'ADV','GRIS','Aliquota ICMS/ISS','IMPOSTO',
    'Base Calc ICMS/ISS','Valor ICMS/ISS','ICMS Subst',
    'Outros Valores','Descontos','Valor Final à Receber',
    'Data Emissão Cte/NF','Fatura','Número Cte','Número NF',
    'Serie Cte/ Nf','Chave de Acesso Cte','Motivo Rejeição CTE',
    'Prefeitura NFSe','Comentários','De acordo (Sim/Não)',
    'Motivo (Valor incorreto/número de ordens incorreta no protocolo)',
    'Valor Negociado (Caso para valor incorreto)','Observações',
    'id_rota','Tipo da Rota','UF Origem pacote',
  ],

  // LH — layout oficial (tem Tarifa de Espera, Station Id ao final)
  LH: [
    'Tipo do Serviço','Operação','SOC','Hub','Rota','Período (Ano_Mês_Quinzena)',
    '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
    '3PL Tracking Number (Enviado por API pela Transportadora)',
    'Data da Prestação do Serviço','Nome Tomador do Serviço','CNPJ Tomador',
    'Nome Transportadora (3PL)','CNPJ Emitente (3PL)',
    'CEP Origem','Cidade Origem','UF Origem',
    'CEP Entrega','Cidade Entrega','UF Entrega',
    'Dados do Seller','Data da Entrega','Quantidade Volume',
    'Peso Real','Peso Cubado','Peso Calculado/Cobrado','KM Rodado','Tipo do Veículo',
    'Fator Agrupador (p/ Cobrança por Veiculo)','Placa',
    'Valor nota Fiscal Mercadoria',
    'Tarifa de Espera',
    'Tarifa Aplicada','Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado',
    'ADV','GRIS','Aliquota ICMS/ISS','IMPOSTO',
    'Base Calc ICMS/ISS','Valor ICMS/ISS','ICMS Subst',
    'Outros Valores','Descontos','Valor Final à Receber',
    'Data Emissão Cte/NF','Fatura','Número Cte','Número NF',
    'Serie Cte/ Nf','Chave de Acesso Cte','Motivo Rejeição CTE',
    'Prefeitura NFSe','Comentários','De acordo (Sim/Não)',
    'Motivo (Valor incorreto/número de ordens incorreta no protocolo)',
    'Valor Negociado (Caso para valor incorreto)','Observações',
    'Tipo da Rota','Station Id','UF Origem pacote',
  ],

  // LM — layout oficial (sem id_rota/Tipo da Rota/Station Id)
  LM: [
    'Tipo do Serviço','Operação','SOC','Hub','Rota','Período (Ano_Mês_Quinzena)',
    '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
    '3PL Tracking Number (Enviado por API pela Transportadora)',
    'Data da Prestação do Serviço','Nome Tomador do Serviço','CNPJ Tomador',
    'Nome Transportadora (3PL)','CNPJ Emitente (3PL)',
    'CEP Origem','Cidade Origem','UF Origem',
    'CEP Entrega','Cidade Entrega','UF Entrega',
    'Dados do Seller','Data da Entrega','Quantidade Volume',
    'Peso Real','Peso Cubado','Peso Calculado/Cobrado','KM Rodado','Tipo do Veículo',
    'Fator Agrupador (p/ Cobrança por Veiculo)','Placa',
    'Valor nota Fiscal Mercadoria',
    'Tarifa Aplicada','Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado',
    'ADV','GRIS','Aliquota ICMS/ISS','IMPOSTO',
    'Base Calc ICMS/ISS','Valor ICMS/ISS','ICMS Subst',
    'Outros Valores','Descontos','Valor Final à Receber',
    'Data Emissão Cte/NF','Fatura','Número Cte','Número NF',
    'Serie Cte/ Nf','Chave de Acesso Cte','Motivo Rejeição CTE',
    'Prefeitura NFSe','Comentários','De acordo (Sim/Não)',
    'Motivo (Valor incorreto/número de ordens incorreta no protocolo)',
    'Valor Negociado (Caso para valor incorreto)','Observações','UF Origem pacote',
  ],

  // Handling — layout oficial (termina em Payment Orders)
  HANDLING: [
    'Tipo do Serviço','Operação','SOC','Hub','Rota','Período (Ano_Mês_Quinzena)',
    '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
    '3PL Tracking Number (Enviado por API pela Transportadora)',
    'Data da Prestação do Serviço','Nome Tomador do Serviço','CNPJ Tomador',
    'Nome Transportadora (3PL)','CNPJ Emitente (3PL)',
    'CEP Origem','Cidade Origem','UF Origem',
    'CEP Entrega','Cidade Entrega','UF Entrega',
    'Dados do Seller','Data da Entrega','Quantidade Volume',
    'Peso Real','Peso Cubado','Peso Calculado/Cobrado','KM Rodado','Tipo do Veículo',
    'Fator Agrupador (p/ Cobrança por Veiculo)','Placa',
    'Valor nota Fiscal Mercadoria',
    'Tarifa Aplicada','Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado',
    'ADV','GRIS','Aliquota ICMS/ISS','IMPOSTO',
    'Base Calc ICMS/ISS','Valor ICMS/ISS','ICMS Subst',
    'Outros Valores','Descontos','Valor Final à Receber',
    'Data Emissão Cte/NF','Fatura','Número Cte','Número NF',
    'Serie Cte/ Nf','Chave de Acesso Cte','Motivo Rejeição CTE',
    'Prefeitura NFSe','Comentários','Payment Orders',
  ],

};



// Detecta operação do arquivo pela coluna Operação e/ou nome do arquivo
function detectarOperacaoArquivo(rows, nomeArquivo) {
  // 1. Tenta pela coluna Operação (primeiras 200 linhas)
  const opCol = Object.keys(rows[0] || {}).find(k => normalizarNomeColuna(k) === 'operacao');
  if (opCol) {
    const vals = rows.slice(0, 200).map(r => String(r[opCol] || '').toUpperCase());
    if (vals.some(v => /HANDLING/.test(v)))          return 'HANDLING';
    if (vals.some(v => /FIRST.?MILE|\bFMH?\b/.test(v))) return 'FM';
    if (vals.some(v => /LINE.?HAUL|\bLH\b/.test(v)))    return 'LH';
    if (vals.some(v => /LAST.?MILE|\bLM\b/.test(v)))    return 'LM';
  }
  // 2. Fallback: nome do arquivo
  if (nomeArquivo) {
    const fn = nomeArquivo.toUpperCase();
    if (/HANDLING/.test(fn))           return 'HANDLING';
    if (/FIRST.?MILE|_FM_/.test(fn))   return 'FM';
    if (/LINE.?HAUL|_LH_/.test(fn))    return 'LH';
    if (/LAST.?MILE|_LM_/.test(fn))    return 'LM';
  }
  return null;
}


let activeRuleGroup = 'FIRST_MILE';
const CUSTOM_RULES_KEY = 'validador_prefat_custom_rules_v1';
let customRules = carregarRegrasCustomizadas();

function carregarRegrasCustomizadas() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_RULES_KEY) || '[]'); }
  catch(e) { return []; }
}

function persistirRegrasCustomizadas(fromServer) {
  localStorage.setItem(CUSTOM_RULES_KEY, JSON.stringify(customRules));
  if(!fromServer && typeof _ajApiFetch==='function'){
    _ajApiFetch('/api/validador/ajustes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({custom_rules:customRules})}).catch(()=>{});
  }
}


// =========================================================
// MOTOR FISCAL OFICIAL PMO — ÚNICO
// =========================================================
function calcularMotorFiscalPMO(row){

  const tarifa =
    num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ??
    num(row['Tarifa Aplicada']) ??
    0;
  


  const gris = num(row['GRIS']) || 0;
  const outros = num(row['Outros Valores']) || 0;
  const espera = num(row['Tarifa de Espera']) || 0;
  const descontos = num(row['Descontos']) || 0;

  let aliquota =
    normalizarAliquotaTaxa(row['Aliquota ICMS/ISS']);

  aliquota = aliquota || 0;

  const liquido =
    tarifa + gris + outros + espera - descontos;

  let baseCalc = liquido;

  if (aliquota > 0 && aliquota < 1) {
    baseCalc = liquido / (1 - aliquota);
  }

  const valorImposto = baseCalc * aliquota;

  const valorFinal =
    tarifa + gris + valorImposto + outros + espera - descontos;

  return {
    tarifa,
    gris,
    outros,
    espera,
    descontos,
    aliquota,
    liquido,
    baseCalc: parseFloat(baseCalc.toFixed(4)),
    valorImposto: parseFloat(valorImposto.toFixed(4)),
    valorFinal: parseFloat(valorFinal.toFixed(4))
  };
}


// Motor fiscal com cache por linha — evita recalcular a mesma row múltiplas vezes
const _motorCache = new WeakMap();
function calcularMotorFiscal(row) {
  if (_motorCache.has(row)) return _motorCache.get(row);
  const result = calcularMotorFiscalPMO(row);
  _motorCache.set(row, result);
  return result;
}


// ═══════════════════════════════════════════════════════
// ESTADO DA APLICAÇÃO
// ═══════════════════════════════════════════════════════
const appState = { files: [], results: [], observedColumns: new Set() };

// ── Flags de controle de execução ───────────────────────────────────────────
let _cancelando  = false;
let _validando   = false;
let _corrigindo  = false;
let _processando = false; // alias: true quando _validando || _corrigindo

// ═══════════════════════════════════════════════════════
// ASYNC / PROGRESSO — helpers para não travar a UI
// ═══════════════════════════════════════════════════════

/** Toast não-bloqueante — substitui alert() em toda a aplicação */
function _toast(msg, tipo = 'info', ms = 4000) {
  const paleta = { info: ['var(--accent)','var(--accent-dim)'], ok: ['var(--green)','var(--green-dim)'], err: ['var(--red)','var(--red-dim)'], warn: ['var(--yellow)','var(--yellow-dim)'] };
  const [cor] = paleta[tipo] || paleta.info;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg2);border:1px solid ${cor};color:${cor};border-radius:8px;padding:10px 22px;font-size:13px;font-weight:500;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.5);white-space:pre-wrap;max-width:500px;text-align:center;animation:_toastIn .18s ease;cursor:pointer`;
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => { if (!el.isConnected) return; el.style.transition = 'opacity .3s'; el.style.transition = 'opacity .25s, transform .25s'; el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(4px)'; setTimeout(() => el.remove(), 270); }, ms);
}

// ── yieldToUI — usa MessageChannel em vez de setTimeout ─────────────────────
// setTimeout(0) é throttled para ~1000 ms quando a aba está em segundo plano
// (Chrome, Firefox, Edge, Safari). MessageChannel NÃO sofre esse throttling:
// suas mensagens são entregues como macrotasks normais independentemente de
// visibilidade. O processamento continua na mesma velocidade em qualquer aba.
// Referência: https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel
const _yieldChannel = new MessageChannel();
function yieldToUI() {
  return new Promise(resolve => {
    _yieldChannel.port1.onmessage = resolve;
    _yieldChannel.port2.postMessage(null);
  });
}

/** Controla o overlay flutuante de progresso (visível em qualquer página) */
function mostrarProgOverlay(pct, msg, det, titulo) {
  const ov = document.getElementById('prog-overlay');
  if (!ov) return;
  ov.style.display = 'block';
  requestAnimationFrame(() => { ov.style.opacity = '1'; ov.style.transform = 'translateX(-50%) translateY(0)'; });
  const fill  = document.getElementById('prog-ov-fill');
  const msgEl = document.getElementById('prog-ov-msg');
  const pctEl = document.getElementById('prog-ov-pct');
  const detEl = document.getElementById('prog-ov-det');
  const titEl = document.getElementById('prog-ov-titulo');
  if (fill) {
    const pctRound = Math.round(pct * 100);
    fill.style.width = `${pctRound}%`;
    // Anima com pulso quando está processando mas progresso é 0% (ex: aguardando worker)
    fill.style.animation = pctRound === 0 ? '_barPulse 1.4s ease-in-out infinite' : 'none';
  }
  if (msgEl) msgEl.textContent = msg || '';
  if (pctEl) pctEl.textContent = `${Math.round(pct * 100)}%`;
  if (detEl) detEl.textContent = det || '';
  if (titEl && titulo) titEl.textContent = titulo;
}
function esconderProgOverlay() {
  const ov = document.getElementById('prog-overlay');
  if (!ov) return;
  ov.style.opacity = '0';
  ov.style.transform = 'translateX(-50%) translateY(8px)';
  setTimeout(() => { ov.style.display = 'none'; }, 300);
}

/** Atualiza a barra de progresso visível.
 *  @param {number} pct      0..1
 *  @param {string} msg      linha principal
 *  @param {string} [detalhe] linha secundária (opcional)
 */
function atualizarProgresso(pct, msg, detalhe) {
  const wrap   = document.getElementById('progresso-wrap');
  const msgEl  = document.getElementById('progresso-msg');
  const pctEl  = document.getElementById('progresso-pct');
  const fill   = document.getElementById('progresso-fill');
  const detEl  = document.getElementById('progresso-detalhe');
  const btnCan = document.getElementById('btn-cancelar-prog');
  if (!wrap) return;
  wrap.classList.add('visivel');
  if (msgEl)  msgEl.textContent  = msg || 'Processando…';
  if (pctEl)  pctEl.textContent  = `${Math.round(pct * 100)}%`;
  if (fill)   fill.style.width   = `${Math.round(pct * 100)}%`;
  if (detEl)  detEl.textContent  = detalhe || '';
}

function esconderProgresso() {
  const wrap = document.getElementById('progresso-wrap');
  if (wrap) {
    wrap.classList.remove('visivel');
    const fill = document.getElementById('progresso-fill');
    if (fill) fill.style.width = '0%';
  }
}

/**
 * Versão async de normalizarColunas: processa em lotes de CHUNK linhas,
 * cedendo o controle ao browser entre cada lote.
 * Compatível com o mesmo retorno de normalizarColunas().
 */
async function normalizarColunasAsync(rows, onChunk) {
  if (!rows.length) return rows;
  const CHUNK = 5000; // chunks menores = UI respira com mais frequência
  const mapaCanonico = buildColumnCanonicalMap();
  const resultado = [];

  for (let i = 0; i < rows.length; i += CHUNK) {
    const fatia = rows.slice(i, i + CHUNK);
    fatia.forEach(row => {
      const novo = {};
      for (const [k, v] of Object.entries(row)) {
        if (String(k).startsWith('_')) { novo[k] = v; continue; }
        const chave  = normalizarNomeColuna(k);
        const destino = mapaCanonico[chave] || String(k).trim();
        if (!(destino in novo) || novo[destino] === null || novo[destino] === undefined || novo[destino] === '') {
          novo[destino] = v;
        }
      }
      novo.__normalizado = true;
      resultado.push(novo);
    });
    if (onChunk) onChunk(Math.min(i + CHUNK, rows.length), rows.length);
    await yieldToUI();
  }
  return resultado;
}

// ═══════════════════════════════════════════════════════
// STREAMING XLSX PARSER  (arquivos >= 5 MB)
// Usa JSZip para extrair entradas do ZIP lazily e faz
// parsing do sheet XML em chunks — nunca mantém o XML
// descomprimido inteiro na memória; não bloqueia a UI.
// ═══════════════════════════════════════════════════════

/** Converte letras de coluna Excel para índice 0-base: A→0, Z→25, AA→26 */
function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Decodifica entidades XML básicas */
function decodeXmlEnt(s) {
  return String(s ?? '')
    // Entidades numéricas hexadecimais: &#xE3; → ã
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    // Entidades numéricas decimais: &#227; → ã
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Entidades XML nomeadas padrão
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/**
 * Parse do sharedStrings.xml → array de strings.
 * Suporta rich-text (<r><t>…</t></r>) e texto simples (<t>…</t>).
 */
function parseSharedStringsXml(xml) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const parts = [];
    const tRe = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[1])) !== null) parts.push(decodeXmlEnt(tm[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

/**
 * Versão async de parseSharedStringsXml — cede ao browser a cada 50 k strings.
 * Evita travar a UI em arquivos com sharedStrings.xml volumosos (50 MB+).
 */
async function parseSharedStringsXmlAsync(xml, onProgress) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const YIELD_EACH = 50000;
  let m, count = 0;
  while ((m = siRe.exec(xml)) !== null) {
    const parts = [];
    const tRe = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(m[1])) !== null) parts.push(decodeXmlEnt(tm[1]));
    strings.push(parts.join(''));
    if (++count % YIELD_EACH === 0) {
      if (onProgress) onProgress(count);
      await yieldToUI();
    }
  }
  return strings;
}

/**
 * Parse de um fragmento XML de <row …>…</row>.
 * Retorna { rowNum, cells } onde cells = { colIndex → value }.
 */
function parseRowXml(rowXml, sharedStrings) {
  const rnm = rowXml.match(/\br="(\d+)"/);
  if (!rnm) return null;
  const rowNum = parseInt(rnm[1]);
  const cells = {};
  // Captura cada célula: <c r="XY123" [t="TYPE"] …>…</c>
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let cm;
  while ((cm = cellRe.exec(rowXml)) !== null) {
    const attrs = cm[1], inner = cm[2];
    const rm = attrs.match(/\br="([A-Z]+)/);
    if (!rm) continue;
    const colIdx = colLetterToIndex(rm[1]);
    const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
    let value = null;
    if (type === 'inlineStr') {
      const isM = inner.match(/<t(?:[^>]*)>([\s\S]*?)<\/t>/);
      if (isM) value = decodeXmlEnt(isM[1]);
    } else {
      const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (vM) {
        const raw = vM[1];
        if      (type === 's') value = sharedStrings[parseInt(raw)] ?? null;
        else if (type === 'b') value = raw === '1';
        else { const n = parseFloat(raw); value = isNaN(n) ? raw : n; }
      }
    }
    cells[colIdx] = value;
  }
  return { rowNum, cells };
}

/**
 * Detecta cabeçalho nas primeiras linhas brutas e devolve
 * { headerIdx, colMap } onde colMap = { colIndex → nomeColuna }.
 */
function detectHeaderStreaming(first40, sheetName) {
  const mapa = buildColumnCanonicalMap();
  const bonusBase = sheetName.toUpperCase().includes('BASE') ? 10 : 0;
  let best = { idx: 0, score: -1 };
  const KEY_COLS = ['Operação','CNPJ Tomador','Frete/Tarifa Base (Peso/KM/Veículo)',
    'Frete/Tarifa Base (Peso/KM/Veículo)','Valor Final à Receber',
    'Base Calc ICMS/ISS','Valor ICMS/ISS','IMPOSTO'];

  first40.forEach(({ cells }, i) => {
    const seen = new Set();
    let score = bonusBase;
    Object.values(cells).forEach(v => {
      if (v === null || v === undefined) return;
      const chave = normalizarNomeColuna(String(v));
      if (mapa[chave]) { seen.add(mapa[chave]); score += 3; }
      else if (String(v).trim().length > 0) score += 0.05;
    });
    KEY_COLS.forEach(c => { if (seen.has(c)) score += 5; });
    if (score > best.score) best = { idx: i, score };
  });

  const colMap = {};
  Object.entries(first40[best.idx]?.cells || {}).forEach(([ci, v]) => {
    if (v !== null && v !== undefined) {
      const name = String(v).trim();
      if (name) colMap[parseInt(ci)] = name;
    }
  });
  return { headerIdx: best.idx, colMap, score: best.score };
}

/**
 * Converte cells ({ colIndex → value }) em objeto com nomes de coluna.
 * Retorna null para linhas completamente vazias.
 *
 * IMPORTANTE: garante que TODAS as colunas do header existem no objeto
 * (preenchendo null para células omitidas no XML sparse). Sem isso, colunas
 * com valores vazios ficam ausentes de rows[0] e o validador falso-positiva
 * "Coluna obrigatória ausente".
 */
function cellsToNamedObj(cells, colMap, rowNum) {
  const obj = {};
  let hasData = false;
  // Itera o colMap em ordem de índice de coluna (não pelos dados presentes),
  // garantindo que a ordem das chaves do objeto reflita sempre a ordem original
  // do cabeçalho — mesmo quando o XML omite células vazias (arquivo sparse).
  const indices = Object.keys(colMap).map(Number).sort((a, b) => a - b);
  indices.forEach(ci => {
    const name = colMap[ci];
    const v = Object.prototype.hasOwnProperty.call(cells, ci) ? cells[ci] : null;
    obj[name] = v;
    if (v !== null && v !== undefined && v !== '') hasData = true;
  });
  if (!hasData) return null;
  obj['_linha_excel'] = rowNum;
  return obj;
}

/**
 * Faz streaming de uma entrada ZIP (aba do xlsx) e devolve Promise<rows[]>.
 * Deteta o cabeçalho nas primeiras 40 linhas; a partir daí converte
 * diretamente para objetos com nomes de coluna — sem acumular o XML inteiro.
 */
/**
 * Faz streaming de uma entrada ZIP (aba do xlsx) e devolve Promise<rows[]>.
 *
 * PROBLEMA QUE ISSO RESOLVE:
 * JSZip entrega chunks via microtask (Promise.resolve().then), que NÃO cede
 * ao loop de eventos do browser. Para arquivos com sheet XML > ~20 MB
 * descomprimido, o thread principal trava por 10-60s → "Page Unresponsive".
 *
 * SOLUÇÃO: a cada PAUSE_EVERY chunks, chamar stream.pause() + setTimeout(0),
 * que insere um macrotask real → browser respira, re-pinta e não trava.
 * Com 200 chunks/pausa e chunks de ~64 KB cada pausa ocorre a cada ~12 MB de
 * XML, gerando apenas ~38 pausas para um sheet de 493 MB. Overhead ≈ 38 ms.
 */
function streamSheetEntry(entry, sheetName, sharedStrings, onChunk) {
  return new Promise((resolve, reject) => {
    const result = [];
    let buf = '';
    let linesRead = 0;
    // Primeiras 40 linhas ficam em buffer até detetar o cabeçalho
    let pending = [];
    let headerIdx  = -1;
    let colMap     = {};
    let headerDone = false;

    function processRowXml(rowXml) {
      const parsed = parseRowXml(rowXml, sharedStrings);
      if (!parsed) return;
      linesRead++;
      if (onChunk && linesRead % 10000 === 0) onChunk(linesRead);

      if (!headerDone) {
        pending.push(parsed);
        if (pending.length >= 40) {
          ({ headerIdx, colMap } = detectHeaderStreaming(pending, sheetName));
          headerDone = true;
          for (let i = headerIdx + 1; i < pending.length; i++) {
            const obj = cellsToNamedObj(pending[i].cells, colMap, pending[i].rowNum);
            if (obj) result.push(obj);
          }
          pending = null;
        }
      } else {
        const obj = cellsToNamedObj(parsed.cells, colMap, parsed.rowNum);
        if (obj) result.push(obj);
      }
    }

    function processChunk(chunk) {
      buf += chunk;
      let end;
      while ((end = buf.indexOf('</row>')) !== -1) {
        const rowXml = buf.slice(0, end + 6);
        buf = buf.slice(end + 6);
        if (rowXml.includes('<row ') || rowXml.includes('<row>')) {
          processRowXml(rowXml);
        }
      }
    }

    const stream = entry.internalStream('string');
    const PAUSE_EVERY = 200; // chunks por batch antes de ceder ao event loop
    let chunkCount = 0;

    stream.on('data', chunk => {
      processChunk(chunk);
      chunkCount++;

      // A cada PAUSE_EVERY chunks força um MessageChannel tick — macrotask real
      // sem throttling de aba em background (ao contrário de setTimeout(0)).
      if (chunkCount % PAUSE_EVERY === 0) {
        stream.pause();
        const mc = new MessageChannel();
        mc.port1.onmessage = () => { try { stream.resume(); } catch(_) {} };
        mc.port2.postMessage(null);
      }
    });

    stream.on('end', () => {
      if (!headerDone && pending && pending.length > 0) {
        ({ headerIdx, colMap } = detectHeaderStreaming(pending, sheetName));
        for (let i = headerIdx + 1; i < pending.length; i++) {
          const obj = cellsToNamedObj(pending[i].cells, colMap, pending[i].rowNum);
          if (obj) result.push(obj);
        }
      }
      const mapa = buildColumnCanonicalMap();
      let score = 0;
      Object.values(colMap).forEach(name => {
        const chave = normalizarNomeColuna(name);
        if (mapa[chave]) score += 3;
      });
      resolve({ rows: result, score });
    });

    stream.on('error', reject);
    stream.resume();
  });
}

/**
 * Entry point do parser streaming.
 * Lê workbook.xml + rels para achar as abas, processa a melhor.
 * onProgress(pct 0-1, msg, detalhe) — callback de progresso.
 */
async function lerExcelStreaming(file, onProgress) {
  onProgress && onProgress(0.02, 'Abrindo arquivo…', `${(file.size/1024/1024).toFixed(1)} MB`);

  // Reutiliza buffer já lido anteriormente (evita re-leitura + descompressão JSZip que pode travar)
  const buffer = file.__rawBuffer ?? await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
  file.__rawBuffer = buffer;

  onProgress && onProgress(0.05, 'Extraindo estrutura do ZIP…', '');
  const zip = await JSZip.loadAsync(buffer);

  // ── Shared strings ──────────────────────────────────
  onProgress && onProgress(0.08, 'Carregando dicionário de strings…', '');
  const ssEntry = zip.file('xl/sharedStrings.xml');
  const sharedStrings = ssEntry
    ? await parseSharedStringsXmlAsync(await ssEntry.async('string'), n => {
        onProgress && onProgress(0.08, `Carregando strings\u2026 (${(n / 1000).toFixed(0)} k)`, 'Isso pode levar alguns segundos em arquivos grandes');
      })
    : [];

  // ── Mapeamento de abas ───────────────────────────────
  const wbXml   = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rels = Object.fromEntries(
    [...relsXml.matchAll(/\bId="([^"]+)"[^>]+\bTarget="([^"]+)"/g)].map(m => [m[1], m[2]])
  );
  const sheetEntries = [...wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)]
    .map(m => ({ name: m[1], rId: m[2] }))
    .sort((a, b) => (b.name.toUpperCase().includes('BASE') ? 1 : 0)
                  - (a.name.toUpperCase().includes('BASE') ? 1 : 0));

  // ── Processar abas ───────────────────────────────────
  let melhor = null;

  for (const sheet of sheetEntries) {
    const target = rels[sheet.rId];
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1)
               : target.startsWith('xl/') ? target : `xl/${target}`;
    const entry = zip.file(path);
    if (!entry) continue;

    onProgress && onProgress(0.12, `Lendo "${sheet.name}"…`, 'processando linhas…');

    const { rows, score } = await streamSheetEntry(entry, sheet.name, sharedStrings, done => {
      const pct = 0.12 + Math.min(done / 500000, 0.99) * 0.82;
      onProgress && onProgress(pct,
        `Lendo "${sheet.name}"…`,
        `${done.toLocaleString('pt-BR')} linhas processadas`);
    });

    const bonusBase = sheet.name.toUpperCase().includes('BASE') ? 10 : 0;
    const scoreFinal = score + bonusBase + Math.min(rows.length / 1000, 5);

    if (!melhor || scoreFinal > melhor.scoreFinal) {
      melhor = { rows, scoreFinal, aba: sheet.name };
    }
    if (melhor.scoreFinal > 40) break; // aba boa o suficiente, para
  }

  return melhor ? melhor.rows : [];
}

// ═══════════════════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════════════════
function showPage(id, navEl) {
  document.querySelectorAll('.val-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('val-page-' + id)?.classList.add('active');
  // Destaca o item de nav correto — por argumento ou buscando pelo onclick
  if (navEl) {
    navEl.classList.add('active');
  } else {
    document.querySelectorAll('.nav-item').forEach(n => {
      if ((n.getAttribute('onclick') || '').includes("'" + id + "'")) n.classList.add('active');
    });
  }
  // Atualiza a lista de arquivos pendentes na fila ao abrir a aba de Upload
  if (id === 'upload') {
    try { carregarFilaValidador(); } catch(e) {}
  }
  // Garante que a página de configuração sempre carrega as regras atualizadas
  if (id === 'config') {
    try {
      renderConfig();
      // Inicializa a aba de layout de colunas
      requestAnimationFrame(() => renderLayoutTab('FM', document.querySelector('.layout-tab')));
    } catch(e) { _dbgWarn('[showPage] renderConfig:', e); }
  }
  // Garante que a página de resultados sempre reflete o estado atual
  if (id === 'results') {
    try { renderResultados(); } catch(e) { _dbgWarn('[showPage] renderResultados:', e); }
  }
}

// ═══════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  adicionarArquivos([...e.dataTransfer.files]);
});
document.getElementById('file-input').addEventListener('change', e => {
  adicionarArquivos([...e.target.files]);
  e.target.value = '';
});

// Mapa nome-do-arquivo → operação de origem (preenchido quando o arquivo
// chega via "Validar agora" depois de Gerar). Usado pra devolver o arquivo
// validado/corrigido pra pasta certa em enviar/<op>/ e poder ir pro Consolidar.
const _origemOp = {};
function registrarOrigemOp(nome, op) { if (nome && op) _origemOp[nome] = op; }
window.registrarOrigemOp = registrarOrigemOp;

function _fmtTamanho(bytes){
  if(bytes==null) return '';
  if(bytes<1024) return bytes+' B';
  if(bytes<1024*1024) return (bytes/1024).toFixed(0)+' KB';
  return (bytes/1024/1024).toFixed(1)+' MB';
}

async function carregarFilaValidador(){
  const box=document.getElementById('val-fila-list');
  if(!box) return;
  box.innerHTML='<div style="padding:14px;color:var(--text3);font-size:12px"><span class="spin"></span> Carregando...</div>';
  try{
    const r=await _ajApiFetch('/api/validador/fila');
    const d=await r.json();
    const arquivos=(d && d.arquivos) || [];
    if(!arquivos.length){
      box.innerHTML='<div style="padding:14px;color:var(--text3);font-size:12px">Nenhum arquivo pendente em enviar/ no momento.</div>';
      return;
    }
    box.innerHTML=arquivos.map(a=>`
      <div class="val-fila-row" onclick="carregarArquivoDaFila('${a.op.replace(/'/g,"\\'")}','${a.nome.replace(/'/g,"\\'")}')">
        <span class="val-fila-op">${escHtml(a.op)}</span>
        <span class="val-fila-nome" title="${escHtml(a.nome)}">${escHtml(a.nome)}</span>
        <span class="val-fila-sz">${_fmtTamanho(a.tamanho)}</span>
        <span class="val-fila-load">⬇ carregar</span>
      </div>`).join('');
  }catch(e){
    box.innerHTML='<div style="padding:14px;color:var(--red);font-size:12px">Erro ao listar fila: '+e.message+'</div>';
  }
}

async function carregarArquivoDaFila(op, nome){
  try{
    const r=await _ajApiFetch(`/api/arquivo/${encodeURIComponent(op)}/${encodeURIComponent(nome)}`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const blob=await r.blob();
    const f=new File([blob],nome,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    registrarOrigemOp(nome, op);
    adicionarArquivos([f]);
    _toast('✅ '+nome+' carregado — clique em Validar arquivos.', 'ok', 3500);
  }catch(e){
    _toast('❌ Erro ao carregar arquivo: '+e.message, 'err', 6000);
  }
}
document.addEventListener('DOMContentLoaded', carregarFilaValidador);

function adicionarArquivos(files) {
  const novos = files.filter(f => /\.(xlsx|csv)$/i.test(f.name))
    .filter(f => !appState.files.find(x => x.name === f.name && x.size === f.size));

  // Avisa sobre arquivos muito grandes (>80 MB)
  const gigantes = novos.filter(f => f.size > 80 * 1024 * 1024);
  if (gigantes.length) {
    const nomes = gigantes.map(f => '  • ' + f.name + ' (' + (f.size/1024/1024).toFixed(0) + ' MB)').join('\n');
    _toast('⚠️ Arquivo(s) muito grandes detectados:\n' + nomes +
      '\nProcessamento ocorre em background. Pode levar alguns minutos.', 'warn', 8000);
  }

  novos.forEach(f => appState.files.push({ file: f, name: f.name, size: f.size, status: 'pending' }));
  renderFila();
}


window._atualizarBadgeFila = function _atualizarBadgeFila() {
  const badge = document.getElementById("badge-fila");
  if (!badge) return;
  const total = (window.appState && appState.files ? appState.files.length : 0);
  if (total <= 0) {
    badge.style.display = "none";
    badge.textContent = "";
  } else {
    badge.style.display = "inline-block";
    badge.textContent = total;
  }
}

function renderFila() {
  const q = document.getElementById('file-queue');
  q.innerHTML = appState.files.map((f, i) => {
    const mb = f.size / 1024 / 1024;
    const kb = f.size / 1024;
    const sizeLabel = mb >= 1 ? `${mb.toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
    // Badge de risco por tamanho
    const sizeBadge = mb >= 50
      ? `<span title="Arquivo muito grande — processamento pode ser lento" style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--red-dim);color:var(--red);font-weight:600">🔴 ${sizeLabel}</span>`
      : mb >= 10
      ? `<span title="Arquivo grande — pode levar alguns segundos" style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--yellow-dim);color:var(--yellow);font-weight:600">⚠ ${sizeLabel}</span>`
      : `<span class="fsize">${sizeLabel}</span>`;
    return `
    <div class="file-card">
      <span class="fname" title="${f.name}">${f.name}</span>
      ${sizeBadge}
      <span class="file-status ${f.status}" id="fstatus-${i}">
        ${f.status === 'pending' ? '⏳ aguardando' : f.status === 'running' ? '<span class="spinner"></span>validando…' : f.status}
      </span>
      <button class="btn-remove" onclick="removerArquivo(${i})">×</button>
    </div>`;
  }).join('');
  document.getElementById('btn-validate').disabled = appState.files.length === 0;
  _atualizarBadgeFila();
  const btnVer = document.getElementById('btn-ver-resultados');
  if (btnVer) btnVer.style.display = appState.results.length > 0 ? '' : 'none';
  document.getElementById('fila-status').textContent =
    appState.files.length ? `${appState.files.length} arquivo(s) na fila` : '';
}

function removerArquivo(i) {
  const cards = document.querySelectorAll('#file-queue .file-card');
  const card = cards[i];
  if (card) {
    card.style.transition = 'opacity .15s, transform .15s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(10px)';
    setTimeout(() => {
      appState.files.splice(i, 1);
      renderFila();
    }, 150);
  } else {
    appState.files.splice(i, 1);
    renderFila();
  }
}

function limparFila() {
  appState.files = [];
  renderFila();
}

// ═══════════════════════════════════════════════════════
// LEITURA DO EXCEL
// ═══════════════════════════════════════════════════════
function scoreHeaderRow(cells) {
  const mapa = buildColumnCanonicalMap();
  const vistos = new Set();
  let score = 0;

  (cells || []).forEach(c => {
    if (c === null || c === undefined || c === '') return;
    const chave = normalizarNomeColuna(c);
    if (mapa[chave]) {
      vistos.add(mapa[chave]);
      score += 3;
    } else if (String(c).trim().length > 0) {
      score += 0.05;
    }
  });

  // Colunas-chave aumentam bastante a confiança de que esta linha é o cabeçalho real.
  ['Operação','CNPJ Tomador','Frete/Tarifa Base (Peso/KM/Veículo)','Tarifa Aplicada','Valor Final à Receber','Base Calc ICMS/ISS','Valor ICMS/ISS','IMPOSTO']
    .forEach(c => { if (vistos.has(c)) score += 5; });

  return { score, encontrados: vistos.size };
}

function sheetToRowsDetectandoCabecalho(ws) {
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  if (!matrix || !matrix.length) return { rows: [], headerRowIndex: 0, score: 0, encontrados: 0 };

  let best = { idx: 0, score: -1, encontrados: 0 };
  const maxScan = Math.min(matrix.length, 40);

  for (let i = 0; i < maxScan; i++) {
    const aval = scoreHeaderRow(matrix[i]);
    if (aval.score > best.score) best = { idx: i, score: aval.score, encontrados: aval.encontrados };
  }

  const headersRaw = (matrix[best.idx] || []).map(h => h === null || h === undefined ? '' : String(h).trim());
  const headers = headersRaw.map((h, i) => h || `__coluna_vazia_${i + 1}`);
  const rows = [];

  for (let r = best.idx + 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const isEmpty = line.every(v => v === null || v === undefined || v === '');
    if (isEmpty) continue;

    const obj = {};
    headers.forEach((h, c) => {
      if (!h.startsWith('__coluna_vazia_')) obj[h] = line[c] ?? null;
    });
    obj['_linha_excel'] = r + 1;
    rows.push(obj);
  }

  return { rows, headerRowIndex: best.idx, score: best.score, encontrados: best.encontrados };
}

// ── lerExcelFallback: usa XLSX.js via Web Worker para não travar a UI ──────────
// O XLSX.read() é 100% síncrono; em arquivos grandes (+30 MB) bloqueia o thread
// principal por 30-120 s causando "Page Unresponsive". Rodando num Worker separado
// o browser continua responsivo durante todo o parsing.
async function lerExcelFallback(file) {
  // ── Código do Worker embutido como Blob (continua sendo 1 único arquivo HTML) ──
  const workerSrc = `
self.onmessage = function(ev) {
  var buffer = ev.data.buffer;
  var xlsxUrl = ev.data.xlsxUrl;
  try {
    importScripts(xlsxUrl);
  } catch(e) {
    self.postMessage({ error: 'Falha ao carregar XLSX.js no Worker: ' + e.message });
    return;
  }
  try {
    var data = new Uint8Array(buffer);
    var wb = XLSX.read(data, { type: 'array', raw: true, cellDates: false, dense: true });
    var sheetName = wb.SheetNames[0];
    wb.SheetNames.forEach(function(sn) { if (sn.toUpperCase().indexOf('BASE') !== -1) sheetName = sn; });
    var ws = wb.Sheets[sheetName];
    var matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false, raw: true });
    self.postMessage({ matrix: matrix, sheetName: sheetName });
  } catch(e) {
    self.postMessage({ error: e.message || String(e) });
  }
};`;

  const blob    = new Blob([workerSrc], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(blobUrl);

    const cleanup = () => { URL.revokeObjectURL(blobUrl); try { worker.terminate(); } catch(_){} };
    const done = (fn, val) => { if (settled) return; settled = true; cleanup(); fn(val); };

    worker.onmessage = function(ev) {
      if (ev.data.error) { done(reject, new Error(ev.data.error)); return; }

      // ── Detecção de cabeçalho e conversão matrix→rows no thread principal ──
      // (scoreHeaderRow e buildColumnCanonicalMap já estão no escopo global)
      try {
        const { matrix, sheetName } = ev.data;
        if (!matrix || !matrix.length) { done(resolve, []); return; }

        // Detecta a melhor linha de cabeçalho (mesma lógica de sheetToRowsDetectandoCabecalho)
        let best = { idx: 0, score: -1 };
        const maxScan = Math.min(matrix.length, 40);
        for (let i = 0; i < maxScan; i++) {
          const av = scoreHeaderRow(matrix[i]);
          if (av.score > best.score) best = { idx: i, score: av.score };
        }

        const headersRaw = (matrix[best.idx] || []).map(h =>
          (h === null || h === undefined) ? '' : String(h).trim());
        const headers = headersRaw.map((h, i) => h || ('__coluna_vazia_' + (i + 1)));

        const rows = [];
        for (let r = best.idx + 1; r < matrix.length; r++) {
          const line = matrix[r] || [];
          if (line.every(v => v === null || v === undefined || v === '')) continue;
          const obj = {};
          headers.forEach((h, c) => { if (!h.startsWith('__coluna_vazia_')) obj[h] = line[c] ?? null; });
          obj['_linha_excel'] = r + 1;
          rows.push(obj);
        }

        _dbg('[Fallback Worker] Aba:', sheetName, '| Linhas:', rows.length,
          '| Colunas:', rows[0] ? Object.keys(rows[0]).filter(k => !k.startsWith('_')).length : 0);
        done(resolve, rows);
      } catch(e) { done(reject, e); }
    };

    worker.onerror = function(e) {
      done(reject, new Error((e && e.message) || 'Erro no Web Worker'));
    };

    // ── Lê o arquivo e envia para o Worker com transferência zero-copy ──────
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        worker.postMessage(
          { buffer: e.target.result,
            xlsxUrl: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' },
          [e.target.result]   // Transferível — sem cópia de memória
        );
      } catch(err) { done(reject, err); }
    };
    reader.onerror = function(err) { done(reject, err); };

    // Reutiliza o buffer já lido pelo streaming, se disponível
    if (file.__rawBuffer) {
      try {
        // Buffer foi usado pelo streaming — precisa de nova leitura pois foi transferido
        reader.readAsArrayBuffer(file);
      } catch(_) { reader.readAsArrayBuffer(file); }
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
}

// ═══════════════════════════════════════════════════════
// PARSER CSV NATIVO
// Lê .csv diretamente — sem conversão para XLSX.
// Auto-detecta delimitador (;  ,  \t  |) e linha de cabeçalho.
// Suporta campos com aspas (RFC 4180) e BOM UTF-8.
// ═══════════════════════════════════════════════════════
async function lerCsv(file, onProgress) {
  onProgress && onProgress(0.02, 'Lendo CSV…', `${(file.size / 1024 / 1024).toFixed(1)} MB`);

  // ── Leitura como texto (UTF-8; fallback latin-1 em caso de erro) ──────────
  let text;
  try {
    text = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsText(file, 'UTF-8');
    });
  } catch(_) {
    text = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsText(file, 'windows-1252');
    });
  }

  // Remove BOM UTF-8 se presente
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // ── Auto-detecção de delimitador ──────────────────────────────────────────
  const sample = text.slice(0, 4000).split('\n')[0] || '';
  const DELIMS = [';', ',', '\t', '|'];
  let delim = ',';
  let maxCols = 0;
  for (const d of DELIMS) {
    const cnt = sample.split(d).length;
    if (cnt > maxCols) { maxCols = cnt; delim = d; }
  }
  _dbg('[CSV] Delimitador detectado:', JSON.stringify(delim), '| colunas aprox.:', maxCols);

  // ── Parser de linha com suporte a aspas (RFC 4180) ────────────────────────
  function parseLine(line) {
    const fields = [];
    let i = 0, field = '', inQ = false;
    while (i < line.length) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; } // aspas duplas escapadas
          inQ = false; i++; continue;
        }
        field += c; i++;
      } else {
        if (c === '"')  { inQ = true; i++; continue; }
        if (c === delim) { fields.push(field); field = ''; i++; continue; }
        field += c; i++;
      }
    }
    fields.push(field);
    return fields;
  }

  onProgress && onProgress(0.08, 'Dividindo linhas…', '');
  await yieldToUI();

  // ── Dividir em linhas (normaliza \r\n e \r) ────────────────────────────────
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // ── Parsing em chunks com yield ───────────────────────────────────────────
  const matrix = [];
  const CHUNK  = 10000;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // Ignora linhas completamente vazias
    if (!line || !line.trim()) continue;
    matrix.push(parseLine(line));
    if (i % CHUNK === CHUNK - 1) {
      const pct = 0.08 + (i / rawLines.length) * 0.40;
      onProgress && onProgress(pct, `Lendo linhas… (${i.toLocaleString('pt-BR')})`, '');
      await yieldToUI();
    }
  }

  if (!matrix.length) return [];

  // ── Detecção de cabeçalho (mesma lógica do parser XLSX) ──────────────────
  onProgress && onProgress(0.50, 'Detectando cabeçalho…', '');
  await yieldToUI();

  let best = { idx: 0, score: -1 };
  const maxScan = Math.min(matrix.length, 40);
  for (let i = 0; i < maxScan; i++) {
    const av = scoreHeaderRow(matrix[i]);
    if (av.score > best.score) best = { idx: i, score: av.score };
  }

  const headers = (matrix[best.idx] || []).map((h, ci) => {
    const s = String(h ?? '').trim();
    return s || ('__coluna_vazia_' + (ci + 1));
  });

  // ── Conversão matrix → objetos de linha (chunked) ────────────────────────
  const rows = [];
  for (let r = best.idx + 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every(v => v === null || v === undefined || String(v).trim() === '')) continue;
    const obj = {};
    headers.forEach((h, c) => {
      if (h.startsWith('__coluna_vazia_')) return;
      const raw = line[c] !== undefined ? line[c] : null;
      // Tenta preservar tipo: número quando possível
      obj[h] = raw;
    });
    obj['_linha_excel'] = r + 1;
    rows.push(obj);
    if ((r - best.idx) % CHUNK === CHUNK - 1) {
      const pct = 0.55 + ((r - best.idx) / (matrix.length - best.idx)) * 0.40;
      onProgress && onProgress(pct, `Convertendo linhas… (${(r - best.idx).toLocaleString('pt-BR')})`, '');
      await yieldToUI();
    }
  }

  _dbg('[CSV] Aba: (CSV) | Linhas:', rows.length,
    '| Delim:', JSON.stringify(delim),
    '| Cabeçalho na linha:', best.idx + 1,
    '| Score:', best.score.toFixed(1));

  return rows;
}

// ── lerExcel: CSV nativo → streaming XLSX → fallback XLSX.js ──────────────
function lerExcel(file) {
  // CSV: parser dedicado, sem conversão e sem dependência de XLSX.js
  if (/\.csv$/i.test(file.name)) {
    return lerCsv(file, (pct, msg, det) => atualizarProgresso(pct, msg, det))
      .then(rows => {
        // Marca aba como CSV para o export
        lerExcel.__lastSheetName = 'CSV';
        rows.slice(0, 100).forEach(r =>
          Object.keys(r).filter(c => !String(c).startsWith('_'))
                        .forEach(c => appState.observedColumns.add(c))
        );
        popularCamposRegrasCustomizadas();
        return rows;
      });
  }

  return lerExcelStreaming(file, (pct, msg, det) => atualizarProgresso(pct, msg, det))
    .then(async rows => {
      if (rows.length === 0) {
        // Streaming falhou (comum em arquivos LM que não usam inlineStr)
        _dbgWarn('[Parser] Streaming retornou 0 linhas → tentando XLSX.js fallback');
        atualizarProgresso(0.5, 'Usando parser alternativo (LM/formato especial)…', 'Streaming retornou 0 linhas');
        try {
          rows = await lerExcelFallback(file);
          if (rows.length > 0) {
            _toast(`✅ Parser alternativo: ${rows.length.toLocaleString('pt-BR')} linhas lidas`, 'ok');
          } else {
            _toast('⚠️ Parser alternativo também retornou 0 linhas. Verifique o arquivo.', 'warn');
          }
        } catch(fbErr) {
          console.error('[Fallback XLSX.js] erro:', fbErr);
          _toast('⚠️ Erro no parser alternativo: ' + fbErr.message, 'warn');
        }
      }
      // Only scan first 100 rows for column discovery — all rows have same columns
      rows.slice(0, 100).forEach(r =>
        Object.keys(r).filter(c => !String(c).startsWith('_'))
                      .forEach(c => appState.observedColumns.add(c))
      );
      popularCamposRegrasCustomizadas();
      return rows;
    });
}

// ═══════════════════════════════════════════════════════
// VALIDAÇÕES
// ═══════════════════════════════════════════════════════
const BADGE_CAT = {
  'ICMS/ISS':'err','Base Negativa':'err','Segunda Saída':'err','CNPJ':'err',
  'Alíquota':'err','Observações':'err','Domingo/Feriado':'err','Domingo':'err','Feriado':'err','Estrutura':'err',
  "Big's Infrutífera":'err','GRIS':'err','Regra Customizada':'err',
  'CNPJ Tomador':'warn','Isenção SP':'warn','Tarifa Base':'warn',
  'Valor Final':'warn','Regra Customizada (Alerta)':'warn',
};
const CAT_LABEL = {
  'ICMS/ISS':'Divergência ICMS/ISS',
  'Base Negativa':'Base de cálculo negativa',
  'Segunda Saída':'Desconto 2ª Saída inválido',
  'CNPJ':'CNPJ Emitente inválido',
  'CNPJ Tomador':'CNPJ Tomador divergente',
  'Alíquota':'Alíquota de imposto inválida',
  'Observações':'Outros Valores ≠ Observações',
  'Domingo/Feriado':'Adicional domingo/feriado ausente',
  'Domingo':'Adicional de domingo ausente',
  'Feriado':'Adicional de feriado ausente',
  'Estrutura':'Colunas ausentes / estrutura',
  'Isenção SP':'Isenção ICMS — origem SP',
  "Big's Infrutífera":"Big's Infrutífera",
  'Tarifa Base':'Tarifa base inconsistente',
  'Valor Final':'Valor Final divergente',
  'GRIS':'GRIS fora da faixa',
  'Regra Customizada':'Regra customizada — crítico',
  'Regra Customizada (Alerta)':'Regra customizada — alerta',
};

function reg(cat, linha, trip, desc, det = '', br = '') {
  return { cat, linha: linha ?? '—', trip: trip ?? '—', desc, det, br };
}
// Helper: get BR tracking number from row
function getBR(r) {
  return String(r['3PL Tracking Number / Número Etiqueta / Ordem (Shopee)'] || '').trim();
}

function n(v) { return v === null || v === undefined || v === '' ? null : v; }

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim();
  // Formato BR: 1.234,56 — ponto como separador de milhar, vírgula como decimal
  // CORREÇÃO: só ativa formato BR quando há vírgula presente (sem vírgula, ponto = decimal)
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+(,\d+)$/.test(s)) {
    const x = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return isNaN(x) ? null : x;
  }
  // Formato US ou número simples: 1234.56
  const x = parseFloat(s.replace(',', ''));
  return isNaN(x) ? null : x;
}


function normalizarAliquotaPercentual(v) {
  const x = num(v);
  if (x === null) return null;
  // Aceita tanto 12 quanto 0.12 como 12%, e 5 quanto 0.05 como 5%.
  if (Math.abs(x) > 0 && Math.abs(x) <= 1) return x * 100;
  return x;
}

function normalizarAliquotaTaxa(v) {
  const pct = normalizarAliquotaPercentual(v);
  return pct === null ? 0 : pct / 100;
}

function roundAliquotaPct(v) {
  return Math.round((v ?? 0) * 1000000) / 1000000;
}

function aliquotaValidaNoSet(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return false;
  const alvo = roundAliquotaPct(pct);
  for (const v of CFG.aliquotas_validas) {
    if (Math.abs(roundAliquotaPct(v) - alvo) <= 0.000001) return true;
  }
  return false;
}

function limparCnpj(v) {
  if (v === null || v === undefined || v === '') return '';
  // Número JS inteiro: String() preserva todos os dígitos exatos (CNPJ cabe em Number.MAX_SAFE_INTEGER)
  if (typeof v === 'number') {
    if (!isNaN(v) && isFinite(v)) return String(Math.round(v)).replace(/\D/g, '');
    return '';
  }
  return String(v).replace(/\D/g, '');
}

function isBigsRow(r) {
  const op = String(r['Operação'] ?? '').toUpperCase().trim();
  const transp = String(r['Nome Transportadora (3PL)'] ?? '').toUpperCase().trim();
  return (
    op.includes('BIGS') ||
    op.includes("BIG'S") ||
    transp.includes('BIGS') ||
    transp.includes("BIG'S")
  );
}

function isFirstMileRow(r) {
  const op = String(r['Operação'] ?? '').toUpperCase().trim();

  // Família FM: FM, FMH, First Mile, First Mile Hub e FM Big's.
  // Big's pode vir indicado na Operação ou no nome da transportadora.
  return (
    op === 'FM' ||
    op === 'FMH' ||
    op.includes('FIRST MILE') ||
    isBigsRow(r)
  );
}

function isLineHaulRow(r) {
  const op = String(r['Operação'] ?? '').toUpperCase();
  return op.includes('LINE') || op.includes('LINE HAUL') || op.includes('LINEHAUL');
}

function isAirHaulRow(r) {
  const op     = String(r['Operação'] ?? '').toUpperCase();
  const transp = String(r['Nome Transportadora (3PL)'] ?? '').toUpperCase();
  const veiculo= String(r['Tipo do Veículo'] ?? '').toUpperCase();
  return op.includes('AIR') || transp.includes('AZUL') || transp.includes('LATAM') ||
         transp.includes('GOL') || veiculo.includes('AIR') || veiculo.includes('AVIAO') ||
         veiculo.includes('AVIÃO');
}

function isLastMileRow(r) {
  const op = String(r['Operação'] ?? '').toUpperCase();
  return op.includes('LAST MILE') || op.includes('LAST');
}

function getFreteBase(r, temFn) {
  if (!temFn || temFn('Frete/Tarifa Base (Peso/KM/Veículo)')) {
    const v = num(r['Frete/Tarifa Base (Peso/KM/Veículo)']);
    if (v !== null) return v;
  }
  const t = num(r['Tarifa Aplicada']);
  return t ?? 0;
}

function getTextField(r, names) {
  for (const name of names) {
    if (r[name] !== null && r[name] !== undefined && r[name] !== '') return String(r[name]);
  }
  return '';
}

function parseDatePrefat(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2])-1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// Retorna o nome do feriado nacional ou null se não for feriado
function nomeFeriadoBR(date) {
  if (!date) return null;
  const fixed = {
    '01-01': 'Confraternização Universal',
    '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalho',
    '09-07': 'Independência do Brasil',
    '10-12': 'N. Sra. Aparecida',
    '11-02': 'Finados',
    '11-15': 'Proclamação da República',
    '11-20': 'Consciência Negra',
    '12-25': 'Natal',
  };
  const md = `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  if (fixed[md]) return fixed[md];
  const easter = easterDate(date.getFullYear());
  const movable = {
    [ymd(addDays(easter, -48))]: 'Carnaval (segunda-feira)',
    [ymd(addDays(easter, -47))]: 'Carnaval (terça-feira)',
    [ymd(addDays(easter, -2))]:  'Sexta-feira Santa',
    [ymd(addDays(easter, 60))]:  'Corpus Christi',
  };
  return movable[ymd(date)] || null;
}

function isFeriadoBR(date) {
  return nomeFeriadoBR(date) !== null;
}

function isDomingoOuFeriadoRow(r) {
  // Regra oficial: usar exclusivamente "Data da Prestação do Serviço".
  // Considera domingo, feriado nacional E feriado estadual da UF Origem.
  const rawDate = r['Data da Prestação do Serviço'];
  const d = parseDatePrefat(rawDate);
  if (!d) return { ok: false, motivo: 'Data da Prestação do Serviço não identificada', data: null };

  const domingo = d.getDay() === 0;
  if (domingo) return { ok: true, motivo: 'Domingo', nomeFeriado: 'Domingo', data: d };

  const nomeFerNac = nomeFeriadoBR(d);
  if (nomeFerNac) return { ok: true, motivo: 'feriado nacional', nomeFeriado: nomeFerNac, data: d };

  // Feriado estadual da UF Origem
  const uf = String(r['UF Origem'] || '').trim().toUpperCase();
  if (uf && FERIADOS_ESTADUAIS[uf]) {
    const mmdd = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const nomeFerEst = FERIADOS_ESTADUAIS[uf][mmdd];
    if (nomeFerEst) {
      return { ok: true, motivo: `feriado estadual (${uf})`, nomeFeriado: nomeFerEst, data: d };
    }
  }

  return { ok: false, motivo: '', data: d };
}

function extrairIncentivos(texto) {
  const s = String(texto || '');
  const itens = [];

  // Captura pares no formato "Nome do item: 12.34" separados por ; ou |.
  // Para LH, entram na soma: Holiday Pay, Incentivo de Combustível,
  // Incentivo de domingo/feriado e demais campos que contenham "incentivo".
  // Não soma campos de conferência como "Outros Valores Total", para não duplicar.
  const partes = s.split(/\s+_\s+|[;|]/g);
  partes.forEach(parte => {
    const m = String(parte).match(/^\s*([^:]+?)\s*:\s*(-?\d+(?:[\.,]\d+)?(?:[Ee][+\-]?\d+)?)\s*$/i);
    if (!m) return;
    const nome = m[1].trim();
    const nomeNorm = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/outros\s+valores\s+total|total\s+outros\s+valores|total$/i.test(nomeNorm)) return;

    const deveSomar = (
      nomeNorm.includes('incentivo') ||
      nomeNorm.includes('holiday pay') ||
      nomeNorm.includes('domingo') ||
      nomeNorm.includes('feriado') ||
      nomeNorm.includes('domingos') ||
      nomeNorm.includes('feriados')
    );
    if (!deveSomar) return;

    const valor = num(m[2]);
    if (valor !== null) itens.push({ nome, valor });
  });

  return itens;
}

function extrairIncentivoDomingoFeriado(texto) {
  const itens = extrairIncentivos(texto);
  return itens
    .filter(x => /domingo|feriado/i.test(x.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    .reduce((s, x) => s + x.valor, 0);
}

function extrairComponentesOutrosValores(texto) {
  const s = String(texto || '');
  const itens = [];
  const partes = s.split(/\s+_\s+|[;|]/g);
  partes.forEach(parte => {
    const m = String(parte).match(/\s*([^:]+?)\s*:\s*(-?\d+(?:[\.,]\d+)?(?:[Ee][+\-]?\d+)?)/i);
    if (!m) return;
    const nome = m[1].trim();
    const nomeNorm = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/total|flag|risco|status|solicitacao|programacao|observacao|motivo|vencimento/i.test(nomeNorm)) return;
    const deveSomar = (
      nomeNorm.includes('incentivo') ||
      nomeNorm.includes('ajudante') ||
      nomeNorm.includes('helper') ||
      nomeNorm.includes('holiday pay') ||
      nomeNorm.includes('combustivel') ||
      nomeNorm.includes('domingo') ||
      nomeNorm.includes('feriado') ||
      nomeNorm.includes('adicional') ||
      nomeNorm.includes('pedagio') ||
      nomeNorm.includes('toll')
    );
    if (!deveSomar) return;
    const valor = num(m[2]);
    if (valor !== null) itens.push({ nome, valor });
  });
  return itens;
}

function getChaveAgregacaoFiscal(r, temFn) {
  const cnpj = r['CNPJ Tomador'] ?? '';
  const deferral = temFn && temFn('active_deferral') ? (r['active_deferral'] ?? '') : '';

  // Regra de chave por operação:
  // FM/FM Big's: Rota
  // LH: Rota + CNPJ Tomador + active_deferral
  // LM/LM Hub: Fator Agrupador + CNPJ Tomador
  if (isLineHaulRow(r)) {
    const rota = r['Rota'] ?? r['id_rota'] ?? '';
    return `LH|Rota=${rota}|CNPJ=${cnpj}|Deferral=${deferral}`;
  }
  if (isLastMileRow(r)) {
    const fator = r['Fator Agrupador (p/ Cobrança por Veiculo)'] ?? r['id_rota'] ?? r['Rota'] ?? '';
    return `LM|Fator=${fator}|CNPJ=${cnpj}`;
  }
  if (isFirstMileRow(r)) {
    const rota = r['Rota'] ?? r['id_rota'] ?? '';
    return `FM|Rota=${rota}`;
  }

  const rotaGenerica = r['Rota'] ?? r['id_rota'] ?? r['Fator Agrupador (p/ Cobrança por Veiculo)'] ?? '';
  return `OUTROS|Chave=${rotaGenerica}|CNPJ=${cnpj}`;
}

// Mapa de aliases: nome canônico → variações aceitas
const COL_ALIASES = {
  'Tipo do Serviço': ['Tipo Do Serviço', 'Tipo do Servico', 'Tipo Do Servico'],
  'Operação': ['Operacao', 'operação', 'operation', 'Operacao'],
  'SOC': ['Soc', 'soc', 'XD', 'xd'],
  'Hub': ['HUB', 'hub'],
  'Rota': ['ROTA', 'rota'],
  'Período (Ano_Mês_Quinzena)': ['Periodo (Ano_Mes_Quinzena)', 'Período Ano Mês Quinzena', 'Periodo Ano Mes Quinzena'],
  '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)': [
    '3Pl Tracking Number / Número Etiqueta / Ordem (Shopee)',
    '3PL Tracking Number / Numero Etiqueta / Ordem (Shopee)',
    '3Pl Tracking Number / Numero Etiqueta / Ordem (Shopee)',
    'tracking_no', 'Tracking No'
  ],
  '3PL Tracking Number (Enviado por API pela Transportadora)': [
    '3Pl Tracking Number (Enviado Por Api Pela Transportadora)',
    '3PL Tracking Number (Enviado por Api pela Transportadora)',
    'Thirdpltrackingnumber'
  ],
  'Data da Prestação do Serviço': ['Data Da Prestação Do Serviço', 'Data da Prestacao do Servico', 'Data Da Prestacao Do Servico'],
  'Nome Tomador do Serviço': ['Nome Tomador Do Serviço', 'Nome Tomador do Servico', 'Nome Tomador Do Servico'],
  'CNPJ Tomador': ['Cnpj Tomador', 'CNPJ Tomador do Serviço', 'Cnpj Tomador Do Serviço'],
  'Nome Transportadora (3PL)': ['Nome Transportadora (3Pl)', 'Nome Transportadora 3PL', 'Nome Transportadora 3Pl', 'Transportadora'],
  'CNPJ Emitente (3PL)': ['Cnpj Emitente (3Pl)', 'CNPJ Emitente (3PL)', 'Cnpj Emitente 3Pl'],
  'CEP Origem': ['Cep Origem'],
  'Cidade Origem': ['cidade_origem'],
  'UF Origem': ['Uf Origem', 'UF de Origem'],
  'UF Origem pacote': ['Uf Origem Pacote', 'UF Origem Pacote', 'uf_origem_pacote', 'UF Origem do Pacote', 'Uf Origem Do Pacote'],
  'CEP Entrega': ['Cep Entrega'],
  'Cidade Entrega': ['cidade_entrega'],
  'UF Entrega': ['Uf Entrega'],
  'Dados do Seller': ['Dados Do Seller'],
  'Data da Entrega': ['Data Da Entrega'],
  'Quantidade Volume': ['qtd volume', 'Quantidade Volumes'],
  'Peso Real': ['peso_real'],
  'Peso Cubado': ['peso_cubado'],
  'Peso Calculado/Cobrado': ['Peso Calculado Cobrado', 'Peso Calculado Cobrado'],
  'KM Rodado': ['Km Rodado', 'km_rodado'],
  'Tipo do Veículo': ['Tipo Do Veículo', 'Tipo do Veiculo', 'Tipo Do Veiculo'],
  'Fator Agrupador (p/ Cobrança por Veiculo)': [
    'Fator Agrupador (P/ Cobrança Por Veiculo)',
    'Fator Agrupador (p/ Cobrança por Veículo)',
    'Fator Agrupador', 'fator_agrupador'
  ],
  'Placa': ['PLACA'],
  'Valor nota Fiscal Mercadoria': ['Valor Nota Fiscal Mercadoria', 'Valor NF Mercadoria'],
  'Tarifa Aplicada': ['tarifa_aplicada'],
  'Basic Shipping Fee': ['basic_fee', 'Basic Fee', 'Shipping Fee Básico'],
  'Frete/Tarifa Base (Peso/KM/Veículo)': [
    'Frete/Tarifa Base (Peso/Km/Veículo)',
    'Frete/Tarifa Base (Peso/KM/Veiculo)',
    'Frete/Tarifa Base (Peso/Km/Veiculo)',
    'Frete/Tarifa Base', 'Frete Tarifa Base', 'Tarifa Base'
  ],
  'Frete Calculado': ['frete_calculado'],
  'ADV': ['Adv', 'adv'],
  'GRIS': ['Gris', 'gris', 'GRIS ', ' Gris', 'G R I S', 'Grís'],
  'GRIS %': ['Gris %', 'GRIS Percentual', 'Perc GRIS', 'Percentual GRIS', 'gris_perc', 'gris_prc', 'gris_percent'],
  'Tarifa de Espera': ['Tarifa De Espera', 'Waiting Fee'],
  'Aliquota ICMS/ISS': ['Alíquota ICMS/ISS', 'Aliquota Icms/Iss', 'Alíquota Icms/Iss', 'Aliquota ICMS ISS', 'Alíquota ICMS ISS'],
  'IMPOSTO': ['Imposto', 'imposto', 'Tipo Imposto', 'Imposto ICMS/ISS'],
  'Base Calc ICMS/ISS': ['Base Calc Icms/Iss', 'Base Cálculo ICMS/ISS', 'Base Calculo ICMS/ISS', 'Base Calc ICMS ISS'],
  'Valor ICMS/ISS': ['Valor Icms/Iss', 'Valor ICMS ISS'],
  'ICMS Subst': ['Icms Subst'],
  'Outros Valores': ['Outros valores'],
  'Descontos': ['descontos'],
  'Valor Final à Receber': ['Valor Final À Receber', 'Valor Final A Receber', 'Valor Final a Receber'],
  'Data Emissão Cte/NF': ['Data Emissão Cte/Nf', 'Data Emissao Cte/NF', 'Data Emissao Cte/Nf'],
  'Fatura': ['fatura'],
  'Número Cte': ['Numero Cte'],
  'Número NF': ['Número Nf', 'Numero NF', 'Numero Nf'],
  'Serie Cte/ Nf': ['Série Cte/NF', 'Serie Cte/NF', 'Serie Cte/ Nf'],
  'Chave de Acesso Cte': ['Chave De Acesso Cte'],
  'Motivo Rejeição CTE': ['Motivo Rejeição Cte', 'Motivo Rejeicao CTE', 'Motivo Rejeicao Cte'],
  'Prefeitura NFSe': ['Prefeitura Nfse', 'Prefeitura NFS-e'],
  'Comentários': ['Comentarios', 'Comentário', 'Comentario'],
  'De acordo (Sim/Não)': ['De Acordo (Sim/Não)', 'De acordo Sim Não', 'De Acordo Sim Nao'],
  'Motivo (Valor incorreto/número de ordens incorreta no protocolo)': [
    'Motivo (Valor Incorreto/Número De Ordens Incorreta No Protocolo)',
    'Motivo (Valor incorreto/numero de ordens incorreta no protocolo)'
  ],
  'Valor Negociado (Caso para valor incorreto)': ['Valor Negociado (Caso Para Valor Incorreto)'],
  'Observações': ['Observacoes', 'Observação', 'Observacao'],
  'id_rota': ['ID Rota', 'Id_Rota', 'Id Rota'],
  'Tipo da Rota': ['Tipo Da Rota', 'Tipo Rota', 'tipo_da_rota', 'Tipo de Rota'],
  'active_deferral': ['Active Deferral', 'active deferral', 'Flag Deferral'],
  'Flag Agrupamento Misto': ['flag_agrupamento_misto']
};

function normalizarNomeColuna(nome) {
  return String(nome ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, '');
}

let _canonicalMapCache = null;
let _canonicalMapCacheKey = '';

function buildColumnCanonicalMap() {
  // Chave de cache: número de colunas obrigatórias + regras customizadas
  // Muda se o usuário adicionar/remover colunas na config
  // FIX: inclui contagem de regras customizadas no cache key para invalidar
  // quando o usuário adicionar campos em regras customizadas
  const customCols = (window._customRules || []).map(r => r.campo || '').join('|');
  const cacheKey = (CFG.colunasObrigatorias || []).join('|') + '::' + customCols;
  if (_canonicalMapCache && cacheKey === _canonicalMapCacheKey) return _canonicalMapCache;
  _canonicalMapCacheKey = cacheKey;

  const candidates = new Set([
    ...DEFAULT_COLUMN_OPTIONS,
    ...(CFG.colunasObrigatorias || []),
    ...Object.keys(COL_ALIASES)
  ]);

  const mapa = {};
  candidates.forEach(canonico => { mapa[normalizarNomeColuna(canonico)] = canonico; });
  Object.entries(COL_ALIASES).forEach(([canonico, aliases]) => {
    mapa[normalizarNomeColuna(canonico)] = canonico;
    aliases.forEach(alias => { mapa[normalizarNomeColuna(alias)] = canonico; });
  });

  _canonicalMapCache = mapa;
  return mapa;
}

// Normaliza rows: substitui variações de nome pelo nome canônico
function normalizarColunas(rows) {
  if (!rows.length) return rows;

  const mapaCanonico = buildColumnCanonicalMap();

  return rows.map(row => {
    const novo = {};

    for (const [k, v] of Object.entries(row)) {
      // Campos internos do validador permanecem iguais.
      if (String(k).startsWith('_')) {
        novo[k] = v;
        continue;
      }

      const chave = normalizarNomeColuna(k);
      const destino = mapaCanonico[chave] || String(k).trim();

      // Se duas colunas caírem no mesmo nome canônico, preserva o primeiro valor preenchido.
      // Isso evita perder dados quando o Excel vem com colunas duplicadas ou com header variante.
      if (!(destino in novo) || novo[destino] === null || novo[destino] === undefined || novo[destino] === '') {
        novo[destino] = v;
      }
    }

    novo.__normalizado = true; // marca para skip em re-validações
    return novo;
  });
}

async function validarArquivo(rows, nome) {
  // Se as rows já foram normalizadas (têm _normalizado), skip normalizarColunas
  // Skip normalização se rows já foram normalizadas (preserva correções do Ajustar Prefat)
  rows = (rows.length > 0 && rows[0] && rows[0].__normalizado === true) ? rows : normalizarColunas(rows);
  validarArquivo.__lastNormalizedRows = rows; // expõe pós-normalização para quem chamou
  const erros = [];
  // Usa união das primeiras 50 linhas para detectar colunas — evita falso
  // "coluna ausente" quando rows[0] não tem células preenchidas em todas as colunas
  const colsSet = new Set();
  rows.slice(0, 50).forEach(r => Object.keys(r).filter(c => !c.startsWith('_')).forEach(c => colsSet.add(c)));
  const cols = [...colsSet];
  const colsNorm = new Map([...colsSet].map(c => [normalizarNomeColuna(c), c]));
  const tem = c => colsSet.has(c) || colsNorm.has(normalizarNomeColuna(c));

  // ── Estrutura e colunas por operação ─────────────────────────────────────
  // Guarda de segurança: parser retornou arquivo vazio
  if (colsSet.size < 5) {
    erros.push(reg('Estrutura', null, null,
      '⚠️ Arquivo não lido corretamente — menos de 5 colunas detectadas',
      `Colunas detectadas: ${colsSet.size}. Verifique se o arquivo é XLSX válido.`
    ));
    return erros;
  }

  // Validação de colunas por operação (FM / LH / LM)
  if (CFG.regras.colunas_ausentes && CFG.regras.colunas_ausentes.on) {
    const opDetectada = detectarOperacaoArquivo(rows, nome);
    const layout      = opDetectada ? COLUNAS_POR_OPERACAO[opDetectada] : null;

    if (layout) {
      const SKIP    = new Set(['__normalizado','__op_key__','_linha_excel','__source']);
      const normFile = new Map([...colsSet]
        .filter(c => !c.startsWith('_') && !SKIP.has(c))
        .map(c => [normalizarNomeColuna(c), c]));
      const normLayout = new Map(layout.map(c => [normalizarNomeColuna(c), c]));

      // Colunas do layout ausentes no arquivo
      const faltando = layout.filter(c => !normFile.has(normalizarNomeColuna(c)));
      if (faltando.length > 0) {
        const dicasPosicao = faltando.map(col => {
          const pos = layout.indexOf(col) + 1;
          const ant = layout[layout.indexOf(col) - 1];
          return ant ? `'${col}' (posição ${pos}, após '${ant}')` : `'${col}' (posição ${pos})`;
        }).join(' · ');
        erros.push(reg('Estrutura', null, null,
          `[${opDetectada}] ${faltando.length} coluna(s) ausente(s) do layout oficial`,
          `Adicione ao arquivo: ${dicasPosicao}`
        ));
      }

      // Colunas no arquivo fora do layout desta operação
      const extras = [...normFile.keys()]
        .filter(k => !normLayout.has(k))
        .map(k => normFile.get(k));
      if (extras.length > 0) {
        erros.push(reg('Estrutura', null, null,
          `[${opDetectada}] ${extras.length} coluna(s) não prevista(s) no layout`,
          `Colunas extras: ${extras.join(' · ')} — confirme se o arquivo é da operação correta`
        ));
      }
    }
  }

  // ── CNPJ Tomador ─────────────────────────────────────
  if (tem('CNPJ Tomador')) {
    // Normaliza CNPJs na leitura: converte notação científica (4.24463E+13) para string completa
    const vals = [...new Set(
      rows.map(r => limparCnpj(r['CNPJ Tomador'])).filter(v => v !== '')
    )];
    if (CFG.regras.cnpj_tomador.on) {
      if (vals.length === 0)
        erros.push(reg('CNPJ', null, null, 'CNPJ Tomador: coluna inteiramente nula'));
      else if (vals.length === 1)
        erros.push(reg('CNPJ Tomador', null, null,
          `CNPJ Tomador com valor único: ${vals[0]}`,
          'O arquivo deveria conter mais de um CNPJ Tomador.'));
      // vals.length > 1 é o comportamento correto — nenhuma ocorrência gerada
    }
    if (CFG.regras.cnpj_invalido.on) {
      vals.forEach(limpo => {
        const invalido = CFG.cnpjsInvalidos.find(x => limparCnpj(x.cnpj) === limpo);
        if (invalido) erros.push(reg('CNPJ', null, null, `CNPJ Tomador encerrado/inválido: ${limpo}`, invalido.msg));
      });
    }
    // ── CNPJ Tomador deve iniciar com 42 ─────────────────
    if (CFG.regras.cnpj_prefixo_42 && CFG.regras.cnpj_prefixo_42.on) {
      const cnpjsErrados = new Set();
      rows.forEach(r => {
        const cnpjRaw = limparCnpj(r['CNPJ Tomador']);
        if (!cnpjRaw || cnpjsErrados.has(cnpjRaw)) return;
        if (!cnpjRaw.startsWith('42')) {
          cnpjsErrados.add(cnpjRaw);
          const qtd = rows.filter(x => limparCnpj(x['CNPJ Tomador']) === cnpjRaw).length;
          erros.push(reg('CNPJ Tomador', null, null,
            `CNPJ Tomador não inicia com 42: ${cnpjRaw}`,
            `${qtd} linha(s) afetada(s) | Prefixo encontrado: ${cnpjRaw.substring(0, 2) || '(vazio)'}`));
        }
      });
    }
  }

  // ── Alíquota ─────────────────────────────────────────
  if (tem('Aliquota ICMS/ISS')) {
    const impostoPorAliq = { 5: 'ISS', 12: 'ICMS', 0: null };

    rows.forEach(r => {
      const aliqRaw = num(r['Aliquota ICMS/ISS']);
      const aliqPct = normalizarAliquotaPercentual(r['Aliquota ICMS/ISS']);
      const aliqKey = aliqPct === null ? null : roundAliquotaPct(aliqPct);
      const imposto = r['IMPOSTO'];

      if (CFG.regras.aliquota_invalida.on && aliqPct !== null && !aliquotaValidaNoSet(aliqPct))
        erros.push(reg('Alíquota', r._linha_excel, r['id_rota'],
          `Alíquota inválida: ${aliqRaw} (${aliqPct.toFixed(2)}%)`, `Aceitas: ${[...CFG.aliquotas_validas].sort((a,b)=>a-b).join(', ')}`, getBR(r)));

      if (CFG.regras.imposto_aliquota.on && aliqPct !== null && tem('IMPOSTO')) {
        const impNorm = String(imposto ?? '').trim().toUpperCase();
        let esperado = null;
        if (Math.abs(aliqPct) <= 0.000001) esperado = null;
        else if (aliqPct > 0 && aliqPct <= 5) esperado = 'ISS';
        else if (aliqPct > 5) esperado = 'ICMS';

        if (esperado === null && impNorm !== '')
          erros.push(reg('Alíquota', r._linha_excel, r['id_rota'] ?? r['Fator Agrupador (p/ Cobrança por Veiculo)'],
            `Alíquota 0% mas IMPOSTO preenchido: '${imposto}'`, 'Esperado: IMPOSTO nulo/vazio'));
        else if (esperado && impNorm !== esperado)
          erros.push(reg('Alíquota', r._linha_excel, r['id_rota'] ?? r['Fator Agrupador (p/ Cobrança por Veiculo)'],
            `IMPOSTO '${imposto}' incompatível com alíquota ${aliqPct.toFixed(2)}%`, `Regra: 1% a 5% = ISS; maior que 5% = ICMS. Esperado: ${esperado}`, getBR(r)));
      }
    });
    await yieldToUI();
    await yieldToUI();

  }

  // ── Fórmulas fiscais ─────────────────────────────────
  const fiscalCols = ['GRIS','Outros Valores','Descontos',
    'Aliquota ICMS/ISS','Valor ICMS/ISS','Valor Final à Receber','Base Calc ICMS/ISS','IMPOSTO'];
  const temBaseFrete = tem('Frete/Tarifa Base (Peso/KM/Veículo)') || tem('Tarifa Aplicada');

  if (temBaseFrete && fiscalCols.every(c => tem(c))) {
    const T = CFG.tolerancia;
    // Extrai callback para poder usar `return` (skip de linha) dentro do for loop chunked
    const _fiscal = r => {
      const isLM   = isLastMileRow(r);
      const isFM   = isFirstMileRow(r);
      const isBigs = isBigsRow(r);

      if (isBigs && tem('Tipo da Rota')) {
        const tipoRota = String(r['Tipo da Rota'] || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        if (tipoRota.includes('SEGUNDA SAIDA') || tipoRota.includes('INFRUTIFERA')) return;
      }
      const tarifa = getFreteBase(r, tem);
      const gris   = num(r['GRIS']) ?? 0;
      const outros = num(r['Outros Valores']) ?? 0;
      const espera = tem('Tarifa de Espera') ? (num(r['Tarifa de Espera']) ?? 0) : 0;
      const desc   = num(r['Descontos']) ?? 0;
      const aliq   = normalizarAliquotaTaxa(r['Aliquota ICMS/ISS']);
      const icms   = num(r['Valor ICMS/ISS']) ?? 0;
      const vfr    = num(r['Valor Final à Receber']) ?? 0;
      const base   = num(r['Base Calc ICMS/ISS']) ?? 0;
      const imp    = r['IMPOSTO'];
      const somaComGris = tarifa + gris + outros + espera - desc;
      const somaSemGris = tarifa + outros + espera - desc;
      const soma = somaComGris;
      const linha  = r._linha_excel;
      const trip   = r['id_rota'];

      if (CFG.regras.base_negativa.on && base < -T)
        erros.push(reg('Base Negativa', linha, trip,
          `Base Calc negativa: R$ ${base.toFixed(2)}`,
          `soma_base = FreteBase(${tarifa.toFixed(2)})${(isFM && isBigs) ? ' + GRIS(ignorado em FM Bigs)' : ' + GRIS(' + gris.toFixed(2) + ')'} + Outros(${outros.toFixed(2)}) + Espera(${espera.toFixed(2)}) - Desc(${desc.toFixed(2)}) = ${soma.toFixed(2)}`, getBR(r)));

      if (CFG.regras.tarifa_base_zerada && CFG.regras.tarifa_base_zerada.on && Math.abs(tarifa) <= T)
        erros.push(reg('Tarifa Base', linha, trip,
          `Tarifa/Frete Base zerada: R$ ${tarifa.toFixed(4)}`,
          'Alerta global: conferir se a cobrança deveria ter tarifa básica/frete base.'));

      if (CFG.regras.valor_final_zerado && CFG.regras.valor_final_zerado.on && Math.abs(vfr) <= T)
        erros.push(reg('Valor Final', linha, trip,
          `Valor Final à Receber zerado: R$ ${vfr.toFixed(4)}`,
          'Alerta global: conferir se a linha deveria ter valor final zerado.'));

      _gris: {
      if (CFG.regras.gris_valor_nf && CFG.regras.gris_valor_nf.on) {
        const GRIS_MIN_DEC = isBigsRow(r) ? (CFG.grisBigsMinPct ?? 0.0005) : (CFG.grisMinPct ?? 0.0005);
        const GRIS_MAX_DEC = isBigsRow(r) ? (CFG.grisBigsMaxPct ?? 0.0020) : (CFG.grisMaxPct ?? 0.0020);
        const grisArquivo = num(r['GRIS']) ?? gris;
        const grisColPct = r['GRIS %'] ?? r['GRIS%'] ?? r['Gris %'] ?? r['GRIS Percentual'] ?? null;
        const grisPctDecDireto = (grisColPct !== null && grisColPct !== '' && grisColPct !== undefined) ? num(grisColPct) : null;
        let grisPctDec = null, fonteGris = '', valorNF = null;
        if (grisPctDecDireto !== null && grisPctDecDireto > 0) {
          grisPctDec = grisPctDecDireto > 1 ? grisPctDecDireto / 100 : grisPctDecDireto;
          fonteGris = `coluna GRIS % do arquivo (${grisPctDecDireto})`;
        } else if (grisArquivo !== null && grisArquivo > 0 && tem('Valor nota Fiscal Mercadoria')) {
          valorNF = num(r['Valor nota Fiscal Mercadoria']);
          const freteBase = num(r['Frete/Tarifa Base (Peso/KM/Veículo)']) || num(r['Frete Calculado']) || null;
          if (valorNF !== null && valorNF < (CFG.grisNfMinimo ?? 10)) break _gris;
          if (valorNF !== null && freteBase !== null && freteBase > 0 && valorNF / freteBase > 5) break _gris;
          if (grisArquivo < (CFG.tolerancia ?? 0.05)) break _gris;
          if (valorNF !== null && Math.abs(valorNF) > T) {
            grisPctDec = grisArquivo / valorNF;
            fonteGris = `calculado GRIS/NF (${grisArquivo.toFixed(4)}/${valorNF.toFixed(4)})`;
          }
        }
        if (grisPctDec !== null) {
          if (grisPctDec < GRIS_MIN_DEC - 0.00001 || grisPctDec > GRIS_MAX_DEC + 0.00001) {
            const grisAtMin = valorNF !== null ? valorNF * GRIS_MIN_DEC : null;
            const grisAtMax = valorNF !== null ? valorNF * GRIS_MAX_DEC : null;
            const diffBorda = Math.min(
              grisAtMin !== null ? Math.abs(grisArquivo - grisAtMin) : Infinity,
              grisAtMax !== null ? Math.abs(grisArquivo - grisAtMax) : Infinity
            );
            if (diffBorda < (CFG.tolerancia ?? 0.05)) break _gris;
            erros.push(reg('GRIS', linha, trip,
              `GRIS % fora da faixa aceita. Apurado: ${(grisPctDec*100).toFixed(4)}% | Faixa: ${(GRIS_MIN_DEC*100).toFixed(2)}% – ${(GRIS_MAX_DEC*100).toFixed(2)}%`,
              `Fonte: ${fonteGris} | GRIS R$=${grisArquivo !== null ? grisArquivo.toFixed(4) : '—'}`, getBR(r)));
          }
        }
      }

      }
      // ── Motor PMO unificado: valida os 3 campos fiscais ──────────────
      {
        const calc = calcularMotorFiscal(r);
        const baseEsp = calc.baseCalc;
        const icmsEsp = calc.valorImposto;
        const vfrEsp  = calc.valorFinal;
        const aliqPct = (calc.aliquota * 100).toFixed(2);

        const vfrErro  = CFG.regras.fiscal_vfr.on && Math.abs(vfrEsp  - vfr)  > T;
        const baseErro = CFG.regras.fiscal_iss.on && Math.abs(baseEsp - base) > T;
        const icmsErro = CFG.regras.fiscal_iss.on && Math.abs(icmsEsp - icms) > T;

        if (vfrErro || baseErro || icmsErro) {
          const diffMax = Math.max(
            vfrErro  ? Math.abs(vfrEsp  - vfr)  : 0,
            baseErro ? Math.abs(baseEsp - base) : 0,
            icmsErro ? Math.abs(icmsEsp - icms) : 0
          );
          // Linha principal: só o diff total
          const msgDesc = `Divergência fiscal  —  diff R$ ${diffMax.toFixed(2)}`;

          // Detalhe: cada campo na sua linha + componentes
          const linhas = [];
          if (vfrErro)  linhas.push(`VFR        arquivo R$ ${vfr.toFixed(2)}   →   esperado R$ ${vfrEsp.toFixed(2)}`);
          if (baseErro) linhas.push(`Base Calc  arquivo R$ ${base.toFixed(2)}   →   esperado R$ ${baseEsp.toFixed(2)}`);
          if (icmsErro) linhas.push(`ICMS/ISS   arquivo R$ ${icms.toFixed(2)}   →   esperado R$ ${icmsEsp.toFixed(2)}`);

          const comps = [`Frete R$ ${tarifa.toFixed(2)}`];
          if (Math.abs(gris)   > T) comps.push(`GRIS R$ ${gris.toFixed(2)}`);
          if (Math.abs(outros) > T) comps.push(`Outros R$ ${outros.toFixed(2)}`);
          if (Math.abs(espera) > T) comps.push(`Espera R$ ${espera.toFixed(2)}`);
          if (Math.abs(desc)   > T) comps.push(`Desc R$ ${desc.toFixed(2)}`);
          linhas.push(`Alíq ${aliqPct}%  ·  ${comps.join(' + ')}`);

          const det = linhas.join('\n');
          erros.push(reg('ICMS/ISS', linha, trip, msgDesc, det, getBR(r)));
        }
      }

      if (CFG.regras.fiscal_isento.on && aliq === 0 && Math.abs(icms) > T)
        erros.push(reg('ICMS/ISS', linha, trip,
          `Alíquota 0% mas Valor ICMS/ISS = R$ ${icms.toFixed(4)} (deveria ser 0)`, getBR(r)));
    };
    // Processa em chunks de 5000 — browser respira a cada chunk
    for (let __ci = 0; __ci < rows.length; __ci++) {
      _fiscal(rows[__ci]);
      if (__ci % 5000 === 4999) await yieldToUI();
    }
    await yieldToUI();
  }


  // ── Observações / Outros Valores e Domingo-Feriado ───
  const _temObs = tem('Observações');
  const _temCom = tem('Comentários');
  const colObs = _temObs ? 'Observações' : (_temCom ? 'Comentários' : null);
  const colObsLabel = (_temObs && _temCom) ? 'Observações + Comentários' : colObs;
  if ((_temObs || _temCom) && tem('Outros Valores')) {
    rows.forEach(r => {
      // Combina Observações e Comentários — quando ambas existem, componentes podem estar em qualquer uma
      const textoObs = [
        _temObs ? getTextField(r, ['Observações']) : '',
        _temCom ? getTextField(r, ['Comentários']) : ''
      ].filter(Boolean).join(' ');
      const incentivos = extrairIncentivos(textoObs);
      const somaIncentivos = incentivos.reduce((s, x) => s + x.valor, 0);
      const outros = num(r['Outros Valores']) ?? 0;
      const linha = r._linha_excel;
      const trip = r['id_rota'] ?? r['Fator Agrupador (p/ Cobrança por Veiculo)'] ?? '—';

      // Observações/Comentários = Outros Valores:
      // Regra geral para TODAS as operações e TODAS as transportadoras.
      // Soma componentes descritos em Observações/Comentários, como:
      // incentivo, ajudante, adicional, holiday pay, pedágio/toll, domingo/feriado etc.
      // Se não encontrar componentes monetários reconhecidos, não gera ocorrência.
      if (CFG.regras.observacoes_outros.on) {
        const itensComparacao = extrairComponentesOutrosValores(textoObs);
        const contextoRegra = 'Regra geral todas as operações/transportadoras';
        const somaComparacao = itensComparacao.reduce((s, x) => s + x.valor, 0);
        if (itensComparacao.length > 0 && Math.abs(somaComparacao - outros) > CFG.tolerancia) {
          erros.push(reg('Observações', linha, trip,
            `Outros Valores diverge da soma dos componentes em ${colObsLabel}. Esperado: R$ ${somaComparacao.toFixed(4)} | Arquivo: R$ ${outros.toFixed(4)} | Diff: R$ ${Math.abs(somaComparacao-outros).toFixed(4)}`,
            `${contextoRegra}. Itens capturados: ${itensComparacao.map(x => `${x.nome}: ${x.valor}`).join(' ; ')}`, getBR(r)));
        }
      }

      // Regra global de Domingo/Feriado: quando a data cair em domingo ou feriado nacional,
      // deve existir adicional de 20% sobre Frete/Tarifa Base. A validação aceita o valor
      // explicitado em Observações/Comentários; se não houver item específico, aceita Outros Valores
      // quando ele é maior ou igual ao adicional esperado, pois pode conter mais componentes.
      if (CFG.regras.domingo_feriado_add.on) {
        const dataInfo = isDomingoOuFeriadoRow(r);
        if (dataInfo.ok) {
          const freteBase = getFreteBase(r, tem);
          const esperado = freteBase * 0.20;
          const incentivoDF = extrairIncentivoDomingoFeriado(textoObs);
          const bateObs = Math.abs(esperado - incentivoDF) <= CFG.tolerancia;
          const bateOutrosComoMinimo = incentivoDF === 0 && outros + CFG.tolerancia >= esperado;
          if (!bateObs && !bateOutrosComoMinimo) {
            const _isDom = dataInfo.motivo === 'Domingo';
            const _isFerNac = dataInfo.motivo === 'feriado nacional';
            const _tipoDesc = _isDom ? 'domingo' : 'feriado';
            const _tipoLabel = _isDom
              ? 'Domingo'
              : _isFerNac
                ? `Feriado Nacional: ${dataInfo.nomeFeriado}`
                : `Feriado Estadual: ${dataInfo.nomeFeriado}`;
            const _dataLabel = dataInfo.data
              ? `dia ${String(dataInfo.data.getDate()).padStart(2,'0')}.${String(dataInfo.data.getMonth()+1).padStart(2,'0')}`
              : '';
            erros.push(reg(_isDom ? 'Domingo' : 'Feriado', linha, trip,
              `Adicional de ${_tipoDesc} ausente — esperado R$ ${esperado.toFixed(2)}, encontrado R$ ${incentivoDF.toFixed(2)} (diff R$ ${(esperado - incentivoDF).toFixed(2)})`,
              `${_tipoLabel}${_dataLabel ? ' — ' + _dataLabel : ''}`, getBR(r)));
          }
        }
      }
    });
    await yieldToUI();
  }

  // ── Segunda Saída ────────────────────────────────────
  if (tem('Tipo da Rota') && tem('Frete/Tarifa Base (Peso/KM/Veículo)') && tem('Descontos')) {
    rows.forEach(r => {
      // BIGS: rota inválida já é tratada em bigs_infrutifera — não calcular mérito aqui
      if (isBigsRow(r)) return;

      const tipo  = r['Tipo da Rota'];
      const frete = num(r['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? 0;
      const desc  = num(r['Descontos']) ?? 0;

      if (CFG.regras.segunda_saida_desc.on && tipo === 'Segunda Saída') {
        const esp  = frete * CFG.descontoSegundaSaida;
        if (Math.abs(esp - desc) > CFG.tolerancia)
          erros.push(reg('Segunda Saída', r._linha_excel, r['id_rota'],
            `Desconto incorreto. Esperado: R$ ${esp.toFixed(4)} (${(CFG.descontoSegundaSaida*100).toFixed(0)}% de R$ ${frete.toFixed(4)}) | Arquivo: R$ ${desc.toFixed(4)} | Diff: R$ ${Math.abs(esp-desc).toFixed(4)}`, getBR(r)));
      }
      if (CFG.regras.normal_com_desc.on && tipo === 'NORMAL' && desc > CFG.tolerancia)
        erros.push(reg('Segunda Saída', r._linha_excel, r['id_rota'],
          `Rota NORMAL com desconto indevido: R$ ${desc.toFixed(4)}`,
          'Verificar se desconto de Segunda Saída foi aplicado em rota errada.'));
    });
    await yieldToUI();
  }

  // ── Isenção SP ───────────────────────────────────────
  _valIsencaoSP(rows, erros, tem);
  // ── Big's com Segunda Saída ou Infrutífera ─────────────
  // Regra ajustada:
  // - Para FM / FMH, considerar como Big's quando a coluna "Nome Transportadora (3PL)"
  //   contém BIGS no nome da transportadora.
  // - Também considera Big's se a própria Operação contiver BIGS.
  // - Só acusa erro quando Big's tiver Tipo da Rota = Segunda Saída ou Infrutífera.
  if (CFG.regras.bigs_infrutifera.on && tem('Operação')) {
    const colTransp = cols.find(c => c === 'Nome Transportadora (3PL)');
    const colTipoRota = cols.find(c => c === 'Tipo da Rota');

    rows.forEach(r => {
      const op = String(r['Operação'] || '').toUpperCase().trim();
      const transp = colTransp ? String(r[colTransp] || '').toUpperCase().trim() : '';
      const tipoRota = colTipoRota ? String(r[colTipoRota] || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';

      const isFMouFMH = (
        op === 'FM' ||
        op === 'FMH' ||
        op.includes('FIRST MILE') ||
        op.includes('FIRST MILE HUB')
      );

      const isBigsPorTransportadora = isFMouFMH && transp.includes('BIGS');
      const isBigsPorOperacao = op.includes('BIGS');
      const isBigs = isBigsPorTransportadora || isBigsPorOperacao;

      const isSegundaSaida = tipoRota.includes('SEGUNDA SAIDA');
      const isInfrutifera = tipoRota.includes('INFRUTIFERA') || tipoRota.includes('INFRUTIFERA');

      if (isBigs && (isSegundaSaida || isInfrutifera)) {
        erros.push(reg("Big's Infrutífera", r._linha_excel, r['id_rota'],
          `Big's com tipo de rota inválido: ${r[colTipoRota] || 'não informado'}`,
          `Operação: ${r['Operação'] || ''}${colTransp ? ' | Transportadora: ' + r[colTransp] : ''} | Regra: Big's não deve ter Segunda Saída ou Infrutífera na prefat.`, getBR(r)));
      }
    });
    await yieldToUI();
  }


  // ── VFR = Base Calc ICMS/ISS (global) ───────────────────────────────────
  _valVFRBase(rows, erros, tem);
  await yieldToUI();

  // ── Colunas obrigatórias 100% preenchidas ─────────────────────────────────
  if (CFG.regras.colunas_100pct && CFG.regras.colunas_100pct.on) {
    const colsCheck = CFG.colunasObrigatorias.filter(c => tem(c));
    const isFM = rows.some(r => isFirstMileRow(r));
    colsCheck.forEach(col => {
      const vazios = rows.filter(r => {
        const v = r[col];
        if (v !== null && v !== undefined && String(v).trim() !== '') return false; // preenchido
        // IMPOSTO vazio é aceito quando ICMS e ISS também estão ausentes (diferimento)
        if (col === 'IMPOSTO') {
          const aliq = r['Aliquota ICMS/ISS'] ?? r['Alíquota ICMS/ISS'] ?? null;
          const val  = r['Valor ICMS/ISS']    ?? r['Valor Icms/Iss']    ?? null;
          const aliqVazio = aliq === null || aliq === undefined || String(aliq).trim() === '' || num(aliq) === 0 || num(aliq) === null;
          const valVazio  = val  === null || val  === undefined || String(val ).trim() === '' || num(val)  === 0 || num(val)  === null;
          if (aliqVazio && valVazio) return false; // diferimento → não contar como vazio
        }
        return true;
      });
      if (vazios.length > 0)
        erros.push(reg('Coluna vazia', null, null,
          `Coluna '${col}' tem ${vazios.length} célula(s) vazia(s) (linhas: ${vazios.slice(0,5).map(r=>r._linha_excel).join(', ')}${vazios.length>5?' ...':''})`,
          'Colunas obrigatórias devem estar 100% preenchidas.'));
    });
    // FM específico: Hub OU SOC deve estar preenchido
    if (isFM && (tem('Hub') || tem('SOC'))) {
      const hubSocVazios = rows.filter(r => {
        if (!isFirstMileRow(r)) return false;
        const hub = String(r['Hub'] || '').trim();
        const soc = String(r['SOC'] || '').trim();
        return hub === '' && soc === '';
      });
      if (hubSocVazios.length > 0)
        erros.push(reg('Coluna vazia', null, null,
          `FM: ${hubSocVazios.length} linha(s) sem Hub nem SOC preenchido (linhas: ${hubSocVazios.slice(0,5).map(r=>r._linha_excel).join(', ')}${hubSocVazios.length>5?' ...':''})`,
          'Em First Mile, ou Hub ou SOC deve estar preenchido por linha.'));
    }
  }

  // ── CNPJ Tomador único por arquivo — alerta ───────────────────────────────
  _valCNPJUnico(rows, erros, tem);

  // ── FM/BIGS — sem ajudante e sem infrutífera ──────────────────────────────
  if (CFG.regras.bigs_fm_ajudante && CFG.regras.bigs_fm_ajudante.on) {
    rows.forEach(r => {
      const isFMRow  = isFirstMileRow(r);
      const isBigsRow_ = isBigsRow(r);
      if (!isFMRow && !isBigsRow_) return;

      // Ajudante: detectar via coluna Observações/Comentários
      const obs = String(r['Observações'] || r['Comentários'] || '').toLowerCase();
      const ajudanteMatch = obs.match(/ajudante[^:]*:\s*r?\$?\s*([\d.,]+)/i);
      if (ajudanteMatch) {
        const valAjudante = parseFloat(ajudanteMatch[1].replace(',','.'));
        if (valAjudante > 0)
          erros.push(reg("FM/BIGS Ajudante", r._linha_excel, r['id_rota'],
            `FM/BIGS com ajudante detectado: R$ ${valAjudante.toFixed(2)}`,
            'FM e BIGS não devem ter cobrança de ajudante na pré-fatura.'));
      }
    });
    await yieldToUI();
  }

  // ── Feriado Estadual +20% ─────────────────────────────────────────────────
  if (CFG.regras.feriado_estadual && CFG.regras.feriado_estadual.on &&
      tem('Data da Prestação do Serviço') && tem('UF Origem') &&
      tem('Frete/Tarifa Base (Peso/KM/Veículo)')) {
    const T = CFG.tolerancia;
    rows.forEach(r => {
      const uf  = String(r['UF Origem'] || '').trim().toUpperCase();
      const feriadosUF = FERIADOS_ESTADUAIS[uf] || {};
      if (!Object.keys(feriadosUF).length) return;

      const rawData = r['Data da Prestação do Serviço'];
      if (!rawData) return;
      const d = new Date(rawData);
      if (isNaN(d)) return;
      const mmdd = String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      const nomeFerEst = feriadosUF[mmdd];
      if (!nomeFerEst) return;

      const frete = num(r['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? 0;
      const esp   = frete * 1.2;
      const vfr   = num(r['Valor Final à Receber']) ?? 0;
      // Só alerta se o VFR não reflete o adicional (aproximação)
      if (frete > T && Math.abs(vfr - esp) > T * 10) {
        erros.push(reg('Feriado Estadual', r._linha_excel, r['id_rota'],
          `Data ${rawData} é feriado estadual: ${nomeFerEst} (${uf} — ${mmdd}). Verificar adicional de 20%.`,
          `FreteBase=${frete.toFixed(2)} | +20%=${esp.toFixed(2)} | VFR atual=${vfr.toFixed(2)}`, getBR(r)));
      }
    });
    await yieldToUI();
  }

  // ── Diferimento por estado/CNPJ Tomador ───────────────────────────────────
  if (CFG.regras.deferimento_estado && CFG.regras.deferimento_estado.on &&
      tem('CNPJ Tomador') && tem('UF Origem') && tem('Aliquota ICMS/ISS') && tem('IMPOSTO')) {
    const temUFPacote = tem('UF Origem pacote');
    rows.forEach(r => {
      // FM e FM Hub: UF Origem é a origem da ROTA (de onde o van saiu para coletar),
      // não a origem fiscal da mercadoria. O CT-e pode mostrar UF diferente.
      // Diferimento intra-SP não pode ser inferido apenas pelo campo UF Origem nesses casos.
      if (isFMFamilia(r)) return;

      const cnpjRaw  = String(r['CNPJ Tomador'] || '').replace(/[^0-9]/g,'');
      const ufOrigem = normalizarUF(r['UF Origem']);
      const ufTomador = CNPJ_UF_MAP[cnpjRaw] || null;
      if (!ufTomador) return; // CNPJ não encontrado na base → sem validação

      // Se a coluna "UF Origem pacote" existe no arquivo, ela DEVE ser SP.
      // Caso contrário, a linha é ignorada pela regra de diferimento.
      if (temUFPacote) {
        const ufPacoteNorm = normalizarUF(r['UF Origem pacote']);
        if (ufPacoteNorm !== 'SP') return;
      }

      // Regra: UF Origem pacote SP + UF Origem SP + CNPJ Tomador SP
      // → espera-se diferimento (alíquota 0% ou ICMS zero)
      // Válido apenas para LM e LH, onde UF Origem representa a origem fiscal real
      if (ufOrigem === 'SP' && ufTomador === 'SP' && SP_CNPJS.has(cnpjRaw)) {
        const cidadeOri  = String(r['Cidade Origem'] || '').trim().toUpperCase();
        const cidadeDest = String(r['Cidade Entrega'] || '').trim().toUpperCase();
        if (cidadeOri && cidadeDest && cidadeOri !== cidadeDest) {
          const aliq = normalizarAliquotaPercentual ? normalizarAliquotaPercentual(r['Aliquota ICMS/ISS']) : num(r['Aliquota ICMS/ISS']);
          const imp  = String(r['IMPOSTO'] || '').toUpperCase().trim();
          if (imp === 'ICMS' && aliq !== null && aliq > 0) {
            const ufPacoteInfo = temUFPacote ? ` | UF Origem pacote=${normalizarUF(r['UF Origem pacote'])}` : '';
            erros.push(reg('Diferimento', r._linha_excel, r['id_rota'],
              `UF Origem pacote SP + UF Origem SP + CNPJ Tomador SP + cidade origem (${cidadeOri}) ≠ destino (${cidadeDest}) → diferimento esperado, mas ICMS ${aliq}% aplicado`,
              `CNPJ=${cnpjRaw} | UF Tomador=${ufTomador}${ufPacoteInfo} | Verificar se deferimento SP se aplica nesta rota.`, getBR(r)));
          }
        }
      }
    });
    await yieldToUI();
  }

  // ── Minihub — volumes zerados em dias úteis ──────────────────────────────
  _valMinihub(rows, erros, tem);
  await yieldToUI();

  // ── Air Haul validations ─────────────────────────────────────────────────
  _valAirHaul(rows, erros, tem);

  await aplicarRegrasCustomizadas(rows, erros);
  await yieldToUI(); // respira após regras customizadas

  // ── Estatísticas de coluna ────────────────────────────────────────────────
  _valStats(rows);

  return erros;
}

/**
 * Normaliza sigla ou nome completo de UF para a sigla de 2 letras.
 * Aceita: 'SP', 'São Paulo', 'SAO PAULO', 'sao paulo', etc.
 */
// Sub-função: estatísticas de coluna (passagem única)
function _valStats(rows) {
  const STATS_COLS = ['Valor Final à Receber','GRIS','Frete/Tarifa Base (Peso/KM/Veículo)','Valor nota Fiscal Mercadoria','Outros Valores','Descontos'];
  validarArquivo.__lastStats = {};
  const acc = {};
  STATS_COLS.forEach(col => { acc[col] = { mn: null, mx: null, sum: 0, count: 0 }; });
  rows.forEach(r => {
    STATS_COLS.forEach(col => {
      const v = num(r[col]);
      if (v === null || isNaN(v)) return;
      const s = acc[col];
      s.sum += v; s.count++;
      if (s.mn === null || v < s.mn) s.mn = v;
      if (s.mx === null || v > s.mx) s.mx = v;
    });
  });
  STATS_COLS.forEach(col => {
    const s = acc[col];
    if (s.count === 0) return;
    validarArquivo.__lastStats[col] = { min: s.mn, max: s.mx, avg: s.sum / s.count, sum: s.sum, count: s.count };
  });
}

function normalizarUF(uf) {
  const raw = String(uf || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const NOMES = {
    'ACRE':'AC','ALAGOAS':'AL','AMAPA':'AP','AMAZONAS':'AM','BAHIA':'BA',
    'CEARA':'CE','DISTRITO FEDERAL':'DF','ESPIRITO SANTO':'ES','GOIAS':'GO',
    'MARANHAO':'MA','MATO GROSSO DO SUL':'MS','MATO GROSSO':'MT',
    'MINAS GERAIS':'MG','PARA':'PA','PARAIBA':'PB','PARANA':'PR',
    'PERNAMBUCO':'PE','PIAUI':'PI','RIO DE JANEIRO':'RJ',
    'RIO GRANDE DO NORTE':'RN','RIO GRANDE DO SUL':'RS',
    'RONDONIA':'RO','RORAIMA':'RR','SANTA CATARINA':'SC',
    'SAO PAULO':'SP','SERGIPE':'SE','TOCANTINS':'TO'
  };
  return NOMES[raw] || raw;
}

const CNPJ_UF_MAP = {"42446277000354": "RJ", "42446277000435": "SP", "42446277002993": "PR", "42446277006395": "SP", "42446277007952": "RN", "42446277003370": "GO", "42446277007014": "AL", "42446277007448": "RS", "42446277008509": "SC", "42446277008258": "PR", "42446277006719": "BA", "42446277006808": "BA", "42446277008762": "SP", "42446277008681": "BA", "42446277008924": "SP", "42446277008177": "RJ", "42446277008410": "MG", "42446277011127": "ES", "42446277005313": "SP", "42446277009572": "SP", "42446277010660": "SE", "42446277010589": "MG", "42446277009300": "SC", "42446277005402": "RJ", "42446277011801": "PE", "42446277007367": "MG", "42446277011470": "RS", "42446277011399": "MG", "42446277012956": "SP", "42446277012794": "SP", "42446277005585": "SP", "42446277012603": "SP", "42446277013251": "SP", "42446277012441": "RJ", "42446277012360": "SP", "42446277010902": "SP", "42446277013332": "RJ", "42446277002306": "RJ", "42446277013170": "RJ", "42446277013090": "ES", "42446277013766": "SP", "42446277012280": "MG", "42446277014142": "SC", "42446277014576": "SP", "42446277013413": "RJ", "42446277014908": "PE", "42446277014738": "RS", "42446277015203": "TO", "42446277003027": "PR", "42446277003531": "CE", "42446277001083": "SP", "42446277005070": "SP", "42446277002055": "DF", "42446277022242": "MG", "42446277014819": "PE", "42446277015548": "CE", "42446277016277": "SP", "42446277015033": "RJ", "42446277015700": "PB", "42446277017753": "RJ", "42446277017168": "MG", "42446277017400": "BA", "42446277017249": "SP", "42446277017087": "SP", "42446277018059": "SP", "42446277005747": "BA", "42446277017672": "SP", "42446277018563": "PE", "42446277018130": "SC", "42446277016439": "SP", "42446277016358": "RS", "42446277016781": "RJ", "42446277018210": "SP", "42446277024296": "SC", "42446277016943": "SP", "42446277016005": "PR", "42446277000273": "SP", "42446277014657": "BA", "42446277016196": "MG", "42446277016862": "SP", "42446277017915": "SC", "42446277018725": "MG", "42446277022323": "ES", "42446277025420": "DF", "42446277020894": "PR", "42446277020380": "AL", "42446277019888": "AM", "42446277018644": "BA", "42446277017320": "SP", "42446277020703": "GO", "42446277019705": "ES", "42446277021866": "GO", "42446277019616": "PR", "42446277019101": "RJ", "42446277020622": "PR", "42446277019535": "SC", "42446277026078": "MG", "42446277003299": "SC", "42446277023052": "RN", "42446277020541": "PR", "42446277022080": "BA", "42446277001750": "SP", "42446277015629": "ES", "42446277022757": "SP", "42446277004341": "SP", "42446277000869": "SP", "42446277006476": "MG", "42446277010155": "MG", "42446277020975": "MG", "42446277023486": "PR", "42446277019292": "PB", "42446277021785": "PI", "42446277023567": "MG", "42446277001164": "MG", "42446277022838": "SP", "42446277022676": "CE", "42446277021351": "PA", "42446277025853": "SE", "42446277022404": "SP", "42446277019969": "BA", "42446277018806": "RJ", "42446277021947": "MG", "42446277003701": "RJ", "42446277019020": "SP", "42446277011208": "MG", "42446277019454": "PR", "42446277020207": "RS", "42446277015890": "ES", "42446277023648": "SP", "42446277018482": "SP", "42446277026310": "RJ", "42446277026230": "SC", "42446277026744": "SP", "42446277025500": "SP", "42446277026582": "SP", "42446277026825": "MT", "42446277027040": "PE", "42446277001679": "SP", "42446277014223": "PR", "42446277013685": "RJ", "42446277031071": "RJ", "42446277026906": "SP", "42446277025691": "SP", "42446277027473": "SP", "42446277027120": "CE", "42446277009904": "MG", "42446277027805": "SP", "42446277015467": "MG", "42446277027392": "BA", "42446277027201": "DF", "42446277004856": "SC", "42446277007529": "PI", "42446277023729": "SP", "42446277027554": "PR", "42446277005828": "PE", "42446277012107": "MA", "42446277029921": "PE", "42446277027716": "PR", "42446277027988": "PR", "42446277028011": "ES", "42446277028526": "SP", "42446277011631": "RJ", "42446277032124": "BA", "42446277028607": "DF", "42446277032396": "PR", "42446277001326": "SP", "42446277027635": "GO", "42446277028364": "RJ", "42446277023214": "MG", "42446277001245": "MG", "42446277028445": "RS", "42446277028283": "RS", "42446277028879": "SC", "42446277028950": "SP", "42446277030776": "SP", "42446277031667": "AL", "42446277028798": "PR", "42446277029093": "SP", "42446277011984": "SC", "42446277029255": "RS", "42446277029417": "SC", "42446277029174": "PR", "42446277017591": "ES", "42446277029760": "SP", "42446277017834": "SC", "42446277018997": "BA", "42446277029336": "RS", "42446277000605": "SP", "42446277030008": "MG", "42446277024962": "MG", "42446277010406": "SP", "42446277030180": "RN", "42446277022595": "MG", "42446277011550": "RS", "42446277001830": "SP", "42446277026400": "CE", "42446277013502": "SP", "42446277024105": "SP", "42446277024539": "MA", "42446277021190": "PR", "42446277007871": "SP", "42446277020037": "MG", "42446277014061": "PR", "42446277031403": "CE", "42446277032205": "PR", "42446277030857": "SP", "42446277030504": "SP", "42446277031152": "RS", "42446277021602": "BA", "42446277024709": "SP", "42446277026159": "SP", "42446277024458": "GO", "42446277025004": "RJ", "42446277021513": "RJ", "42446277015114": "RJ", "42446277021009": "SP", "42446277022161": "SP", "42446277021432": "MS", "42446277012875": "SP", "42446277002640": "SP", "42446277025349": "MS", "42446277015386": "RS", "42446277023800": "SP", "42446277012522": "SP", "42446277023133": "RO", "42446277024377": "MG", "42446277025934": "SP", "42446277025772": "PE", "42446277025187": "BA", "42446277026663": "PE", "42446277024024": "RJ", "42446277024610": "SP", "42446277025268": "RJ", "42446277023990": "AL", "42446277002136": "ES", "42446277023303": "MS", "42446277008096": "SC", "42446277003450": "RS", "42446277030342": "PB", "42446277028100": "SP", "42446277014495": "RS", "42446277007103": "GO", "42446277022919": "BA", "42446277030261": "MG", "42446277030423": "SP", "42446277001407": "SP", "42446277029506": "SP", "42446277030938": "PR", "42446277031314": "MG", "42446277031900": "RJ", "42446277031829": "RJ", "42446277029689": "SP", "42446277031748": "SP", "42446277031233": "SP", "42446277031586": "SP", "42446277014304": "MT"};
const SP_CNPJS = new Set(["42446277000435", "42446277006395", "42446277008762", "42446277008924", "42446277005313", "42446277009572", "42446277012956", "42446277012794", "42446277005585", "42446277012603", "42446277013251", "42446277012360", "42446277010902", "42446277013766", "42446277014576", "42446277001083", "42446277005070", "42446277016277", "42446277017249", "42446277017087", "42446277018059", "42446277017672", "42446277016439", "42446277018210", "42446277016943", "42446277000273", "42446277016862", "42446277017320", "42446277001750", "42446277022757", "42446277004341", "42446277000869", "42446277022838", "42446277022404", "42446277019020", "42446277023648", "42446277018482", "42446277026744", "42446277025500", "42446277026582", "42446277001679", "42446277026906", "42446277025691", "42446277027473", "42446277027805", "42446277023729", "42446277028526", "42446277001326", "42446277028950", "42446277030776", "42446277029093", "42446277029760", "42446277000605", "42446277010406", "42446277001830", "42446277013502", "42446277024105", "42446277007871", "42446277030857", "42446277030504", "42446277024709", "42446277026159", "42446277021009", "42446277022161", "42446277012875", "42446277002640", "42446277023800", "42446277012522", "42446277025934", "42446277024610", "42446277028100", "42446277030423", "42446277001407", "42446277029506", "42446277029689", "42446277031748", "42446277031233", "42446277031586"]);

// Feriados estaduais por UF (formato MM-DD, fixos por ano)
// Formato: { 'MM-DD': 'Nome do feriado' }
const FERIADOS_ESTADUAIS = {
  'SP': { '01-25': 'Aniversário de SP', '07-09': 'Revolução Constitucionalista' },
  'RJ': { '01-20': 'São Sebastião (RJ)', '04-23': 'São Jorge (RJ)', '10-28': 'Dia do Servidor Público (RJ)', '11-20': 'Consciência Negra (RJ)' },
  'MG': { '04-21': 'Tiradentes (MG)' },
  'RS': { '09-20': 'Revolução Farroupilha' },
  'SC': { '08-11': 'Criação da Capitania (SC)' },
  'PR': { '12-19': 'Emancipação do Paraná' },
  'BA': { '07-02': 'Independência da Bahia' },
  'PE': { '03-06': 'Revolução Pernambucana' },
  'CE': { '03-25': 'Data Magna do Ceará' },
  'GO': { '10-24': 'Pedra Fundamental de Goiânia' },
  'MT': { '11-08': 'Criação da Capitania (MT)' },
  'MS': { '10-11': 'Criação do Estado do MS' },
  // ES: 23/05 é ponto facultativo estadual, não feriado oficial — removido
  'AM': { '09-05': 'Elevação à Categoria de Estado (AM)' },
  'PA': { '08-15': 'Adesão à Independência (PA)' },
  'DF': { '04-21': 'Aniversário de Brasília' },
};


// Categorias que têm fórmula conhecida para correção automática
const CATS_CORRIGIVEIS = {
  'GRIS':              'gris',
  'ICMS/ISS':          'icms',
  'VFR ≠ Base Calc':   'base',
  'CNPJ Tomador':      'cnpj42',
  'Domingo':           'domingoferiado',
  'Feriado':           'domingoferiado',
};

// CNPJ fixo usado para corrigir CNPJ Tomador que não inicia com 42
const CNPJ_TOMADOR_CORRECAO = '42446277001407';

// Campos que cada tipo de correção pode alterar — usado para montar o seletor de campos
const CAMPOS_POR_TIPO = {
  gris:   [{ key: 'GRIS', label: 'GRIS' }],
  icms:   [{ key: 'vfr',  label: 'Valor Final à Receber' }, { key: 'base', label: 'Base Calc ICMS/ISS' }],
  base:   [{ key: 'base', label: 'Base Calc ICMS/ISS' }],
  cnpj42: [{ key: 'cnpj', label: 'CNPJ Tomador' }],
  domingoferiado: [{ key: 'domingoferiado', label: 'Outros Valores (+20% sobre Frete Base)' }],
};

// Calcula o adicional de Domingo/Feriado faltante numa linha e devolve quanto
// falta somar em "Outros Valores" (0 se já está correto ou não se aplica).
function _calcAdicionalDomingoFeriadoFaltante(row) {
  const dataInfo = isDomingoOuFeriadoRow(row);
  if (!dataInfo.ok) return 0;
  const tarifa = num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? num(row['Tarifa Aplicada']) ?? 0;
  const esperado = tarifa * 0.20;
  const textoObs = [
    String(row['Observações'] ?? '').trim(),
    String(row['Comentários'] ?? '').trim(),
  ].filter(Boolean).join(' ');
  const incentivoDF = extrairIncentivoDomingoFeriado(textoObs);
  const outros = num(row['Outros Valores']) ?? 0;
  const bateObs = Math.abs(esperado - incentivoDF) <= (CFG.tolerancia || 0.05);
  const bateOutrosComoMinimo = incentivoDF === 0 && outros + (CFG.tolerancia || 0.05) >= esperado;
  if (bateObs || bateOutrosComoMinimo) return 0;
  return Math.max(0, esperado - incentivoDF - outros);
}

// Modal: deixa o usuário escolher quais campos serão corrigidos antes de aplicar
function _selecionarCamposCorrecao(titulo, campos) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
    const checks = campos.map((c, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:9px 4px;cursor:pointer;font-size:13px;color:var(--text)">
        <input type="checkbox" id="_sc-${i}" checked style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer">
        ${escHtml(c.label)}
      </label>`).join('');
    ov.innerHTML = `
      <div style="background:var(--bg2);border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:6px">${escHtml(titulo)}</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Escolha quais campos devem ser corrigidos:</div>
        <div style="display:flex;flex-direction:column;border-top:1px solid var(--border2);border-bottom:1px solid var(--border2);margin-bottom:20px">${checks}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="_sc-cancel" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--text2);cursor:pointer;font-size:13px">Cancelar</button>
          <button id="_sc-ok" style="padding:9px 18px;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Aplicar correção</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fin = v => { ov.remove(); resolve(v); };
    ov.querySelector('#_sc-ok').onclick = () => {
      const sel = campos.filter((c, i) => ov.querySelector(`#_sc-${i}`).checked).map(c => c.key);
      fin(sel.length ? sel : null);
    };
    ov.querySelector('#_sc-cancel').onclick = () => fin(null);
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') fin(null); });
  });
}

async function corrigirCategoria(arqNome, cat, btn) {
  const r = appState.results.find(x => x.nome === arqNome);
  if (!r || !r.rows || !r.rows.length) {
    _toast('Arquivo sem linhas em memória. Revalide para corrigir por categoria.', 'warn');
    return;
  }

  const tipo = CATS_CORRIGIVEIS[cat];
  const campos = CAMPOS_POR_TIPO[tipo] || [];

  // Deixa o usuário escolher quais campos corrigir antes de aplicar
  const selecionados = campos.length
    ? await _selecionarCamposCorrecao(`Corrigir "${CAT_LABEL && CAT_LABEL[cat] || cat}"`, campos)
    : campos.map(c => c.key);
  if (!selecionados) return; // cancelado

  // Feedback imediato — o forEach pode demorar para arquivos grandes
  const labelOrig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  await yieldToUI();

  const T   = CFG.tolerancia;
  let n = 0;

  r.rows.forEach(row => {
    const nf     = num(row['Valor nota Fiscal Mercadoria']);
    const aliq   = num(row['Aliquota ICMS/ISS']);

    if (tipo === 'gris' && selecionados.includes('GRIS') && nf !== null && nf > 0) {
      // GRIS = NF × 0,1%
      const grisAtual = num(row['GRIS']) ?? 0;
      const grisCorr  = parseFloat((nf * 0.001).toFixed(4));
      if (Math.abs(grisCorr - grisAtual) > T) { row['GRIS'] = grisCorr; n++; }

    } else if (tipo === 'icms') {
      // Mesma fórmula do validador: VFR = soma_base + icms_arquivo
      const tarifa = num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? num(row['Tarifa Aplicada']) ?? 0;
      const gris   = num(row['GRIS']) ?? 0;
      const outros = num(row['Outros Valores']) ?? 0;
      const espera = num(row['Tarifa de Espera']) ?? 0;
      const desc   = num(row['Descontos']) ?? 0;
      const icmsArq= num(row['Valor ICMS/ISS']) ?? 0;
      const vfrAt  = num(row['Valor Final à Receber']);
      const baseAt = num(row['Base Calc ICMS/ISS']);

const calc = calcularMotorFiscal(row);

const soma = calc.liquido;

      const vfrCorr = parseFloat((soma + icmsArq).toFixed(4));
      if (selecionados.includes('vfr') && vfrAt !== null && Math.abs(vfrCorr - vfrAt) > T) {
        row['Valor Final à Receber'] = vfrCorr; n++;
      }
      if (selecionados.includes('base') && baseAt !== null && Math.abs(vfrCorr - baseAt) > T) {
        row['Base Calc ICMS/ISS'] = vfrCorr;
      }

    } else if (tipo === 'base' && selecionados.includes('base')) {
      // Base Calc = Gross-up PMO
      const vfr  = num(row['Valor Final à Receber']);
      const base = num(row['Base Calc ICMS/ISS']);
      if (vfr !== null && base !== null && Math.abs(vfr - base) > T) {
        row['Base Calc ICMS/ISS'] = parseFloat(vfr.toFixed(4)); n++;
      }

    } else if (tipo === 'cnpj42' && selecionados.includes('cnpj')) {
      // CNPJ Tomador que não inicia com 42 → substitui pelo CNPJ correto
      const cnpjLimpo = limparCnpj(row['CNPJ Tomador']);
      if (cnpjLimpo && !cnpjLimpo.startsWith('42')) {
        row['CNPJ Tomador'] = CNPJ_TOMADOR_CORRECAO; n++;
      }

    } else if (tipo === 'domingoferiado' && selecionados.includes('domingoferiado')) {
      // Domingo/Feriado: adicional de 20% sobre Frete Base ausente — soma a
      // diferença em "Outros Valores" (mesma conta que a validação aceita).
      const falta = _calcAdicionalDomingoFeriadoFaltante(row);
      if (falta > T) {
        row['Outros Valores'] = parseFloat(((num(row['Outros Valores']) ?? 0) + falta).toFixed(4));
        n++;
      }
    }
  });

  // Feedback imediato no botão
  if (btn) { btn.disabled = false; btn.textContent = `⏳ Revalidando…`; }

  // Revalida com as rows já normalizadas (não re-normaliza)
  r.erros = await validarArquivo(r.rows, r.nome);
  r.rows  = validarArquivo.__lastNormalizedRows || r.rows;

  const ri = appState.results.findIndex(x => x.nome === arqNome);
  const errosRestantes = errosAtivos(r).length;

  if (btn) {
    btn.textContent = n > 0 ? `✅ ${n} corrigido(s)` : `— sem desvio`;
    btn.classList.add('aplicado');
  }

  renderResultados();
  atualizarVeredicto();
  showPage('results');

  // Rola até o arquivo corrigido após o render progressivo ter tempo de montar
  setTimeout(() => {
    const cardEl = ri >= 0 ? document.getElementById(`fr-${ri}`) : null;
    if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (n > 0) {
      _toast(
        errosRestantes > 0
          ? `✅ ${n} valor(es) corrigido(s) em "${cat}". ${errosRestantes} erro(s) restante(s).`
          : `✅ ${n} valor(es) corrigido(s) em "${cat}". Arquivo aprovado!`,
        errosRestantes > 0 ? 'warn' : 'ok',
        4000
      );
    } else {
      _toast(`— Nenhum valor alterado na categoria "${cat}".`, 'info', 3000);
    }
  }, 400);
}

// ═══════════════════════════════════════════════════════
// MOTOR DE REGRAS CUSTOMIZADAS
// ═══════════════════════════════════════════════════════
function operacaoAplicaRegra(scope, row) {
  const op = String(row['Operação'] ?? '').toUpperCase().trim();
  if (!scope || scope === 'ALL') return true;
  if (scope === 'FIRST_MILE') return isFirstMileRow(row);
  if (scope === 'LINE_HAUL') return op.includes('LINE') || op.includes('LINE HAUL') || op.includes('LINEHAUL');
  if (scope === 'LAST_MILE') return op.includes('LAST MILE') || op.includes('LAST');
  return op.includes(String(scope).toUpperCase());
}

function rawVal(row, campo) { return row[campo] ?? ''; }
function numVal(row, campo) { return num(row[campo]) ?? 0; }

function avaliarCondicaoCustomizada(cond, row) {
  cond = String(cond || '').trim();
  if (!cond) return true;

  let m = cond.match(/^\[([^\]]+)\]\s+LIKE\s+["'](.+?)["']$/i);
  if (m) {
    return String(rawVal(row, m[1].trim())).toUpperCase().includes(String(m[2]).toUpperCase());
  }

  m = cond.match(/^\[([^\]]+)\]\s*(=|==|!=|>=|<=|>|<)\s*["']?(.+?)["']?$/i);
  if (m) {
    const leftRaw = rawVal(row, m[1].trim());
    const op = m[2];
    const rightRaw = m[3].trim();
    const leftNum = num(leftRaw);
    const rightNum = num(rightRaw);
    const numeric = leftNum !== null && rightNum !== null;
    const L = numeric ? leftNum : String(leftRaw).trim().toUpperCase();
    const R = numeric ? rightNum : String(rightRaw).trim().toUpperCase();
    if (op === '=' || op === '==') return L === R;
    if (op === '!=') return L !== R;
    if (op === '>') return L > R;
    if (op === '<') return L < R;
    if (op === '>=') return L >= R;
    if (op === '<=') return L <= R;
  }

  // Se a condição não for entendida, não bloqueia a regra; gera aplicação conservadora.
  return true;
}

function avaliarFormulaCustomizada(formula, row) {
  const expr = String(formula || '0').replace(/\[([^\]]+)\]/g, (_, campo) => `__v(${JSON.stringify(campo.trim())})`);
  return Function('__v', `"use strict"; return (${expr});`)(campo => numVal(row, campo));
}

async function aplicarRegrasCustomizadas(rows, erros) {
  if (!customRules.length) return;

  for (const rule of customRules.filter(r => r.ativo !== false)) {
    rows.forEach(row => {
      if (!operacaoAplicaRegra(rule.operacao, row)) return;
      if (!avaliarCondicaoCustomizada(rule.condicao, row)) return;

      const campo = rule.campo_validado;
      const valorArquivo = num(row[campo]);
      if (valorArquivo === null) {
        erros.push(reg(rule.severidade === 'warn' ? 'Regra Customizada (Alerta)' : 'Regra Customizada', row._linha_excel, row['id_rota'],
          `${rule.nome}: campo validado não encontrado ou não numérico: ${campo}`,
          `Operação=${rule.operacao || 'ALL'} | Fórmula=${rule.formula}`, getBR(row)));
        return;
      }

      let esperado;
      try { esperado = avaliarFormulaCustomizada(rule.formula, row); }
      catch(e) {
        erros.push(reg('Regra Customizada', row._linha_excel, row['id_rota'],
          `${rule.nome}: erro ao avaliar fórmula`, String(e.message || e)));
        return;
      }

      const tol = num(rule.tolerancia) ?? CFG.tolerancia;
      const diff = Math.abs((esperado ?? 0) - valorArquivo);
      if (diff > tol) {
        const cat = rule.severidade === 'warn' ? 'Regra Customizada (Alerta)' : 'Regra Customizada';
        erros.push(reg(cat, row._linha_excel, row['id_rota'],
          `${rule.mensagem || rule.nome}. Esperado: R$ ${(esperado ?? 0).toFixed(4)} | Arquivo: R$ ${valorArquivo.toFixed(4)} | Diff: R$ ${diff.toFixed(4)}`,
          `Regra=${rule.nome} | Operação=${rule.operacao || 'ALL'} | Condição=${rule.condicao || 'sem condição'} | Fórmula=${rule.formula}`, getBR(row)));
      }
    });
    await yieldToUI(); // cede entre cada regra customizada
  }
}

// ═══════════════════════════════════════════════════════
// EXECUTAR VALIDAÇÃO
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// PERSISTÊNCIA DE SESSÃO (localStorage)
// Salva erros+metadata após cada arquivo para sobreviver a crashes.
// As rows não são salvas (muito grandes); Ajustar Prefat requer re-upload.
// ═══════════════════════════════════════════════════════
const SESSAO_KEY = 'validador_prefat_sessao_v1';

let _salvarTimer = null;
function salvarSessao() {
  // Debounce: aguarda 400ms de silêncio antes de gravar
  // Evita 26 writes seguidos enquanto valida arquivo por arquivo
  clearTimeout(_salvarTimer);
  _salvarTimer = setTimeout(_salvarSessaoImediato, 400);
}

function _salvarSessaoImediato() {
  const MAX_ERROS = 500; // cap por arquivo — evita estourar os 5 MB do localStorage
  try {
    const payload = appState.results.map(r => ({
      nome: r.nome, linhas: r.linhas, abaOriginal: r.abaOriginal,
      opSummary: r.opSummary, status: r.status, stats: r.stats,
      erros: (r.erros || []).slice(0, MAX_ERROS),
      _errosTruncados: (r.erros || []).length > MAX_ERROS ? (r.erros || []).length : undefined,
    }));
    const json = JSON.stringify({ ts: Date.now(), resultados: payload });
    if (json.length > 4 * 1024 * 1024) {
      // Payload muito grande: salva modo slim (só metadata, sem detalhes de erro)
      const slim = appState.results.map(r => ({
        nome: r.nome, linhas: r.linhas, status: r.status, erros: [],
        _errosTruncados: (r.erros || []).length
      }));
      localStorage.setItem(SESSAO_KEY, JSON.stringify({ ts: Date.now(), resultados: slim, _slimMode: true }));
    } else {
      localStorage.setItem(SESSAO_KEY, json);
    }
  } catch(e) { _dbgWarn('salvarSessao falhou:', e); }

  try {
    const hist = JSON.parse(localStorage.getItem('validador_prefat_historico_v1') || '[]');
    hist.unshift({
      ts: Date.now(),
      arquivos: appState.results.map(r => ({ nome: r.nome, erros: (r.erros||[]).length, status: r.status||'ok' })),
      totalErros: appState.results.reduce((s,r) => s + (r.erros||[]).length, 0)
    });
    if (hist.length > 5) hist.pop();
    localStorage.setItem('validador_prefat_historico_v1', JSON.stringify(hist));
  } catch(e) {}
}

function limparSessao() {
  try { localStorage.removeItem(SESSAO_KEY); } catch(e) {}
}

function restaurarSessao() {
  try {
    const raw = localStorage.getItem(SESSAO_KEY);
    if (!raw) return;
    const { ts, resultados } = JSON.parse(raw);
    if (!resultados || !resultados.length) return;

    // Só restaura se a sessão tiver menos de 24h
    if (Date.now() - ts > 24 * 60 * 60 * 1000) { limparSessao(); return; }

    // Modal de confirmação — não restaura silenciosamente
    const data  = new Date(ts).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#1e2235;border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="font-size:17px;font-weight:700;color:#e8eaf0;margin-bottom:8px">🔄 Sessão anterior encontrada</div>
        <div style="font-size:13px;color:#8b92a8;line-height:1.7;margin-bottom:22px">
          <b style="color:#e8eaf0">${resultados.length} arquivo(s)</b> validados em
          <b style="color:#e8eaf0">${data}</b> estão salvos.<br>
          Deseja restaurar os resultados ou começar do zero?
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="_modal-nao" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#8b92a8;cursor:pointer;font-size:13px">
            Começar do zero
          </button>
          <button id="_modal-sim" style="padding:9px 18px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-weight:600">
            Restaurar sessão
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('_modal-nao').onclick = () => {
      limparSessao();
      modal.remove();
    };
    document.getElementById('_modal-sim').onclick = () => {
      modal.remove();
      appState.results = resultados.map(r => ({
        ...r,
        rows: [],
        file: null,
        _restaurado: true,
      }));
      renderResultados();
      buildErrFlat();
      showPage('results');
    };
  } catch(e) {
    _dbgWarn('restaurarSessao erro:', e);
  }
}

function cancelarProcessamento() {
  _cancelando = true;
  const btn = document.getElementById('prog-ov-cancel');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  const msgEl = document.getElementById('prog-ov-msg');
  if (msgEl) msgEl.textContent = 'Cancelando…';
}

/** Modal de confirmação não-bloqueante — substitui confirm() */
function _confirmarModal(titulo, corpo, btnOk = 'Confirmar', btnCancel = 'Cancelar') {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `
      <div style="background:var(--bg2);border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:10px">${titulo}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:22px;white-space:pre-line">${escHtml(corpo)}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="_mc-n" style="padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--text2);cursor:pointer;font-size:13px">${escHtml(btnCancel)}</button>
          <button id="_mc-s" style="padding:9px 18px;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600">${escHtml(btnOk)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const fin = v => { ov.remove(); resolve(v); };
    ov.querySelector('#_mc-s').onclick = () => fin(true);
    ov.querySelector('#_mc-n').onclick = () => fin(false);
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') fin(false); });
  });
}

async function validarTodos() {
  if (_validando) { _toast('Validação já em andamento…', 'warn', 2000); return; }
  syncGrisParamsFromUI();

  // ── Aviso de arquivos grandes (>50 MB) ──────────────────────────────────
  const arquivosGrandes = appState.files.filter(f => f.size > 50*1024*1024);
  if (arquivosGrandes.length > 0) {
    const nomes = arquivosGrandes.map(f => `• ${f.name} (${(f.size/1024/1024).toFixed(0)} MB)`).join('\n');
    const ok = await _confirmarModal(
      '⚠️ Arquivos muito grandes detectados',
      `${arquivosGrandes.length} arquivo(s) acima de 50 MB:\n\n${nomes}\n\nO processamento pode levar vários minutos.`,
      'Continuar mesmo assim', 'Cancelar'
    );
    if (!ok) return;
  }

  appState.results = [];
  limparSessao(); // nova validação → apaga sessão anterior
  document.getElementById('btn-validate').disabled = true;
  _validando = true;
  _cancelando = false;

  // Reset cancel button
  const cancelBtn = document.getElementById('prog-ov-cancel');
  if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '\u23f9 Cancelar'; }
  const titEl = document.getElementById('prog-ov-titulo');
  if (titEl) titEl.textContent = '▶ Validando Prefats';

  const total = appState.files.length;

  for (let i = 0; i < total; i++) {
    if (_cancelando) break;
    const f = appState.files[i];
    f.status = 'running';
    renderFila();

    // ── Fase 1: leitura do arquivo ──────────────────────────────────────────
    atualizarProgresso(
      i / total,
      `Lendo arquivo ${i + 1} de ${total}: ${f.name}`,
      `Decomprimindo o XLSX…`
    );
    await yieldToUI(); // garante que a barra aparece antes de parsear

    let rawRows;
    try {
      const _timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Timeout: leitura do arquivo excedeu 5 minutos. Tente um arquivo menor ou divida em partes.')), 5 * 60 * 1000));
      rawRows = await Promise.race([lerExcel(f.file), _timeout]);
    } catch(err) {
      f.status = 'erro de leitura';
      // Mensagem amigavel para erros comuns em arquivos pesados
      let errMsg = err.message || String(err);
      if (/out of memory|allocation failed|maximum call stack|stack overflow/i.test(errMsg)) {
        errMsg = 'Arquivo muito grande: memória insuficiente. Divida o arquivo em partes menores (recomendado: até 60 MB / 200 k linhas).';
      } else if (/worker/i.test(errMsg)) {
        errMsg = 'Erro no parser background (Worker). Detalhes: ' + errMsg;
      }
      appState.results.push({ nome: f.name, erros: [reg('Estrutura', null, null, 'Erro ao ler arquivo: ' + errMsg)], linhas: 0, rows: [], file: f.file });
      _toast('❌ Falha ao ler ' + f.name + ': ' + errMsg.slice(0, 120), 'err', 8000);
      renderFila();
      continue;
    }

    // ── Fase 2: normalização em chunks ─────────────────────────────────────
    atualizarProgresso(
      (i + 0.2) / total,
      `Normalizando colunas — arquivo ${i + 1} de ${total}`,
      `${(rawRows||[]).length.toLocaleString('pt-BR')} linhas encontradas`
    );
    await yieldToUI();

    let normRows;
    // Para arquivos grandes usa versão async (chunked); pequenos usam a síncrona normal
    if (rawRows.length > 5000) {
      normRows = await normalizarColunasAsync(rawRows, (feitas, total_) => {
        atualizarProgresso(
          (i + 0.2 + (feitas / total_) * 0.3) / total,
          `Normalizando — arquivo ${i + 1} de ${total}`,
          `${feitas.toLocaleString('pt-BR')} / ${total_.toLocaleString('pt-BR')} linhas`
        );
      });
      normRows = normRows.map(r => { r.__normalizado = true; return r; });
    } else {
      normRows = normalizarColunas(rawRows);
    }

    // ── Fase 3: validação ───────────────────────────────────────────────────
    atualizarProgresso(
      (i + 0.5) / total,
      `Validando — arquivo ${i + 1} de ${total}`,
      `${normRows.length.toLocaleString('pt-BR')} linhas · aplicando regras…`
    );
    await yieldToUI(); // permite que a mensagem apareça antes da validação bloquear

    let erros;
    try {
          // Passa rows já normalizadas (skip normalizarColunas interno)
      erros = await validarArquivo(normRows, f.name);
          // Se o wrapper interno re-normalizou, usa a versão dele
      const posNorm = validarArquivo.__lastNormalizedRows || normRows;
      normRows.length === posNorm.length && (normRows = posNorm);
    } catch(err) {
      erros = [reg('Estrutura', null, null, `Erro na validação: ${err.message}`)];
      f.status = 'falha';
    }

    if (validarArquivo.__lastSheetName) f.__abaOriginal = validarArquivo.__lastSheetName;
    else if (/\.csv$/i.test(f.name)) f.__abaOriginal = 'CSV';

    atualizarProgresso(
      (i + 0.95) / total,
      `Concluindo arquivo ${i + 1} de ${total}…`,
      `${erros.length} ocorrência(s) encontrada(s)`
    );
    await yieldToUI();

    const temErro = erros.some(e => BADGE_CAT[e.cat] === 'err');
    f.status = erros.length === 0 ? 'ok' : (temErro ? `${erros.length} erros` : `${erros.length} alertas`);

    // opSummary: resumo por tipo de operação (usado pela aba executiva)
    const opSummary = resumoOperacoes(normRows);
    erros.forEach(e => {
      const op = e.operacao_detectada || 'Não identificado';
      opSummary[op] = opSummary[op] || { linhas: 0, erros: 0, alertas: 0, revisar: 0 };
      if ((BADGE_CAT[e.cat] || 'info') === 'err')       opSummary[op].erros += 1;
      else if ((BADGE_CAT[e.cat] || 'info') === 'warn') opSummary[op].alertas += 1;
      else opSummary[op].revisar += 1;
    });

    const resultado = { nome: f.name, erros, linhas: normRows.length, rows: normRows, file: f.file, abaOriginal: f.__abaOriginal || 'BASE', opSummary, stats: validarArquivo.__lastStats || {} };
    appState.results.push(resultado);

    // Libera rows imediatamente — serão relidas sob demanda no Ajustar Prefat.
    // O File object (resultado.file) é mantido como ponteiro leve para releitura.
    resultado.rows = [];
    rawRows = null;
    normRows = null;
    // Libera o buffer comprimido do arquivo — economiza memória durante sessões longas
    // (releitura futura usa o parser streaming, que não precisa do buffer em cache)
    if (f.file && f.file.__rawBuffer) f.file.__rawBuffer = null;

    // Auto-salva erros+metadata no localStorage (sem as rows, que são muito grandes)
    salvarSessao();

    renderFila();
  }

  // ── Finalização — sempre executa, mesmo se render falhar ──────────────────
  try {
    esconderProgresso();
  } finally {
    _validando = false;
    _cancelando = false;
    const btnVal = document.getElementById('btn-validate');
    if (btnVal) btnVal.disabled = false;
    if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '\u23f9 Cancelar'; }
    const btnCanProg = document.getElementById('btn-cancelar-prog');
    if (btnCanProg) btnCanProg.style.display = 'none';
  }
  // Render separado do cleanup — erros aqui são logados mas não travam a UI
  _insightActiveCat = null; // reset category filter on new validation
  try { renderResultados(); } catch(e) { console.error('[render] renderResultados:', e); }

  try { renderInsights(); } catch(e) { console.error('[render] Insights:', e); }
  try { _renderGlobalIgnoresPanel(); } catch(e) { console.error('[render] GlobalIgnores:', e); }
  try { showPage('results'); } catch(e) { console.error('[render] showPage:', e); }
  setTimeout(() => {
    try {
      const totCrit = appState.results.reduce((s,r) => {
        return s + (r.erros||[]).filter(e => !ignoredSet.has(ignoredKey(r.nome,e.cat)) && !ignoredSet.has(ignoredKeyGlobal(e.cat)) && (BADGE_CAT[e.cat]||'info')==='err').length;
      }, 0);
      const badgeE = document.getElementById('badge-erros');
      if (badgeE) { badgeE.textContent = totCrit > 0 ? totCrit : ''; badgeE.style.display = totCrit > 0 ? '' : 'none'; }
    } catch(e) { console.error('[render] badge:', e); }
  }, 0);
}

// ═══════════════════════════════════════════════════════
// RENDERIZAR RESULTADOS
// ═══════════════════════════════════════════════════════
// ── Ignored errors set (key = arquivo|linha|cat) ──────────────────────────
const ignoredSet = new Set();
let filtroSeveridadeAtivo = 'all';

// Chave por arquivo+categoria: "arqNome||cat"
// Chave global (todos os arquivos): "*||cat"
function ignoredKey(arqNome, cat)  { return `${arqNome}||${cat}`; }
function ignoredKeyGlobal(cat)     { return `*||${cat}`; }

// ── Persistência no servidor (por workspace) — categorias ignoradas
// globalmente e regras customizadas. Antes só ficava no localStorage. ──────
function _ajApiFetch(path, opts){
  if(typeof apiFetch==='function') return apiFetch(path, opts);
  return fetch(path, opts);
}
function persistirIgnoresGlobaisServidor(){
  const globais=[...ignoredSet].filter(k=>k.startsWith('*||')).map(k=>k.slice(3));
  _ajApiFetch('/api/validador/ajustes',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ignores_globais:globais})}).catch(()=>{});
}
async function carregarAjustesServidor(){
  try{
    const r=await _ajApiFetch('/api/validador/ajustes');
    const d=await r.json();
    if(!d || !d.ok) return;
    (d.ignores_globais||[]).forEach(cat=>ignoredSet.add(ignoredKeyGlobal(cat)));
    if(Array.isArray(d.custom_rules) && d.custom_rules.length){
      customRules=d.custom_rules;
      persistirRegrasCustomizadas(true);
    }
    if(typeof _renderGlobalIgnoresPanel==='function') _renderGlobalIgnoresPanel();
    if(typeof renderConfig==='function'){ try{ renderConfig(); }catch(e){} }
  }catch(e){ console.warn('[validador] não foi possível carregar ajustes do servidor:', e); }
}
document.addEventListener('DOMContentLoaded', carregarAjustesServidor);

function isIgnoradoGlobal(cat)     { return ignoredSet.has(ignoredKeyGlobal(cat)); }
function isIgnoradoArquivo(arqNome, cat) {
  return ignoredSet.has(ignoredKey(arqNome, cat)) || isIgnoradoGlobal(cat);
}

function setFiltroSeveridade(tipo, btn) {
  filtroSeveridadeAtivo = tipo;
  _filtroCatExato = null;
  _insightActiveCat = null;
  document.querySelectorAll('.res-filter,.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  aplicarFiltros();
  renderInsights();
}

let _filtroCatExato = null; // filtro exato por e.cat — separado do search de texto

function aplicarFiltros() {
  _renderGen++;  // cancela qualquer renderNext progressivo ainda em andamento
  const q    = (document.getElementById('results-search')?.value || '').trim().toLowerCase();
  const tipo = filtroSeveridadeAtivo;
  const hasFilter = q || tipo !== 'all' || _filtroCatExato;

  // Painel de insights permanece sempre visível — apenas os cards abaixo filtram
  const panel = document.getElementById('insights-panel');
  if (panel) panel.style.display = '';

  if (!hasFilter) {
    appState.results.forEach((r, ri) => {
      const card = document.getElementById(`fr-${ri}`);
      const body = document.getElementById(`frb-${ri}`);
      if (!card) return;
      card.style.display = '';
      if (body && body.dataset.rendered === 'filtered') _renderFileBody(ri);
    });
    return;
  }

  const matchItems = _errFlat.filter(item => {
    const isIgn = ignoredSet.has(ignoredKey(item.arqNome, item.e.cat)) || ignoredSet.has(ignoredKeyGlobal(item.e.cat));
    if (tipo === 'ignorados' && !isIgn) return false;
    if (tipo !== 'all' && tipo !== 'ignorados' && isIgn) return false;
    if (tipo === 'critico' && (BADGE_CAT[item.e.cat]||'info') !== 'err')  return false;
    if (tipo === 'alerta'  && (BADGE_CAT[item.e.cat]||'info') !== 'warn') return false;
    // Filtro exato por categoria (clique na tabela) — ignora busca de texto
    if (_filtroCatExato) return item.e.cat === _filtroCatExato;
    if (q && !item._txt.includes(q)) return false;
    return true;
  });

  const byRi = {};
  matchItems.forEach(item => {
    (byRi[item.ri] = byRi[item.ri] || []).push(item.e);
  });

  appState.results.forEach((r, ri) => {
    const card = document.getElementById(`fr-${ri}`);
    if (!card) return;
    if (byRi[ri]?.length) {
      card.style.display = '';
      card.classList.add('open');
      _renderFileBody(ri, byRi[ri]);
    } else {
      card.style.display = 'none';
    }
  });
}


function restaurarIgnorados() {
  ignoredSet.clear();
  // Re-renderiza todos os arquivos para restaurar categorias ignoradas
  appState.results.forEach((_, ri) => _renderFileBody(ri));
  atualizarContadorIgnorados();
  _renderGlobalIgnoresPanel();
  atualizarVeredicto();
  _dashCacheKey = '';
  persistirIgnoresGlobaisServidor();
}

function toggleIgnorarCategoria(btn, arqNome, cat) {
  const key = ignoredKey(arqNome, cat);
  if (ignoredSet.has(key)) {
    ignoredSet.delete(key);
  } else {
    ignoredSet.add(key);
  }
  // Re-renderiza o corpo do arquivo para a categoria sumir/reaparecer
  const cardEl = btn.closest('.file-result');
  const ri = cardEl ? parseInt(cardEl.dataset.ri ?? '-1') : -1;
  if (ri >= 0) _renderFileBody(ri);
  atualizarContadorIgnorados();
  _renderGlobalIgnoresPanel();
  atualizarVeredicto();
  _dashCacheKey = '';

}

function atualizarContadorIgnorados() {
  // Conta: ignores globais (por tema) + ignores por arquivo (únicos)
  const globais = [...ignoredSet].filter(k => k.startsWith('*||')).length;
  const porArq  = [...ignoredSet].filter(k => !k.startsWith('*||')).length;
  const el = document.getElementById('sc-ignorados');
  if (el) el.textContent = globais + porArq;
}

/** Ignora/restaura um tema em TODOS os arquivos simultaneamente */
function ignorarCategoriaGlobal(cat, btn) {
  const key = ignoredKeyGlobal(cat);
  const jaIgnorado = ignoredSet.has(key);

  if (jaIgnorado) {
    ignoredSet.delete(key);
  } else {
    ignoredSet.add(key);
    // Remove ignores individuais da mesma cat (redundantes agora)
    [...ignoredSet].filter(k => !k.startsWith('*||') && k.endsWith(`||${cat}`))
      .forEach(k => ignoredSet.delete(k));
  }

  // Re-renderiza todos os arquivos: categorias ignoradas somem, restauradas reaparecem
  appState.results.forEach((_, ri) => _renderFileBody(ri));

  _renderGlobalIgnoresPanel();
  atualizarContadorIgnorados();
  atualizarVeredicto();
  _dashCacheKey = '';
  persistirIgnoresGlobaisServidor();
}

/** Painel de temas globalmente ignorados (acima dos resultados) */
function _renderGlobalIgnoresPanel() {
  const globais = [...ignoredSet].filter(k => k.startsWith('*||')).map(k => k.slice(3));
  const el = document.getElementById('global-ignores-panel');
  if (!el) return;
  if (!globais.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:#f5f3ff;border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:600;color:#7c3aed;margin-right:4px">🌐 Ignorados globalmente:</span>
      ${globais.map(cat => `
        <span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;border-radius:6px;padding:2px 8px;font-size:11px;color:#6d28d9">
          ${escHtml(cat)}
          <button onclick="ignorarCategoriaGlobal('${escHtml(cat).replace(/'/g,"\\'")}', null)"
            style="background:none;border:none;cursor:pointer;color:#7c3aed;font-size:13px;padding:0;line-height:1" title="Restaurar">×</button>
        </span>`).join('')}
      <button onclick="restaurarIgnorados()" style="margin-left:auto;font-size:10px;color:#7c3aed;background:none;border:1px solid rgba(124,58,237,.3);border-radius:4px;padding:2px 8px;cursor:pointer">Restaurar todos</button>
    </div>`;
}

// Retorna erros de um resultado que NÃO estão em categorias ignoradas
// Verifica: ignore por arquivo E ignore global por tema
function errosAtivos(r) {
  return (r.erros || []).filter(e =>
    !ignoredSet.has(ignoredKey(r.nome, e.cat)) &&
    !ignoredSet.has(ignoredKeyGlobal(e.cat))
  );
}

function atualizarVeredicto() {
  const total = appState.results.length;
  const nIgnorados = ignoredSet.size;

  // Passagem única sobre todos os erros ativos
  let nCriticos = 0, nAlertas = 0;
  appState.results.forEach(r => {
    // errosAtivos already skips ignored — use BADGE_CAT directly (O(1) lookup)
    (r.erros||[]).forEach(e => {
      if (ignoredSet.has(ignoredKey(r.nome, e.cat)) || ignoredSet.has(ignoredKeyGlobal(e.cat))) return;
      const t = BADGE_CAT[e.cat] || 'info';
      if (t === 'err')  nCriticos++;
      else if (t === 'warn') nAlertas++;
    });
  });

  // Banner global
  let bannerHtml = '';
  if (total > 0) {
    if (nCriticos > 0) {
      bannerHtml = `<span class="verdict-pill vp-err">🔴 REPROVADO — ${nCriticos} crítico(s)${nAlertas ? ` · ${nAlertas} alerta(s)` : ''}</span>`;
    } else if (nAlertas > 0) {
      bannerHtml = `<span class="verdict-pill vp-warn">⚠️ RESSALVA — ${nAlertas} alerta(s) para revisar</span>`;
    } else {
      const sufixo = nIgnorados > 0 ? ` · ${nIgnorados} categoria(s) ignorada(s) pelo PMO` : '';
      bannerHtml = `<span class="verdict-pill vp-ok">✅ APROVADO</span>`;
    }
  }
  const bannerEl = document.getElementById('res-verdict-pill');
  if (bannerEl) bannerEl.innerHTML = bannerHtml;

  // Badge por arquivo — passagem única por arquivo
  appState.results.forEach((r, i) => {
    const header = document.querySelector(`#fr-${i} .file-result-header`);
    if (!header) return;
    let nCrit = 0, nWarn = 0, nIgn = 0;
    (r.erros||[]).forEach(e => {
      if (ignoredSet.has(ignoredKey(r.nome, e.cat)) || ignoredSet.has(ignoredKeyGlobal(e.cat))) { nIgn++; return; }
      const t = BADGE_CAT[e.cat] || 'info';
      if (t === 'err') nCrit++; else if (t === 'warn') nWarn++;
    });
    let badgeHtml;
    const ativosLen = r.erros.length - nIgn;
    if (ativosLen === 0 && r.erros.length === 0) {
      badgeHtml = '<span class="fh-badge badge-ok">✓ aprovado</span>';
    } else if (ativosLen === 0 && nIgn > 0) {
      badgeHtml = `<span class="fh-badge badge-ok">✓ aprovado</span><span style="font-size:10px;color:var(--text3);margin-left:6px">${nIgn} ignorado${nIgn>1?'s':''}</span>`;
    } else if (nCrit > 0) {
      badgeHtml = `<span class="fh-badge badge-err">${nCrit} crítico${nCrit>1?'s':''}${nWarn ? ` · ${nWarn} alerta${nWarn>1?'s':''}` : ''}</span>${nIgn ? `<span style="font-size:10px;color:var(--text3);margin-left:6px">${nIgn} ignorado${nIgn>1?'s':''}</span>` : ''}`;
    } else {
      badgeHtml = `<span class="fh-badge badge-warn">${nWarn} alerta${nWarn>1?'s':''}${nIgn ? ` · ${nIgn} ignorado${nIgn>1?'s':''}` : ''}</span>`;
    }
    const oldBadge = header.querySelector('.fh-badge');
    if (oldBadge) oldBadge.outerHTML = badgeHtml;
  });
}


// ═══════════════════════════════════════════════════════
// ÍNDICE DE BUSCA + RENDERIZAÇÃO LAZY (v3.14)
// ═══════════════════════════════════════════════════════
let _errFlat  = [];   // índice plano {ri, arqNome, e, _txt}
let _catPages = {};   // paginação por categoria: 'ri|cat' → n visíveis
const CAT_PAGE_SIZE = 100;

function buildErrFlat() {
  _errFlat = [];
  _copyBuffer.length = 0; // reset copy registry on each render
  // Single pass — fast enough even for 338k errors (pure JS array push, no DOM)
  appState.results.forEach((r, ri) => {
    const nome = r.nome;
    (r.erros || []).forEach(e => {
      _errFlat.push({ ri, arqNome: nome, e,
        _txt: ((e.cat||'') + ' ' + (e.linha||'') + ' ' + (e.trip||'') + ' ' + (e.desc||'') + ' ' + (e.det||'')).toLowerCase() });
    });
  });
}

// Registra textos de cópia por índice (evita inline encoding frágil)
const _copyBuffer = [];
function _regCopy(txt) { _copyBuffer.push(txt); return _copyBuffer.length - 1; }
function _doCopy(idx) { navigator.clipboard.writeText(_copyBuffer[idx]||'').then(()=>_toast('Copiado!','ok',1200)).catch(()=>_toast('Clipboard indisponível','warn')); }

function renderErrorRow(e, sevGrupo, ri, arqNome) {
  const sev = (typeof severidadeErro === 'function') ? severidadeErro(e) : sevGrupo;
  const temLinha = e.linha && String(e.linha) !== '—' && String(e.linha).trim() !== '';
  const temTrip  = e.trip  && String(e.trip)  !== '—' && String(e.trip).trim()  !== '';
  const copyTxt  = [temLinha ? 'L'+e.linha : '', temTrip ? e.trip : '', e.desc, e.det].filter(Boolean).join(' | ');
  const ci = _regCopy(copyTxt);

  // Sev chip
  const sevLabel = sev === 'critico' ? 'CRÍTICO' : sev === 'alerta' ? 'ALERTA' : 'INFO';
  const chip = `<span class="severity-chip severity-${sev}">${sevLabel}</span>`;

  // Linha + rota badge (só se existirem)
  const linhaBadge = temLinha
    ? `<span style="font-size:10px;font-family:var(--mono);background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:1px 7px;color:var(--text3);margin-right:6px;flex-shrink:0">L${escHtml(String(e.linha))}</span>`
    : '';
  const tripBadge = temTrip
    ? `<span style="font-size:10px;font-family:var(--mono);background:rgba(91,141,217,.07);border:1px solid rgba(91,141,217,.18);border-radius:4px;padding:1px 7px;color:#5b8dd9;margin-right:6px;flex-shrink:0">${escHtml(String(e.trip))}${e.br ? ` · ${escHtml(e.br)}` : ''}</span>`
    : '';

  // Detalhe: para Estrutura, formata as colunas faltando como chips
  let detHtml = '';
  if (e.det) {
    if (e.cat === 'Estrutura' && e.det.includes("'")) {
      // Extrai colunas entre aspas simples e monta chips visuais
      const colMatches = e.det.match(/'([^']+)'/g);
      if (colMatches) {
        const colNames = colMatches
          .map(m => m.replace(/'/g,'').trim())
          .filter(c => !c.startsWith('posição') && !c.match(/^\d/) && c.length > 1 && !c.startsWith('após'));
        const uniqCols = [...new Set(colNames)];
        if (uniqCols.length) {
          const chips = uniqCols.map(c =>
            `<span style="display:inline-block;font-family:var(--mono);font-size:11px;background:rgba(192,82,79,.08);border:1px solid rgba(192,82,79,.2);border-radius:4px;padding:2px 8px;color:#a06060;margin:2px 3px 2px 0">${escHtml(c)}</span>`
          ).join('');
          detHtml = `<div style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:2px"><span style="font-size:11px;color:var(--text3);margin-right:4px">Adicionar ao arquivo:</span>${chips}</div>`;
        } else {
          detHtml = `<div style="margin-top:5px;font-size:11px;color:var(--text3)">${escHtml(e.det)}</div>`;
        }
      } else {
        detHtml = `<div style="margin-top:5px;font-size:11px;color:var(--text3)">${escHtml(e.det)}</div>`;
      }
    } else if (e.det.includes('\n')) {
      const linhas = e.det.split('\n').filter(l => l.trim());
      detHtml = `<div style="margin-top:7px;display:flex;flex-direction:column;gap:4px">` +
        linhas.map(l => {
          if (l.startsWith('Alíq')) {
            return `<div style="font-size:11px;color:var(--text3);margin-top:1px">${escHtml(l)}</div>`;
          }
          const parts = l.match(/^(.+?)\s+arquivo R\$\s*([\d.,]+)\s+→\s+esperado R\$\s*([\d.,]+)$/);
          if (parts) {
            return `<div style="display:flex;align-items:baseline;gap:10px;font-size:12px;font-family:var(--mono)">
              <span style="color:var(--text3);font-size:10px;width:72px;flex-shrink:0">${escHtml(parts[1].trim())}</span>
              <span style="color:var(--text2)">R$ ${escHtml(parts[2])}</span>
              <span style="color:var(--text3);font-size:10px">→</span>
              <span style="color:var(--green);font-weight:600">R$ ${escHtml(parts[3])}</span>
            </div>`;
          }
          return `<div style="font-size:11px;color:var(--text3)">${escHtml(l)}</div>`;
        }).join('') +
        `</div>`;
    } else {
      detHtml = `<div style="margin-top:4px;font-size:11px;color:var(--text3);line-height:1.5">${escHtml(e.det)}</div>`;
    }
  }

  return `<tr class="err-row" data-sev="${sev}">
    <td style="padding:10px 16px;vertical-align:top">
      <div style="display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap">
        ${chip}
        ${linhaBadge}${tripBadge}
        <span style="color:var(--text);font-size:12px;font-weight:500;flex:1;min-width:180px">${escHtml(e.desc)}</span>
        ${temLinha && ri != null ? `<button onclick="abrirEditorLinha(${ri}, ${JSON.stringify(e.linha)})" title="Editar esta linha manualmente" style="background:none;border:1px solid var(--border2);border-radius:4px;cursor:pointer;color:var(--text3);font-size:10.5px;padding:1px 7px;flex-shrink:0;margin-top:1px" onmouseover="this.style.color='var(--accent)';this.style.borderColor='var(--accent)'" onmouseout="this.style.color='var(--text3)';this.style.borderColor='var(--border2)'">✎ Editar</button>` : ''}
        <button onclick="_doCopy(${ci})" title="Copiar" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;padding:0 2px;opacity:.35;flex-shrink:0;margin-top:1px" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.35">⎘</button>
      </div>
      ${detHtml}
    </td>
  </tr>`;
}

function _renderFileBody(ri, filteredErros) {
  const body = document.getElementById(`frb-${ri}`);
  if (!body) return;
  const r = appState.results[ri];
  if (!r) return;
  const erros = filteredErros !== undefined ? filteredErros : errosAtivos(r);
  const temIgnorados = filteredErros === undefined && errosAtivos(r).length < r.erros.length;
  let html = '';
  if (erros.length === 0) {
    if (filteredErros !== undefined) {
      html = '<div class="no-errors" style="color:var(--text3)">🔍 Nenhum erro corresponde ao filtro aplicado</div>';
    } else if (r.erros.length === 0) {
      html = '<div class="no-errors">✅ Arquivo aprovado — nenhuma ocorrência encontrada</div>';
    } else {
      // Todos os erros estão ignorados
      const nIgn = r.erros.length;
      html = `<div class="no-errors" style="background:#f5f3ff;border-color:rgba(124,58,237,.25);color:#7c3aed">🙈 ${nIgn} categoria(s) ignorada(s) pelo PMO — <button onclick="setFiltroSeveridade('ignorados', null); document.querySelector('[data-filter=ignored]')?.classList.add('active')" style="background:none;border:none;color:#7c3aed;text-decoration:underline;cursor:pointer;font-size:13px;padding:0">ver ignorados</button></div>`;
    }
  } else {
    html = `<div class="err-table-wrap">${renderTabelaErros(erros, r.nome, ri)}</div>`;
  }
  // Stats section removed — not needed in this view
  body.innerHTML = html;
  body.dataset.rendered = filteredErros !== undefined ? 'filtered' : '1';
}

function carregarMaisErros(ri, cat, arqNome) {
  const k = `${ri}|${cat}`;
  _catPages[k] = (_catPages[k] || CAT_PAGE_SIZE) + CAT_PAGE_SIZE;
  const body = document.getElementById(`frb-${ri}`);
  if (body) body.dataset.rendered = '';
  _renderFileBody(ri);
  requestAnimationFrame(() => {
    const catEls = body && [...body.querySelectorAll('.cat-group')];
    const el = catEls && catEls.find(g => g.querySelector('.cat-header span')?.textContent === cat
                                       || g.querySelector('.cat-header')?.childNodes[0]?.textContent?.trim() === cat);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function renderResultados() {
  // Limpa busca ao renderizar novos resultados (evita filtro stale de sessão anterior)
  const _srch = document.getElementById('results-search');
  if (_srch && _srch.value) _srch.value = '';
  atualizarBotoesDownload();
  const total   = appState.results.length;
  const semErro = appState.results.filter(r => r.erros.length === 0).length;
  const comErro = appState.results.filter(r => r.erros.length > 0).length;
  const nTotal  = appState.results.reduce((s, r) => 
    s + r.erros.filter(e => 
      !e._ignorado && 
      !e.ignorado && 
      !e.ignored &&
      !e._ignored &&
      !e.globalIgnored
    ).length
  , 0);

  const totalLinhas = appState.results.reduce((s,r) => s + (r.linhas||0), 0);
  document.getElementById('sc-arquivos').textContent = total;
  document.getElementById('sc-ok').textContent       = semErro;
  document.getElementById('sc-erros').textContent    = comErro;
  document.getElementById('sc-total').textContent    = nTotal.toLocaleString('pt-BR');
  document.getElementById('sc-linhas').textContent   = totalLinhas.toLocaleString('pt-BR');
  atualizarContadorIgnorados();
  const tools = document.getElementById('results-tools');
  if (tools) tools.style.display = nTotal > 0 ? 'flex' : 'none';

  atualizarVeredicto();

  const list = document.getElementById('results-list');
  if (appState.results.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div>Nenhuma validação executada ainda</div>';
    return;
  }

  // Fase 1: renderiza APENAS os cabeçalhos (instantâneo, zero DOM de erros)
  list.innerHTML = appState.results.map((r, i) => {
    const ativos = errosAtivos(r);
    // Single pass instead of two filter() calls
    let nCrit = 0, nWarn = 0;
    ativos.forEach(e => { const t = BADGE_CAT[e.cat]||'info'; if(t==='err') nCrit++; else if(t==='warn') nWarn++; });
    const nIgn  = r.erros.length - ativos.length;
    const badge = r.erros.length === 0
      ? '<span class="fh-badge badge-ok">✓ sem erros</span>'
      : ativos.length === 0
        ? `<span class="fh-badge badge-ok">✓ aprovado (${nIgn} ignorado(s))</span>`
        : (nCrit > 0
          ? `<span class="fh-badge badge-err">🔴 ${nCrit} crítico(s)${nWarn ? ` · ⚠️ ${nWarn}` : ''}${nIgn ? ` · 🙈 ${nIgn}` : ''}</span>`
          : `<span class="fh-badge badge-warn">⚠️ ${nWarn} alerta(s)${nIgn ? ` · 🙈 ${nIgn}` : ''}</span>`);

    const hasErrs = ativos.length > 0;
    return `<div class="file-result open" id="fr-${i}" data-ri="${i}">
        <div class="file-result-header" onclick="toggleResult(${i})">
          <span class="fh-name">📄 ${r.nome}</span>
          <span style="font-size:11px;color:var(--text3);flex-shrink:0">${(r.linhas||0).toLocaleString('pt-BR')} linhas</span>
          ${badge}
          ${hasErrs ? `<button onclick="event.stopPropagation();_baixarErrosTxt(${i})" title="Baixar erros deste arquivo (.txt)" style="background:none;border:1px solid var(--border2);border-radius:4px;color:var(--text3);font-size:10px;padding:2px 8px;cursor:pointer;flex-shrink:0">⬇ .txt</button>` : ''}
          <span class="fh-chevron">▲</span>
        </div>
        <div class="file-result-body" id="frb-${i}">
          <div style="padding:12px;color:var(--text3);font-size:12px">⏳ carregando…</div>
        </div>
      </div>`;
  }).join('');

  // Fase 2: constrói índice de busca em memória
  buildErrFlat();
  _catPages = {};
  _renderGen++;  // invalida qualquer renderNext pendente de chamadas anteriores

  // Fase 3: renderiza corpos progressivamente — 1 arquivo por frame
  // A UI nunca trava; o browser pinta o esqueleto antes de processar os erros
  let ri = 0;
  const myGen = _renderGen;
  function renderNext() {
    if (myGen !== _renderGen) return; // filtro foi aplicado entre frames — aborta
    if (ri >= appState.results.length) return;
    // Só renderiza se não foi filtrado depois
    const body = document.getElementById(`frb-${ri}`);
    if (body && body.dataset.rendered !== 'filtered') _renderFileBody(ri);
    ri++;
    requestAnimationFrame(renderNext);
  }
  requestAnimationFrame(renderNext);
}

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function renderTabelaErros(erros, arqNome, ri) {
  const categorias = [...new Set(erros.map(e => e.cat))];
  return categorias.map((cat) => {
    const grupo = erros.filter(e => e.cat === cat);
    const btype = BADGE_CAT[cat] || 'info';
    const catKey = ignoredKey(arqNome || '', cat);
    const isIgnored = ignoredSet.has(catKey);
    const sevGrupo = btype === 'err' ? 'critico' : btype === 'warn' ? 'alerta' : 'revisar';

    // Paginação: mostra só CAT_PAGE_SIZE erros inicialmente
    const pageKey = `${ri != null ? ri : 'x'}|${cat}`;
    const showing = _catPages[pageKey] || CAT_PAGE_SIZE;
    const visible  = grupo.slice(0, showing);
    const restante = grupo.length - visible.length;

    const rows = visible.map(e => renderErrorRow(e, sevGrupo, ri, arqNome)).join('');
    const maisBtn = restante > 0
      ? `<tr><td colspan="1" style="padding:8px;text-align:center">
           <button onclick="carregarMaisErros(${ri != null ? ri : 'null'}, ${JSON.stringify(cat)}, ${JSON.stringify(arqNome||'')})"
             style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:6px 18px;
                    border-radius:6px;cursor:pointer;font-size:12px;width:100%">
             ⬇ Ver mais ${restante} ocorrência(s) nesta categoria
           </button></td></tr>`
      : '';

    const isIgnoredGlobal = ignoredSet.has(ignoredKeyGlobal(cat));
    const isIgnoredFull   = isIgnored || isIgnoradoGlobal(cat);
    const ignoreLabel = isIgnoredFull ? '↺ Restaurar' : '🙈 Ignorar';
    const ignoreTitle = isIgnoredFull ? 'Restaurar esta categoria neste arquivo' : 'Ignorar esta categoria neste arquivo';
    const globalLabel = isIgnoredGlobal ? '🌐✓' : '🌐';
    const globalTitle = isIgnoredGlobal ? 'Ignorado em TODOS os arquivos — clique para restaurar' : 'Ignorar este tema em TODOS os arquivos de uma vez';

    return `
      <div class="cat-group cat-${btype}${isIgnoredFull ? ' cat-ignored' : ''}" data-cat="${escHtml(cat.toLowerCase())}" data-sev="${sevGrupo}">
        <div class="cat-header" onclick="toggleCategoria(this)">
          ${escHtml((typeof CAT_LABEL !== 'undefined' && CAT_LABEL[cat]) || cat)}
          <span class="cat-count">${grupo.length}</span>
          ${CATS_CORRIGIVEIS[cat] ? `<button class="corrigir-cat-btn" data-arq="${escHtml(arqNome||'')}" data-cat="${escHtml(cat)}" onclick="event.stopPropagation();corrigirCategoria(this.dataset.arq,this.dataset.cat,this)">✎ Corrigir</button>` : ''}
          <button class="ignore-cat-btn" title="${ignoreTitle}"
            onclick="event.stopPropagation(); toggleIgnorarCategoria(this, '${(arqNome||'').replace(/'/g,"\\'")}', '${cat.replace(/'/g,"\\'")}')">
            ${ignoreLabel}
          </button>
          <button class="ignore-global-btn${isIgnoredGlobal ? ' active' : ''}" data-cat="${escHtml(cat)}" title="${globalTitle}"
            onclick="event.stopPropagation(); ignorarCategoriaGlobal('${cat.replace(/'/g,"\\'")}', this)">
            ${globalLabel}
          </button>
          <span class="cat-chevron">▼</span>
          <button onclick="event.stopPropagation();var _gi=_regCopy(grupo.map(function(e){return[e.linha!=='\u2014'?'L'+e.linha:'',e.trip!=='\u2014'?e.trip:'',e.desc,e.det].filter(Boolean).join(' | ');}).join('\n'));_doCopy(_gi);_toast(grupo.length+' linha(s) copiada(s)!','ok',1800);" title="Copiar todos os erros desta categoria" style="background:none;border:1px solid var(--border);border-radius:3px;color:var(--text3);font-size:10px;padding:1px 6px;cursor:pointer;white-space:nowrap;margin-left:2px">⎘ ${grupo.length}</button>
        </div>
        <div class="cat-body">
          <table class="errs">${rows}${maisBtn}</table>
        </div>
      </div>`;
  }).join('');
}

function toggleCategoria(header) {
  const group = header.closest('.cat-group');
  if (group) group.classList.toggle('collapsed');
}

function colapsarCategorias(colapsar) {
  // Garantir que cards estejam abertos ao expandir categorias
  if (!colapsar) {
    appState.results.forEach((r, ri) => {
      const card = document.getElementById(`fr-${ri}`);
      const body = document.getElementById(`frb-${ri}`);
      if (card) card.classList.add('open');
      if (body && !body.dataset.rendered) _renderFileBody(ri);
    });
  }
  // Aguarda renderização e então colapsa/expande grupos
  requestAnimationFrame(() => {
    document.querySelectorAll('.cat-group').forEach(g => g.classList.toggle('collapsed', colapsar));
  });
}

function limparFiltroErros() {
  _insightActiveCat = null;
  _filtroCatExato = null;
  const input = document.getElementById('results-search');
  if (input) input.value = '';
  filtrarErros();
  renderInsights();
}

function debounceFiltrarErros() {
  // Digitou na busca — limpa o filtro exato de categoria
  _filtroCatExato = null;
  _insightActiveCat = null;
  clearTimeout(_filtroTimer);
  _filtroTimer = setTimeout(() => { filtrarErros(); renderInsights(); }, 150);
}

function filtrarErros() { aplicarFiltros(); }
let _filtroTimer = null;
let _renderGen   = 0;  // incrementado a cada renderResultados; cancela renderNext stale

function toggleResult(ri) {
  const card = document.getElementById(`fr-${ri}`);
  if (!card) return;
  const wasOpen = card.classList.contains('open');
  card.classList.toggle('open');
  // Renderiza corpo ao abrir pela primeira vez
  if (!wasOpen) {
    const body = document.getElementById(`frb-${ri}`);
    if (body && !body.dataset.rendered) _renderFileBody(ri);
  }
}


/** Painel de insights analíticos — resume os erros de forma acionável */
let _insightActiveCat = null;

function renderInsights() {
  const panel = document.getElementById('insights-panel');
  if (!panel) return;
  const todos = [];
  appState.results.forEach(r => errosAtivos(r).forEach(e => todos.push({ e, arq: r.nome })));
  if (!todos.length) { 
    // Só esconde se não há filtro ativo (com filtro pode não ter erros no índice mas a tabela deve ficar)
    if (!_insightActiveCat) panel.style.display = 'none'; 
    return; 
  }

  const _grp  = cat => todos.filter(x => x.e.cat === cat);
  const _arqs = arr => new Set(arr.map(x => x.arq)).size;
  const _diff = e   => { const m = (e.desc||'').match(/Diff:\s*R\$\s*([\d.,]+)/); return m ? parseFloat(m[1].replace(',','.')) : 0; };
  const sevOrd = { err:0, warn:1, info:2 };

  const cats = [...new Set(todos.map(x => x.e.cat))];
  const rows = cats.map(cat => {
    const g = _grp(cat);
    let detalhe = '';
    if (cat === 'ICMS/ISS') {
      const td = g.reduce((s,x) => s + _diff(x.e), 0);
      // Breakdown por tipo de erro de ICMS
      const tipos = [...new Set(g.map(x => {
        const d = x.e.desc || '';
        if (d.includes('Base Calc')) return 'Base Calc';
        if (d.includes('VFR')) return 'VFR';
        if (d.includes('negativa')) return 'Base negativa';
        return 'Cálculo';
      }))];
      detalhe = (td > 0 ? 'Diff total: R$ ' + td.toFixed(2) + ' · ' : '') + tipos.join(', ');
    } else if (cat === 'Estrutura') {
      // Extrai nomes das colunas faltando
      const cols = [];
      g.forEach(x => {
        const src = x.e.det || x.e.desc || '';
        // Pega o que está entre aspas simples nos detalhes
        const matches = src.match(/'([^']+)'/g);
        if (matches) matches.forEach(m => { const t = m.replace(/'/g,'').trim(); if(t && !t.startsWith('posição')) cols.push(t); });
      });
      const uniq = [...new Set(cols)].slice(0,4);
      detalhe = uniq.length ? 'Faltam: ' + uniq.join(', ') + (cols.length > 4 ? '…' : '') : g.length + ' problema(s) de estrutura';
    } else if (cat === 'GRIS') {
      // Verifica se é % fora da faixa ou colunas zeradas
      const zeradas = g.filter(x => (x.e.desc||'').toLowerCase().includes('zer'));
      const faixa   = g.filter(x => (x.e.desc||'').toLowerCase().includes('%') || (x.e.desc||'').toLowerCase().includes('faixa'));
      if (zeradas.length && !faixa.length) {
        detalhe = `${zeradas.length} linha(s) com GRIS zerado`;
      } else if (faixa.length) {
        const pcts = faixa.map(x => { const m=(x.e.desc||'').match(/Apurado:\s*([\d.,]+)%/); return m?parseFloat(m[1].replace(',','.')):null; }).filter(v=>v!==null);
        detalhe = pcts.length ? '% médio fora da faixa: ' + (pcts.reduce((a,b)=>a+b,0)/pcts.length).toFixed(3) + '%' : faixa.length + ' linha(s) com % inválido';
      } else {
        detalhe = g.length + ' ocorrência(s)';
      }
    } else if (cat === 'Tarifa Base') {
      detalhe = g.length + ' linha(s) com Frete/Tarifa Base zerada — sem precificação aplicada';
    } else if (cat === 'Valor Final') {
      detalhe = g.length + ' linha(s) com Valor Final à Receber zerado';
    } else if (cat === 'Base Negativa') {
      detalhe = g.length + ' linha(s) — desconto maior que frete + adicionais';
    } else if (cat === 'Domingo/Feriado') {
      const dm = new Map();
      g.forEach(x => { const m=(x.e.det||'').match(/(\d{4}-\d{2}-\d{2})/); if(m) dm.set(m[1],(dm.get(m[1])||0)+1); });
      detalhe = dm.size ? [...dm.entries()].sort().map(([d,n])=>d.slice(8)+'/'+d.slice(5,7)+(n>1?' (×'+n+')':'')).join(', ') : g.length + ' ocorrência(s)';
    } else if (cat === 'Domingo') {
      // Extrai datas no formato "dia DD.MM" do det
      const dm = new Map();
      g.forEach(x => { const m=(x.e.det||'').match(/dia (\d{2}\.\d{2})/); if(m) dm.set(m[1],(dm.get(m[1])||0)+1); });
      if (dm.size) {
        detalhe = [...dm.entries()].sort().map(([d,n]) => 'dia ' + d + (n>1?' (×'+n+')':'')).join(', ');
      } else {
        detalhe = g.length + ' ocorrência(s)';
      }
    } else if (cat === 'Feriado') {
      // Extrai nome do feriado + data: "Feriado Nacional: NAME — dia DD.MM" ou "Feriado Estadual: NAME — dia DD.MM"
      const fm = new Map();
      g.forEach(x => {
        const det = x.e.det || '';
        const m = det.match(/(?:Nacional|Estadual):\s*(.+?)\s*—\s*dia\s*(\d{2}\.\d{2})/);
        if (m) {
          const key = m[1].trim() + ' — ' + m[2];
          fm.set(key, (fm.get(key)||0)+1);
        } else {
          const m2 = det.match(/dia (\d{2}\.\d{2})/);
          if (m2) { const k='dia '+m2[1]; fm.set(k,(fm.get(k)||0)+1); }
        }
      });
      if (fm.size) {
        detalhe = [...fm.entries()].sort().map(([k,n]) => k + (n>1?' (×'+n+')':'')).join(', ');
      } else {
        detalhe = g.length + ' ocorrência(s)';
      }
    } else if (cat === 'Alíquota') {
      // Distingue alíquota inválida de IMPOSTO incompatível
      const incomp = g.filter(x => (x.e.desc||'').toLowerCase().includes('incompatível'));
      const invalida = g.filter(x => (x.e.desc||'').toLowerCase().includes('inválida'));
      if (incomp.length) {
        const pares = [...new Set(incomp.map(x=>{const m=(x.e.desc||'').match(/IMPOSTO '(\w+)'/);return m?m[1]:null;}).filter(Boolean))];
        detalhe = incomp.length + ' IMPOSTO incompatível' + (pares.length ? ': ' + pares.join(', ') : '');
      } else if (invalida.length) {
        const vals = [...new Set(invalida.map(x=>{const m=(x.e.desc||'').match(/([\d.,]+)%/);return m?m[1]:null;}).filter(Boolean))];
        detalhe = invalida.length + ' alíquota(s) inválida(s)' + (vals.length ? ': ' + vals.slice(0,4).join('%, ') + '%' : '');
      } else {
        detalhe = g.length + ' ocorrência(s)';
      }
    } else if (cat === 'CNPJ Tomador' || cat === 'CNPJ') {
      const encerrados = g.filter(x => (x.e.desc||'').toLowerCase().includes('encerrado'));
      const prefixo    = g.filter(x => (x.e.desc||'').toLowerCase().includes('não inicia com 42'));
      const unico      = g.filter(x => (x.e.desc||'').toLowerCase().includes('único'));
      if (encerrados.length) detalhe = encerrados.length + ' CNPJ(s) encerrado(s)/inválido(s)';
      else if (unico.length) detalhe = 'Apenas 1 CNPJ Tomador no arquivo';
      else if (prefixo.length) detalhe = prefixo.length + ' CNPJ(s) sem prefixo 42';
      else detalhe = g.length + ' ocorrência(s)';
    } else if (cat === 'Colunas zeradas' || (cat||'').toLowerCase().includes('100%') || (cat||'').toLowerCase().includes('preenchid')) {
      // Extrai quais colunas estão zeradas/vazias
      const colsVazias = [];
      g.forEach(x => { const m=(x.e.desc||'').match(/coluna[s]?\s+'?([^':]+)'?/i); if(m) colsVazias.push(m[1].trim()); });
      const uniq = [...new Set(colsVazias)].slice(0,4);
      detalhe = uniq.length ? 'Colunas: ' + uniq.join(', ') : g.length + ' linha(s) com campos obrigatórios vazios';
    } else if (cat === 'Diferimento') {
      detalhe = g.length + ' linha(s) — ICMS deveria ser 0% (diferimento intra-SP)';
    } else {
      detalhe = g.length + ' ocorrência(s)';
    }
    return { cat, sev: BADGE_CAT[cat]||'info', linhas: g.length, arqs: _arqs(g), detalhe };
  }).sort((a,b) => (sevOrd[a.sev]||2)-(sevOrd[b.sev]||2) || b.linhas-a.linhas);

  const sB = s => s==='err'
    ? '<span class="sev-badge sev-err">Crítico</span>'
    : s==='warn' ? '<span class="sev-badge sev-warn">Alerta</span>'
    : '<span class="sev-badge sev-info">Info</span>';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:6px;display:flex;align-items:center;gap:8px">
      <span>Clique em uma linha para filtrar — clique novamente para limpar</span>
      ${_insightActiveCat ? `<button onclick="limparFiltroCat()" style="background:none;border:1px solid var(--border2);border-radius:4px;color:var(--accent);font-size:10px;padding:1px 8px;cursor:pointer">✕ Limpar filtro</button>` : ''}
    </div>
    <div class="insights-table-wrap"><table class="insights-table">
      <thead><tr>
        <th style="width:30%">Problema</th>
        <th style="width:90px">Sev.</th>
        <th class="th-r" style="width:70px">Linhas</th>
        <th class="th-r" style="width:70px">Arq.</th>
        <th style="text-align:left">O que foi encontrado</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const isActive = _insightActiveCat === r.cat;
        const rowStyle = isActive ? 'background:rgba(59,130,246,.1);outline:1px solid rgba(59,130,246,.4);' : '';
        return `<tr class="ins-row" style="${rowStyle}" onclick="filtrarPorCategoria('${r.cat.replace(/'/g,"\\'")}')">
          <td class="ins-cat" style="font-weight:600">${escHtml(CAT_LABEL&&CAT_LABEL[r.cat]||r.cat)}${isActive ? ' <span style="font-size:10px;color:var(--accent)">← filtrado</span>' : ''}</td>
          <td>${sB(r.sev)}</td>
          <td class="ins-num" style="font-weight:700;color:${r.sev==='err'?'#ef4444':r.sev==='warn'?'#f59e0b':'#60a5fa'}">${r.linhas.toLocaleString('pt-BR')}</td>
          <td class="ins-num" style="color:var(--text2)">${r.arqs}</td>
          <td class="ins-det" style="max-width:none;white-space:normal;color:var(--text2)">${escHtml(r.detalhe)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function limparFiltroCat() {
  _insightActiveCat = null;
  const search = document.getElementById('results-search');
  if (search) { search.value = ''; filtrarErros(); }
  renderInsights();
}

// ═══════════════════════════════════════════════════════
// DASHBOARD CONSOLIDADO DE ERROS
// ═══════════════════════════════════════════════════════
let _dashCacheKey = '';
function filtrarPorCategoria(cat) {
  showPage('results');

  // Toggle: clicou na mesma categoria → limpa filtro
  if (_insightActiveCat === cat) {
    _insightActiveCat = null;
    _filtroCatExato = null;
    const search = document.getElementById('results-search');
    if (search) search.value = '';
    filtrarErros();
    renderInsights();
    return;
  }

  _insightActiveCat = cat;
  _filtroCatExato = cat;
  // Limpa a caixa de busca (filtro é por cat exata agora)
  const search = document.getElementById('results-search');
  if (search) search.value = '';

  requestAnimationFrame(() => {
    filtrarErros();
  });

  renderInsights();
  _toast(`Filtrando: ${cat}`, 'info', 1500);
}

function renderDashboardConsolidado() {
  const wrap = document.getElementById('dash-table-wrap');
  const dash = document.getElementById('dashboard-consolidado');
  if (!wrap || !dash) return;

  // Cache key: erros ativos por arquivo + tamanho do ignoredSet
  const newKey = appState.results.map(r => `${r.nome}:${errosAtivos(r).length}`).join('|') + '|ign:' + ignoredSet.size;
  if (newKey === _dashCacheKey && wrap.innerHTML) return; // nada mudou
  _dashCacheKey = newKey;

  const catMap = {}; // cat → {total, arquivos: Set, sev} — apenas erros ativos
  appState.results.forEach(r => {
    errosAtivos(r).forEach(e => {
      if (!catMap[e.cat]) catMap[e.cat] = {total:0, arquivos: new Set(), sev: BADGE_CAT[e.cat] || 'info'};
      catMap[e.cat].total++;
      catMap[e.cat].arquivos.add(r.nome);
    });
  });

  const sorted = Object.entries(catMap).sort((a,b) => b[1].total - a[1].total).slice(0,8);
  if (!sorted.length) { dash.style.display='none'; return; }

  dash.style.display = 'block';
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Tipo de problema</th>
      <th style="text-align:center">Sev.</th>
      <th style="text-align:right">Linhas afetadas</th>
      <th style="text-align:right">Arquivos</th>
    </tr></thead>
    <tbody>${sorted.map(([cat, d]) => {
      const sevCls   = d.sev === 'err' ? 'var(--red)' : d.sev === 'warn' ? 'var(--yellow)' : 'var(--accent)';
      const sevLabel = d.sev === 'err' ? '🔴' : d.sev === 'warn' ? '⚠️' : 'ℹ️';
      const catEsc   = escHtml(cat).replace(/'/g, "\\'");
      return `<tr onclick="filtrarPorCategoria('${catEsc}')" style="cursor:pointer">
        <td style="font-weight:500">${cat}</td>
        <td style="text-align:center">${sevLabel}</td>
        <td style="text-align:right;font-family:var(--mono);color:${sevCls};font-weight:700">${d.total.toLocaleString('pt-BR')}</td>
        <td style="text-align:right;font-family:var(--mono);color:var(--text2)">${d.arquivos.size}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ═══════════════════════════════════════════════════════
// EXPORTAR CSV
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// CONFIG PAGE — render
// ═══════════════════════════════════════════════════════
function syncGrisParamsFromUI() {
  const minEl = document.getElementById('cfg-gris-min');
  const maxEl = document.getElementById('cfg-gris-max');
  const nfEl  = document.getElementById('cfg-gris-nf-min');
  if (minEl) CFG.grisMinPct = parseFloat(minEl.value) / 100 || 0.0008;
  if (maxEl) CFG.grisMaxPct = parseFloat(maxEl.value) / 100 || 0.0012;
  if (nfEl)  CFG.grisNfMinimo = parseFloat(nfEl.value) || 10;
}

// Renderiza tabela de colunas por operação (aba Config)
function renderLayoutTab(op, btn) {
  // Atualiza tabs
  document.querySelectorAll('.layout-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const layout = COLUNAS_POR_OPERACAO[op] || [];
  const obrig  = new Set(CFG.colunasObrigatorias || []);
  const normObrig = new Set([...obrig].map(c => normalizarNomeColuna(c)));

  const opLabels = { FM: 'First Mile', LH: 'Linehaul', LM: 'Last Mile' };
  const opColors = { FM: 'badge-fm', LH: 'badge-lh', LM: 'badge-lm' };

  let html = `<table class="col-layout-table">
    <thead><tr>
      <th class="pos-num">#</th>
      <th>Coluna</th>
      <th>Obrigatória</th>
    </tr></thead><tbody>`;

  layout.forEach((col, idx) => {
    const isObrig = normObrig.has(normalizarNomeColuna(col));
    html += `<tr class="${isObrig ? 'col-obrig' : ''}">
      <td class="pos-num">${idx + 1}</td>
      <td class="col-name">${col}</td>
      <td>${isObrig ? '<span class="badge-op">✓ Obrigatória</span>' : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
    </tr>`;
  });

  html += `</tbody></table>
  <div style="font-size:11px;color:var(--text3);margin-top:8px">
    <b style="color:var(--text2)">${layout.length}</b> colunas no layout ${opLabels[op]}
    · <b style="color:var(--accent)">${layout.filter(c => normObrig.has(normalizarNomeColuna(c))).length}</b> obrigatórias
  </div>`;

  const el = document.getElementById('layout-col-table');
  if (el) el.innerHTML = html;
}

function renderConfig() {
  renderRuleTabs();
  renderBuiltinRules();
  renderCustomRules();

  // CNPJs
  renderCnpjList();

  // Colunas
  renderColunas();
  popularCamposRegrasCustomizadas();
}

function renderRuleTabs() {
  const tabs = document.getElementById('rule-tabs');
  tabs.innerHTML = Object.entries(RULE_GROUP_LABELS).map(([key, label]) => `
    <button class="rule-tab ${activeRuleGroup === key ? 'active' : ''}" onclick="selecionarGrupoRegra('${key}')">${label}</button>
  `).join('');
}

function selecionarGrupoRegra(key) {
  activeRuleGroup = key;
  renderRuleTabs();
  renderBuiltinRules();
}

function renderBuiltinRules() {
  const grid = document.getElementById('config-regras');
  const keys = RULE_GROUPS[activeRuleGroup] || [];
  grid.innerHTML = keys.filter(key => CFG.regras[key]).map(key => {
    const r = CFG.regras[key];
    return `
    <div class="config-card">
      <div class="cc-info">
        <div class="cc-name">
          ${r.label}
          <span class="pill pill-${r.badge}" style="margin-left:6px">${r.badge === 'err' ? 'erro' : r.badge === 'warn' ? 'alerta' : 'info'}</span>
        </div>
        <div class="cc-desc">${r.desc}</div>
      </div>
      <div class="toggle-wrap">
        <div class="toggle ${r.on ? 'on' : ''}" onclick="toggleRegra('${key}', this)"></div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state" style="grid-column:1/-1;padding:2rem">Nenhuma regra padrão cadastrada para esta operação ainda.</div>';
}

function getAvailableRuleFields() {
  return [...new Set([
    ...DEFAULT_COLUMN_OPTIONS,
    ...CFG.colunasObrigatorias,
    ...Array.from(appState.observedColumns || [])
  ])].filter(Boolean).sort((a,b) => a.localeCompare(b, 'pt-BR'));
}

function renderSelectOptions(selectId, selected = '', includeBlank = false, blankLabel = 'Selecione') {
  const el = document.getElementById(selectId);
  if (!el) return;
  const fields = getAvailableRuleFields();
  const options = [];
  if (includeBlank) options.push(`<option value="">${blankLabel}</option>`);
  options.push(...fields.map(c => `<option value="${String(c).replace(/"/g,'&quot;')}">${c}</option>`));
  el.innerHTML = options.join('');
  if (selected && fields.includes(selected)) el.value = selected;
}

function popularCamposRegrasCustomizadas() {
  renderSelectOptions('cr-campo', document.getElementById('cr-campo')?.value || '', true, 'Selecione o campo');
  renderSelectOptions('cr-cond-campo', document.getElementById('cr-cond-campo')?.value || '', true, 'Sem condição');
  renderSelectOptions('cr-formula-campo', document.getElementById('cr-formula-campo')?.value || '', true, 'Selecione um campo');
}

function inserirCampoNaFormula() {
  const campo = document.getElementById('cr-formula-campo')?.value;
  if (!campo) return;
  const textarea = document.getElementById('cr-formula');
  const token = `[${campo}]`;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + token.length;
}

function montarCondicaoCustomizada() {
  const campo = document.getElementById('cr-cond-campo')?.value || '';
  const op = document.getElementById('cr-cond-op')?.value || '';
  const valor = document.getElementById('cr-cond-valor')?.value || '';
  if (!campo || !op) return '';
  if (op === 'LIKE') return `[${campo}] LIKE "${valor}"`;
  return `[${campo}] ${op} "${valor}"`;
}

function preencherCondicaoBuilder(cond) {
  const campoEl = document.getElementById('cr-cond-campo');
  const opEl = document.getElementById('cr-cond-op');
  const valEl = document.getElementById('cr-cond-valor');
  if (!campoEl || !opEl || !valEl) return;
  campoEl.value = '';
  opEl.value = '';
  valEl.value = '';
  const txt = String(cond || '').trim();
  if (!txt) return;
  let m = txt.match(/^\[([^\]]+)\]\s+LIKE\s+["'](.+?)["']$/i);
  if (m) {
    renderSelectOptions('cr-cond-campo', m[1].trim(), true, 'Sem condição');
    campoEl.value = m[1].trim(); opEl.value = 'LIKE'; valEl.value = m[2]; return;
  }
  m = txt.match(/^\[([^\]]+)\]\s*(=|==|!=|>=|<=|>|<)\s*["']?(.+?)["']?$/i);
  if (m) {
    renderSelectOptions('cr-cond-campo', m[1].trim(), true, 'Sem condição');
    campoEl.value = m[1].trim(); opEl.value = m[2] === '==' ? '=' : m[2]; valEl.value = m[3];
  }
}

function renderCustomRules() {
  const wrap = document.getElementById('custom-rules-wrap');
  if (!customRules.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:1.5rem">Nenhuma regra customizada criada ainda</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="custom-rules">
      <thead><tr><th>Regra</th><th>Operação</th><th>Condição</th><th>Validação</th><th>Ações</th></tr></thead>
      <tbody>
        ${customRules.map((r, i) => `
          <tr>
            <td><strong>${r.nome}</strong><br><span class="pill pill-${r.severidade === 'warn' ? 'warn' : 'err'}">${r.ativo === false ? 'inativa' : (r.severidade === 'warn' ? 'alerta' : 'erro')}</span></td>
            <td>${RULE_GROUP_LABELS[r.operacao] || r.operacao || 'Todas'}</td>
            <td class="rule-code">${r.condicao || '—'}</td>
            <td class="rule-code">[${r.campo_validado}] = ${r.formula}<br>tol: ${r.tolerancia}</td>
            <td>
              <button class="btn-sm btn-inline" onclick="editarRegraCustomizada(${i})">editar</button>
              <button class="btn-sm btn-inline" onclick="duplicarRegraCustomizada(${i})">duplicar</button>
              <button class="btn-sm btn-inline" onclick="removerRegraCustomizada(${i})">remover</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function limparFormularioRegra() {
  document.getElementById('cr-index').value = '';
  document.getElementById('cr-ativo').value = 'SIM';
  document.getElementById('cr-operacao').value = 'ALL';
  document.getElementById('cr-severidade').value = 'err';
  document.getElementById('cr-nome').value = '';
  document.getElementById('cr-condicao').value = '';
  document.getElementById('cr-cond-campo').value = '';
  document.getElementById('cr-cond-op').value = '';
  document.getElementById('cr-cond-valor').value = '';
  document.getElementById('cr-campo').value = '';
  document.getElementById('cr-tolerancia').value = '0.05';
  document.getElementById('cr-mensagem').value = '';
  document.getElementById('cr-formula').value = '';
}

function salvarRegraCustomizada() {
  const idxRaw = document.getElementById('cr-index').value;
  const regra = {
    ativo: document.getElementById('cr-ativo').value === 'SIM',
    operacao: document.getElementById('cr-operacao').value,
    severidade: document.getElementById('cr-severidade').value,
    nome: document.getElementById('cr-nome').value.trim(),
    condicao: montarCondicaoCustomizada(),
    campo_validado: document.getElementById('cr-campo').value.trim(),
    tolerancia: document.getElementById('cr-tolerancia').value.trim() || '0.05',
    mensagem: document.getElementById('cr-mensagem').value.trim(),
    formula: document.getElementById('cr-formula').value.trim()
  };
  if (!regra.nome || !regra.campo_validado || !regra.formula) {
    _toast('Preencha pelo menos Nome da regra, Campo validado e Fórmula esperada.', 'warn');
    return;
  }
  if (idxRaw !== '') customRules[parseInt(idxRaw, 10)] = regra;
  else customRules.push(regra);
  persistirRegrasCustomizadas();
  limparFormularioRegra();
  renderCustomRules();
}

function editarRegraCustomizada(i) {
  const r = customRules[i];
  document.getElementById('cr-index').value = i;
  document.getElementById('cr-ativo').value = r.ativo === false ? 'NAO' : 'SIM';
  document.getElementById('cr-operacao').value = r.operacao || 'ALL';
  document.getElementById('cr-severidade').value = r.severidade || 'err';
  document.getElementById('cr-nome').value = r.nome || '';
  document.getElementById('cr-condicao').value = r.condicao || '';
  preencherCondicaoBuilder(r.condicao || '');
  renderSelectOptions('cr-campo', r.campo_validado || '', true, 'Selecione o campo');
  document.getElementById('cr-campo').value = r.campo_validado || '';
  document.getElementById('cr-tolerancia').value = r.tolerancia || '0.05';
  document.getElementById('cr-mensagem').value = r.mensagem || '';
  document.getElementById('cr-formula').value = r.formula || '';
}

function duplicarRegraCustomizada(i) {
  customRules.push({ ...customRules[i], nome: customRules[i].nome + ' (cópia)' });
  persistirRegrasCustomizadas();
  renderCustomRules();
}

async function removerRegraCustomizada(i) {
  const ok = await _confirmarModal('Remover regra', `Remover a regra "${customRules[i]?.nome || i}"?`, 'Remover', 'Cancelar');
  if (!ok) return;
  customRules.splice(i, 1);
  persistirRegrasCustomizadas();
  renderCustomRules();
}

function exportarRegrasCustomizadas() {
  const blob = new Blob([JSON.stringify(customRules, null, 2)], { type: 'application/json;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `regras_customizadas_prefat_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importarRegrasCustomizadas(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('JSON deve ser uma lista de regras.');
      customRules = imported;
      persistirRegrasCustomizadas();
      renderCustomRules();
      _toast('Regras importadas com sucesso.', 'ok');
    } catch(err) { _toast('Erro ao importar regras: ' + err.message, 'err'); }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function toggleRegra(key, el) {
  CFG.regras[key].on = !CFG.regras[key].on;
  el.classList.toggle('on', CFG.regras[key].on);
}

function renderCnpjList() {
  document.getElementById('cnpj-list').innerHTML = CFG.cnpjsInvalidos.map((c,i) => `
    <div class="cnpj-row">
      <span class="cnpj-code">${c.cnpj}</span>
      <span class="cnpj-msg">${c.msg}</span>
      <button class="btn-sm" onclick="removerCnpj(${i})">remover</button>
    </div>`).join('');
}

function adicionarCnpj() {
  const cnpj = document.getElementById('new-cnpj').value.replace(/\D/g,'');
  const msg  = document.getElementById('new-cnpj-msg').value.trim();
  if (cnpj.length < 14) { _toast('CNPJ deve ter 14 dígitos.', 'warn'); return; }
  if (CFG.cnpjsInvalidos.find(x => limparCnpj(x.cnpj) === cnpj)) { _toast('CNPJ já cadastrado.', 'warn'); return; }
  CFG.cnpjsInvalidos.push({ cnpj, msg: msg || 'CNPJ inválido' });
  document.getElementById('new-cnpj').value = '';
  document.getElementById('new-cnpj-msg').value = '';
  renderCnpjList();
}

function removerCnpj(i) {
  CFG.cnpjsInvalidos.splice(i, 1);
  renderCnpjList();
}

function renderColunas() {
  document.getElementById('cols-wrap').innerHTML = CFG.colunasObrigatorias.map((c,i) => `
    <div class="col-tag">
      ${c}
      <button onclick="removerColuna(${i})" title="remover">×</button>
    </div>`).join('');
}

function adicionarColuna() {
  const v = document.getElementById('new-col').value.trim();
  if (!v) return;
  if (CFG.colunasObrigatorias.includes(v)) { _toast('Coluna já existe.', 'warn'); return; }
  CFG.colunasObrigatorias.push(v);
  _canonicalMapCache = null; // invalida cache do mapa de colunas
  document.getElementById('new-col').value = '';
  renderColunas();
  popularCamposRegrasCustomizadas();
}

function removerColuna(i) {
  CFG.colunasObrigatorias.splice(i, 1);
  renderColunas();
  popularCamposRegrasCustomizadas();
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════
// MELHORIAS EXECUTIVAS, DEBUG, DUPLICIDADE E PRESETS
// ═══════════════════════════════════════════════════════
BADGE_CAT['Duplicidade'] = 'err';
BADGE_CAT['Valor Negativo'] = 'err';
BADGE_CAT['Revisar'] = 'warn';

function valorCampo(row, nomes, fallback = '') {
  for (const n of nomes) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return fallback;
}

function detectarOperacaoLinha(row) {
  const op = String(row['Operação'] ?? '').toUpperCase().trim();
  const transp = String(row['Nome Transportadora (3PL)'] ?? '').toUpperCase().trim();
  if (op.includes('LINE') || op === 'LH' || op.includes('LINEHAUL')) return 'LH';
  if (op.includes('LAST') || op === 'LM' || op === 'LMH' || op.includes('LAST MILE')) return 'LM';
  if (op.includes('BIGS') || transp.includes('BIGS')) return 'FM Bigs';
  if (op === 'FM' || op === 'FMH' || op.includes('FIRST MILE')) return 'FM';
  return op || 'Não identificado';
}

function isLHFamilia(row) { return detectarOperacaoLinha(row) === 'LH'; }
function isLMFamilia(row) { return detectarOperacaoLinha(row) === 'LM'; }
function isFMFamilia(row) { const f = detectarOperacaoLinha(row); return f === 'FM' || f === 'FM Bigs'; }

function trackingDaLinha(row) {
  return String(valorCampo(row, [
    '3PL Tracking Number / Número Etiqueta / Ordem (Shopee)',
    'tracking_no', 'Tracking', 'Shipment ID', 'shipment_id'
  ], '')).trim();
}

function rotaDaLinha(row) {
  return String(valorCampo(row, ['Rota','id_rota','Id_Rota','Fator Agrupador (p/ Cobrança por Veiculo)'], '')).trim();
}

function fatorDaLinha(row) {
  return String(valorCampo(row, ['Fator Agrupador (p/ Cobrança por Veiculo)','id_rota','Rota'], '')).trim();
}

function cnpjTomadorLinha(row) { return String(row['CNPJ Tomador'] ?? '').trim(); }
function flagDeferralLinha(row) { return String(valorCampo(row, ['active_deferral','Flag Agrupamento Misto'], '')).trim(); }

function chaveFiscalCorreta(row) {
  const fam = detectarOperacaoLinha(row);
  if (fam === 'LH') return `LH|Rota=${rotaDaLinha(row)}|CNPJ=${cnpjTomadorLinha(row)}|Deferral=${flagDeferralLinha(row) || 'NA'}`;
  if (fam === 'LM') return `LM|Fator=${fatorDaLinha(row)}|CNPJ=${cnpjTomadorLinha(row)}`;
  if (fam === 'FM' || fam === 'FM Bigs') return `${fam}|Rota=${rotaDaLinha(row)}`;
  return `${fam}|Rota=${rotaDaLinha(row)}|CNPJ=${cnpjTomadorLinha(row)}`;
}

function baseOperacional(row, colsSet, usarGris = true) {
  const tem = c => colsSet.has(c);
  const freteBase = tem('Frete/Tarifa Base (Peso/KM/Veículo)') ? (num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? 0) : (num(row['Tarifa Aplicada']) ?? 0);
  const gris = usarGris ? (num(row['GRIS']) ?? 0) : 0;
  const outros = num(row['Outros Valores']) ?? 0;
  const espera = tem('Tarifa de Espera') ? (num(row['Tarifa de Espera']) ?? 0) : 0;
  const desc = num(row['Descontos']) ?? 0;
  return { freteBase, gris, outros, espera, desc, soma: freteBase + gris + outros + espera - desc };
}

function debugCalculoLinha(row, cols) {
  const colsSet = new Set(cols || Object.keys(row));
  const fam = detectarOperacaoLinha(row);
  const aliqPct = normalizarAliquotaPercentual(row['Aliquota ICMS/ISS']);
  const aliq = normalizarAliquotaTaxa(row['Aliquota ICMS/ISS']);
  const baseArquivo = num(row['Base Calc ICMS/ISS']) ?? 0;
  const icmsArquivo = num(row['Valor ICMS/ISS']) ?? 0;
  const vfrArquivo = num(row['Valor Final à Receber']) ?? 0;
  const bCom = baseOperacional(row, colsSet, true);
  const bSem = baseOperacional(row, colsSet, false);
  const grossCom = aliq < 1 ? (bCom.soma / (1 - aliq)) : 0;
  const icmsCom = grossCom * aliq;
  const vfrCom = bCom.soma + icmsArquivo;
  const vfrSem = bSem.soma + icmsArquivo;
  return [
    `Operação detectada=${fam}`,
    `FreteBase=${bCom.freteBase.toFixed(4)}`,
    `GRIS=${bCom.gris.toFixed(4)}`,
    `Outros=${bCom.outros.toFixed(4)}`,
    `Espera=${bCom.espera.toFixed(4)}`,
    `Desc=${bCom.desc.toFixed(4)}`,
    `Alíquota normalizada=${(aliqPct ?? 0).toFixed(4)}%`,
    `Base arquivo=${baseArquivo.toFixed(4)}`,
    `ICMS/ISS arquivo=${icmsArquivo.toFixed(4)}`,
    `VFR arquivo=${vfrArquivo.toFixed(4)}`,
    `VFR esperado com GRIS=${vfrCom.toFixed(4)}`,
    `VFR esperado sem GRIS=${vfrSem.toFixed(4)}`,
    `Gross-up com GRIS=${grossCom.toFixed(4)}`,
    `ICMS/ISS esperado gross-up=${icmsCom.toFixed(4)}`
  ].join(' | ');
}

function severidadeErro(e) {
  const t = BADGE_CAT[e.cat] || 'info';
  if (t === 'err') return 'critico';
  if (t === 'warn') return 'alerta';
  return 'revisar';
}

function addMetaErro(e, row, cols) {
  if (!e || !row) return e;
  e.operacao_detectada = detectarOperacaoLinha(row);
  e.transportadora = row['Nome Transportadora (3PL)'] ?? '';
  e.rota = row['Rota'] ?? row['id_rota'] ?? '';
  e.fator = row['Fator Agrupador (p/ Cobrança por Veiculo)'] ?? '';
  const mEsp = String(e.desc || '').match(/Esperado:\s*R\$\s*([0-9.,-]+)/i);
  const mArq = String(e.desc || '').match(/Arquivo:\s*R\$\s*([0-9.,-]+)/i);
  const mDiff = String(e.desc || '').match(/Diff:\s*R\$\s*([0-9.,-]+)/i);
  e.valor_esperado = mEsp ? mEsp[1] : '';
  e.valor_arquivo = mArq ? mArq[1] : '';
  e.diferenca = mDiff ? mDiff[1] : '';
  if (e.cat === 'ICMS/ISS' || e.cat === 'Regra Customizada') {
    e.debug = debugCalculoLinha(row, cols); // mantém no objeto para CSV/relatório, mas não exibe na UI
  }
  return e;
}

function resumoOperacoes(rows) {
  const out = {};
  rows.forEach(r => {
    const op = detectarOperacaoLinha(r);
    out[op] = out[op] || { linhas: 0, erros: 0, alertas: 0, revisar: 0 };
    out[op].linhas += 1;
  });
  return out;
}

async function validarExtrasQualidade(rows, nomeArquivo) {
  const erros = [];
  if (!rows || !rows.length) return erros;
  // Rows já vêm normalizadas do wrapper — sem re-normalizar
  const rowsNorm = rows;
  const cols = Object.keys(rowsNorm[0]).filter(c => !String(c).startsWith('_'));
  const colsSet = new Set(cols);

  // Valores negativos — chunked para não bloquear em arquivos grandes
  const camposNaoNegativos = [
    'Tarifa Aplicada','Frete/Tarifa Base (Peso/KM/Veículo)','Frete Calculado','GRIS','Outros Valores',
    'Valor ICMS/ISS','Base Calc ICMS/ISS','Valor Final à Receber','Valor nota Fiscal Mercadoria'
  ];
  const camposPresentes = camposNaoNegativos.filter(c => colsSet.has(c));
  for (let i = 0; i < rowsNorm.length; i++) {
    const r = rowsNorm[i];
    camposPresentes.forEach(c => {
      const v = num(r[c]);
      if (v !== null && v < -CFG.tolerancia) {
        erros.push(reg('Valor Negativo', r._linha_excel, r['id_rota'] || fatorDaLinha(r),
          `Campo '${c}' com valor negativo: R$ ${v.toFixed(4)}`,
          `Operação detectada=${detectarOperacaoLinha(r)} | 3PL=${r['Nome Transportadora (3PL)'] || ''}`, getBR(r)));
      }
    });
    if (i % 5000 === 4999) await yieldToUI();
  }

  // Duplicidade de cobrança
  const mapa = new Map();
  rowsNorm.forEach(r => {
    const trk = trackingDaLinha(r);
    if (!trk) return;
    const key = `${detectarOperacaoLinha(r)}|Rota=${rotaDaLinha(r)}|Fator=${fatorDaLinha(r)}|CNPJ=${cnpjTomadorLinha(r)}|Tracking=${trk}`;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key).push(r);
  });
  mapa.forEach((lista) => {
    if (lista.length > 1) {
      const linhas = lista.map(x => x._linha_excel).join(', ');
      const r = lista[0];
      erros.push(reg('Duplicidade', r._linha_excel, r['id_rota'] || fatorDaLinha(r),
        `Possível duplicidade de cobrança: ${lista.length} linhas com mesmo tracking no mesmo agrupamento operacional`,
        `Linhas=${linhas}`, getBR(r)));
    }
  });
  await yieldToUI();

  // Lookup O(1) por linha para addMetaErro
  const byLine = new Map(rowsNorm.map(r => [String(r._linha_excel), r]));
  return erros.map(e => {
    const row = byLine.get(String(e.linha));
    return addMetaErro(e, row, cols);
  });
}

const __validarArquivoBase = validarArquivo;
validarArquivo = async function(rows, nome) {
  // Não re-normaliza rows que já foram normalizadas (evita 115M ops de regex em arquivos grandes)
  const rowsNorm = (rows && rows.length > 0 && rows[0]?.__normalizado) ? rows : normalizarColunas(rows || []);
  const cols = rowsNorm.length ? Object.keys(rowsNorm[0]).filter(c => !String(c).startsWith('_')) : [];
  const base = (await __validarArquivoBase(rowsNorm, nome)) || [];
  const byLine = new Map(rowsNorm.map(r => [String(r._linha_excel), r]));
  base.forEach(e => {
    const row = byLine.get(String(e.linha));
    if (row) addMetaErro(e, row, cols);
    e.severidade = severidadeErro(e);
  });
  const extras = await validarExtrasQualidade(rowsNorm, nome);
  extras.forEach(e => e.severidade = severidadeErro(e));
  return base.concat(extras);
};

function statusResultado(erros) {
  const criticos = erros.filter(e => (BADGE_CAT[e.cat] || 'info') === 'err').length;
  const alertas = erros.filter(e => (BADGE_CAT[e.cat] || 'info') === 'warn').length;
  if (criticos > 0) return { texto: `REPROVADO — corrigir ${criticos} erro(s) crítico(s)`, cls: 'status-rejected' };
  if (alertas > 0) return { texto: `APROVADO COM RESSALVA — revisar ${alertas} alerta(s)`, cls: 'status-review' };
  return { texto: 'APROVADO', cls: 'status-approved' };
}

function garantirBlocosExecutivos() { /* replaced — exec-status/op-summary removed */ }


function renderResumoOperacoesGlobal() { /* replaced — op-summary removed */ }

// renderResultados now calls renderInsights directly (no duplicate exec-status)
// Falha banner kept inline
const __renderResultadosBase = renderResultados;
renderResultados = function() {
  __renderResultadosBase();
  // Failure banner
  const falhas = appState.results.filter(r => r.status === 'falha');
  let bannerFalha = document.getElementById('banner-falhas');
  if (falhas.length > 0) {
    if (!bannerFalha) {
      bannerFalha = document.createElement('div');
      bannerFalha.id = 'banner-falhas';
      const list = document.getElementById('results-list');
      if (list) list.insertAdjacentElement('beforebegin', bannerFalha);
    }
    bannerFalha.style.cssText = 'background:var(--red-dim);border:1px solid rgba(239,68,68,.35);border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:12px;color:var(--red)';
    bannerFalha.innerHTML = `<b>⚠️ ${falhas.length} arquivo(s) com falha ao processar:</b> ${falhas.map(r=>r.nome).join(', ')}.`;
  } else if (bannerFalha) { bannerFalha.remove(); }
  // Single table: renderInsights (has Detalhe column — better than dashboard)
  try { renderInsights(); } catch(e) { console.error('[render] Insights:', e); }
};

const __renderTabelaErrosBase = renderTabelaErros;
// renderTabelaErros already handles severity chips and ignore button — no override needed

function _baixarErrosTxt(ri) {
  const r = appState.results[ri];
  if (!r) return;
  const ativos = errosAtivos(r);
  if (!ativos.length) { _toast('Nenhum erro ativo para baixar', 'warn'); return; }
  const sep = '\t', nl = '\n';
  const lines = ativos.map(e =>
    [e.cat, e.linha !== '\u2014' ? 'L'+e.linha : '', e.trip !== '\u2014' ? e.trip : '', e.desc, e.det]
    .filter(Boolean).join(sep)
  );
  const blob = new Blob([lines.join(nl)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = r.nome.replace(/\.xlsx$/i, '') + '_erros.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportarCSV(btn) {
  if (!appState.results.length) { _toast('Execute uma validação antes de exportar.', 'warn'); return; }
  const labelOrig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando…'; }
  setTimeout(() => {
    try {
      const rows = [[
        'Arquivo','Status Final','Ignorado (PMO)','Severidade','Operação Detectada','3PL','Rota','Fator Agrupador',
        'Categoria','Linha','id_rota','Descrição','Valor Esperado','Valor Arquivo','Diferença','Detalhe/Debug'
      ]];
      appState.results.forEach(r => {
        const st = statusResultado(r.erros || []).texto;
        (r.erros || []).forEach(e => {
          const eKey = ignoredKey(r.nome, e.cat);
          rows.push([
            r.nome, st, ignoredSet.has(eKey) ? 'SIM' : 'NÃO',
            severidadeErro(e), e.operacao_detectada || '', e.transportadora || '', e.rota || '', e.fator || '',
            e.cat, e.linha, e.trip, e.desc, e.valor_esperado || '', e.valor_arquivo || '', e.diferenca || '', e.det || ''
          ]);
        });
      });
      const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `validacao_prefat_completa_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = labelOrig; }
    }
  }, 30);
}

function serializarPresetAtual() {
  return {
    tolerancia: CFG.tolerancia,
    descontoSegundaSaida: CFG.descontoSegundaSaida,
    aliquotas_validas: [...CFG.aliquotas_validas],
    regras: CFG.regras,
    cnpjsInvalidos: CFG.cnpjsInvalidos,
    colunasObrigatorias: CFG.colunasObrigatorias,
    customRules
  };
}

function aplicarPreset(p) {
  if (!p) return;
  if (p.tolerancia !== undefined) CFG.tolerancia = p.tolerancia;
  if (p.descontoSegundaSaida !== undefined) CFG.descontoSegundaSaida = p.descontoSegundaSaida;
  if (p.aliquotas_validas) CFG.aliquotas_validas = new Set(p.aliquotas_validas);
  if (p.regras) Object.assign(CFG.regras, p.regras);
  if (p.cnpjsInvalidos) CFG.cnpjsInvalidos = p.cnpjsInvalidos;
  if (p.colunasObrigatorias) CFG.colunasObrigatorias = p.colunasObrigatorias;
  if (p.customRules) { customRules = p.customRules; persistirRegrasCustomizadas(); }
  renderConfig();
}

function salvarPresetAtual() {
  localStorage.setItem('validador_prefat_preset_oficial', JSON.stringify(serializarPresetAtual()));
  _toast('✅ Preset salvo neste navegador.', 'ok');
}
function carregarPresetSalvo() {
  const raw = localStorage.getItem('validador_prefat_preset_oficial');
  if (!raw) { _toast('⚠️ Nenhum preset salvo encontrado.', 'warn'); return; }
  aplicarPreset(JSON.parse(raw));
  _toast('✅ Preset carregado com sucesso.', 'ok');
}
async function restaurarPresetPadraoSeguro() {
  const ok = await _confirmarModal('Restaurar padrão', 'Isso redefine todas as configurações de tela para os valores padrão.\nNão apaga arquivos nem regras customizadas.', 'Restaurar', 'Cancelar');
  if (!ok) return;
  CFG.tolerancia = 0.05;
  CFG.descontoSegundaSaida = 0.30;
  CFG.aliquotas_validas = new Set(Array.from({length:23}, (_,i)=>i));
  customRules = [];
  persistirRegrasCustomizadas();
  renderConfig();
}

const __renderConfigBase = renderConfig;
renderConfig = function() {
  __renderConfigBase();
  if (!document.getElementById('preset-box')) {
    const page = document.getElementById('val-page-config');
    const box = document.createElement('div');
    box.id = 'preset-box';
    box.className = 'preset-box';
    box.innerHTML = `
      <div class="config-section-title">Presets e segurança</div>
      <div class="rule-help">Salve/carregue a configuração de regras para evitar perder ajustes. O padrão seguro usa alíquotas de 0 a 22.</div>
      <button class="btn-add" onclick="salvarPresetAtual()">Salvar preset atual</button>
      <button class="btn-sm" onclick="carregarPresetSalvo()" style="margin-left:8px">Carregar preset salvo</button>
      <button class="btn-sm" onclick="restaurarPresetPadraoSeguro()" style="margin-left:8px">Restaurar padrão seguro</button>`;
    const firstSection = page.querySelector('.config-section');
    firstSection.insertAdjacentElement('beforebegin', box);
  }
};

// Garante alíquotas padrão 0..22 nesta versão.
CFG.aliquotas_validas = new Set(Array.from({length:23}, (_,i)=>i));

renderConfig();

// ═══════════════════════════════════════════════════════
// RELATÓRIO FORMAL DE VALIDAÇÃO (v3.22)
// ═══════════════════════════════════════════════════════
function gerarRelatorio() {
  if (!appState.results.length) { _toast('Execute uma validação antes de gerar o relatório.', 'warn'); return; }

  // helper: usa o mesmo ignoredSet da UI — mesma lógica de errosAtivos()
  function isIgn(r, e) { return ignoredSet.has(ignoredKey(r.nome, e.cat)) || ignoredSet.has(ignoredKeyGlobal(e.cat)); }
  function ativos(r)   { return (r.erros||[]).filter(e => !isIgn(r,e)); }

  const data       = new Date().toLocaleString('pt-BR');
  const totalArq   = appState.results.length;
  // Passagem única sobre todos os erros ativos
  let nCriticos = 0, nAlertas = 0;
  appState.results.forEach(r => ativos(r).forEach(e => {
    if ((BADGE_CAT[e.cat]||'info') === 'err') nCriticos++; else nAlertas++;
  }));
  const nIgnorados = ignoredSet.size;
  const semErro    = appState.results.filter(r => ativos(r).length === 0).length;
  const totalOcorr = nCriticos + nAlertas;

  let statusLabel, statusIcon, statusColor, statusBg, statusBorder;
  if (nCriticos > 0) {
    statusLabel = 'REPROVADO';            statusIcon = '🔴';
    statusColor = '#dc2626'; statusBg = '#fef2f2'; statusBorder = '#fca5a5';
  } else if (nAlertas > 0) {
    statusLabel = 'APROVADO COM RESSALVA'; statusIcon = '⚠️';
    statusColor = '#d97706'; statusBg = '#fffbeb'; statusBorder = '#fcd34d';
  } else {
    statusLabel = 'APROVADO';             statusIcon = '✅';
    statusColor = '#16a34a'; statusBg = '#f0fdf4'; statusBorder = '#86efac';
  }

  function _statusArquivo(r) {
    const errs = ativos(r);
    const crit = errs.filter(e=>(BADGE_CAT[e.cat]||'info')==='err').length;
    const warn = errs.filter(e=>(BADGE_CAT[e.cat]||'info')!=='err').length;
    if (crit > 0) return {label:'REPROVADO',    color:'#dc2626', bg:'#fef2f2', border:'#fca5a5', icon:'🔴', crit, warn};
    if (warn > 0) return {label:'COM RESSALVA', color:'#d97706', bg:'#fffbeb', border:'#fcd34d', icon:'⚠️', crit, warn};
    return               {label:'APROVADO',     color:'#16a34a', bg:'#f0fdf4', border:'#86efac', icon:'✅', crit:0, warn:0};
  }

  // Top error categories (apenas ativos)
  const catMap = {};
  appState.results.forEach(r => ativos(r).forEach(e => {
    if (!catMap[e.cat]) catMap[e.cat] = {total:0, sev:BADGE_CAT[e.cat]||'info', arqs:new Set()};
    catMap[e.cat].total++;
    catMap[e.cat].arqs.add(r.nome);
  }));
  const topCats = Object.entries(catMap).sort((a,b)=>b[1].total-a[1].total).slice(0,10);

  const nRep  = appState.results.filter(r=>ativos(r).some(e=>(BADGE_CAT[e.cat]||'info')==='err')).length;
  const nRess = appState.results.filter(r=>!ativos(r).some(e=>(BADGE_CAT[e.cat]||'info')==='err') && ativos(r).length>0).length;

  let html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório Prefat — ${data}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#1f2937;background:#fff;max-width:960px;margin:0 auto;padding:28px}
  .print-btn{display:flex;align-items:center;gap:8px;margin-bottom:20px}
  .print-btn button{padding:8px 20px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500}
  .header{border-bottom:2px solid #e5e7eb;padding-bottom:16px;margin-bottom:20px}
  .header h1{font-size:22px;font-weight:700;color:#111827;margin-bottom:4px}
  .header .sub{font-size:12px;color:#6b7280}
  .status-box{display:flex;align-items:center;gap:16px;padding:16px 20px;border-radius:10px;margin-bottom:20px;border:2px solid}
  .status-icon{font-size:28px}
  .status-label{font-size:20px;font-weight:800;letter-spacing:-.02em}
  .status-sub{font-size:12px;margin-top:3px;opacity:.8}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px}
  .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center}
  .kpi .k-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:6px}
  .kpi .k-value{font-size:26px;font-weight:700}
  .kpi.red .k-value{color:#dc2626} .kpi.green .k-value{color:#16a34a}
  .kpi.yellow .k-value{color:#d97706} .kpi.blue .k-value{color:#3b82f6}
  .kpi.purple .k-value{color:#7c3aed}
  h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#374151;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid #e5e7eb}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:4px}
  th{background:#f9fafb;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb}
  td{padding:6px 10px;border-bottom:1px solid #f3f4f6;vertical-align:top}
  tr:hover td{background:#fafafa}
  .chip{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700}
  .chip-err{background:#fee2e2;color:#dc2626}
  .chip-warn{background:#fef3c7;color:#d97706}
  .chip-ok{background:#dcfce7;color:#16a34a}
  .chip-ign{background:#ede9fe;color:#7c3aed}
  .file-block{margin-bottom:18px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;page-break-inside:avoid}
  .file-header{display:flex;align-items:center;gap:10px;padding:10px 14px}
  .file-name{font-weight:600;font-size:12px;flex:1;font-family:monospace}
  .file-status-badge{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid;white-space:nowrap}
  .file-ok{padding:10px 14px;color:#16a34a;font-size:12px}
  .mono{font-family:monospace}
  .stats-row{padding:8px 14px;background:#f9fafb;border-top:1px solid #f3f4f6;font-size:11px;color:#6b7280;display:flex;flex-wrap:wrap;gap:14px}
  .stat-item b{color:#374151}
  .ign-note{padding:6px 14px;font-size:11px;color:#7c3aed;border-top:1px solid #f3f4f6;background:#faf5ff}
  @media print{body{padding:8px}.print-btn{display:none}.file-block{page-break-inside:avoid}}
</style>
</head><body>
<div class="print-btn">
  <button onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  <span style="font-size:11px;color:#9ca3af">No diálogo de impressão, selecione "Salvar como PDF"</span>
</div>

<div class="header">
  <h1>📋 Relatório de Validação de Prefat</h1>
  <div class="sub">Gerado em ${data} · Hub Central PMO · Logística &amp; Fiscal · Validador Prefat v3.22</div>
</div>

<div class="status-box" style="background:${statusBg};border-color:${statusBorder}">
  <div class="status-icon">${statusIcon}</div>
  <div>
    <div class="status-label" style="color:${statusColor}">${statusLabel}</div>
    <div class="status-sub" style="color:${statusColor}">
      ${nCriticos} erro(s) crítico(s) · ${nAlertas} alerta(s) · ${nIgnorados} categoria(s) ignorada(s) pelo PMO · ${totalArq} arquivo(s) processado(s)
    </div>
  </div>
</div>

<div class="kpis">
  <div class="kpi blue"><div class="k-label">📁 Arquivos</div><div class="k-value">${totalArq}</div></div>
  <div class="kpi green"><div class="k-label">✅ Aprovados</div><div class="k-value">${semErro}</div></div>
  <div class="kpi red"><div class="k-label">🔴 Reprovados</div><div class="k-value">${nRep}</div></div>
  <div class="kpi yellow"><div class="k-label">⚠️ Com ressalva</div><div class="k-value">${nRess}</div></div>
  <div class="kpi purple"><div class="k-label">📌 Ocorrências</div><div class="k-value">${totalOcorr}</div></div>
</div>`;

  // Resumo por arquivo
  html += `<h2>Resumo por arquivo</h2><table>
  <thead><tr><th>Arquivo</th><th>Status</th><th style="text-align:right">Críticos</th><th style="text-align:right">Alertas</th><th style="text-align:right">Ignorados</th></tr></thead>
  <tbody>`;
  appState.results.forEach(r => {
    const fs  = _statusArquivo(r);
    const ign = (r.erros||[]).filter(e=>isIgn(r,e)).length;
    html += `<tr>
      <td class="mono">${r.nome}</td>
      <td><span class="chip chip-${fs.crit>0?'err':fs.warn>0?'warn':'ok'}">${fs.icon} ${fs.label}</span></td>
      <td style="text-align:right;color:${fs.crit>0?'#dc2626':'#9ca3af'};font-weight:${fs.crit>0?700:400}">${fs.crit||'—'}</td>
      <td style="text-align:right;color:${fs.warn>0?'#d97706':'#9ca3af'};font-weight:${fs.warn>0?700:400}">${fs.warn||'—'}</td>
      <td style="text-align:right;color:${ign>0?'#7c3aed':'#9ca3af'}">${ign||'—'}</td>
    </tr>`;
  });
  html += `</tbody></table>`;

  // Top categorias
  if (topCats.length) {
    html += `<h2>Principais problemas encontrados (ativos)</h2><table>
    <thead><tr><th>Tipo de problema</th><th>Severidade</th><th style="text-align:right">Linhas afetadas</th><th style="text-align:right">Arquivos afetados</th></tr></thead>
    <tbody>`;
    topCats.forEach(([cat,d]) => {
      const isErr = d.sev==='err';
      html += `<tr>
        <td>${cat}</td>
        <td><span class="chip chip-${isErr?'err':'warn'}">${isErr?'CRÍTICO':'ALERTA'}</span></td>
        <td style="text-align:right;font-weight:700;color:${isErr?'#dc2626':'#d97706'}">${d.total.toLocaleString('pt-BR')}</td>
        <td style="text-align:right">${d.arqs.size} de ${totalArq}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  // Detalhamento por arquivo
  html += `<h2>Detalhamento por arquivo</h2>`;
  appState.results.forEach(r => {
    const errsAtiv = ativos(r);
    const errsIgn  = (r.erros||[]).filter(e=>isIgn(r,e));
    const fs       = _statusArquivo(r);
    html += `<div class="file-block">
      <div class="file-header" style="background:${fs.bg};border-bottom:1px solid ${fs.border}">
        <div class="file-name">${r.nome}</div>
        <div class="file-status-badge" style="color:${fs.color};border-color:${fs.border};background:#fff">${fs.icon} ${fs.label}</div>
      </div>`;

    if (!errsAtiv.length && !errsIgn.length) {
      html += `<div class="file-ok">✅ Nenhuma ocorrência — arquivo aprovado</div>`;
    } else {
      if (errsAtiv.length) {
        html += `<table><thead><tr><th>Linha</th><th>Tipo de problema</th><th>Sev.</th><th>Descrição</th></tr></thead><tbody>`;
        errsAtiv.slice(0, 300).forEach(e => {
          const isE = (BADGE_CAT[e.cat]||'info')==='err';
          html += `<tr>
            <td class="mono" style="color:#9ca3af;white-space:nowrap">${e.linha||'—'}</td>
            <td style="white-space:nowrap">${e.cat||''}</td>
            <td><span class="chip chip-${isE?'err':'warn'}">${isE?'CRÍTICO':'ALERTA'}</span></td>
            <td>${e.desc||''}</td>
          </tr>`;
        });
        if (errsAtiv.length > 300) html += `<tr><td colspan="4" style="color:#9ca3af;font-style:italic;text-align:center;padding:8px">… e mais ${errsAtiv.length-300} ocorrência(s) não exibidas — baixe o CSV completo na interface para ver todas.</td></tr>`;
        html += `</tbody></table>`;
      }
      if (errsIgn.length) {
        const cats = [...new Set(errsIgn.map(e=>e.cat))].join(', ');
        html += `<div class="ign-note">🙈 ${errsIgn.length} ocorrência(s) ignorada(s) pelo PMO — categorias: ${cats}</div>`;
      }
    }

    if (r.stats && Object.keys(r.stats).length) {
      html += `<div class="stats-row">`;
      const alias = {'Frete/Tarifa Base (Peso/KM/Veículo)':'Frete Base','Valor nota Fiscal Mercadoria':'Valor NF','Valor Final à Receber':'VFR'};
      Object.entries(r.stats).forEach(([col,s]) => {
        const nm = alias[col]||col;
        html += `<div class="stat-item"><b>${nm}</b>: soma R$${s.sum.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} · média R$${s.avg.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  });

  html += `<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
    Validador Prefat v3.22 · Hub Central PMO · ${data}
  </div>
</body></html>`;

  const w = window.open('','_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ═══════════════════════════════════════════════════════
// AJUSTE PREFAT
// ═══════════════════════════════════════════════════════












// ══ Ajustar Prefat ══════════════════════════════════════════════════════════
function ajGetResultado() {
  const sel = document.getElementById('aj-arquivo');
  const idx = parseInt(sel.value || '0');
  return (appState.results.filter(r => r.file || (r.rows && r.rows.length))[idx]) || null;
}

function ajSetBadge(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = n > 0 ? n + ' linha(s)' : '✓ ok';
  el.className = 'ajuste-badge ' + (n > 0 ? 'err' : 'ok');
}

function ajContarDesvios(r) {
  const T = CFG.tolerancia || 0.05; // BUG FIX: era 0.5 (10× acima da tolerância padrão)
  let gris = 0, base = 0, icms = 0, vfr = 0, imposto = 0;
  (r.rows || []).forEach(row => {
    const nf    = num(row['Valor nota Fiscal Mercadoria']);
    const bCalc = num(row['Base Calc ICMS/ISS']);
    const aliq  = num(row['Aliquota ICMS/ISS']);
    const icmsV = num(row['Valor ICMS/ISS']) ?? 0;
    const vfrV  = num(row['Valor Final à Receber']);
    const frete = num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? 0;
    const adv   = num(row['ADV']) ?? 0;
    const outros= num(row['Outros Valores']) ?? 0;
    const desc  = num(row['Descontos']) ?? 0;
    const grisV = num(row['GRIS']) ?? 0;

    if (nf && nf > 0 && Math.abs(parseFloat((nf*0.001).toFixed(4)) - grisV) > T) gris++;
    if (vfrV !== null && bCalc !== null && Math.abs(vfrV - bCalc) > T) base++;
    if (bCalc && aliq && Math.abs(parseFloat((bCalc*aliq/100).toFixed(4)) - icmsV) > T) icms++;
    if (vfrV !== null) {
      const esp = parseFloat((frete+adv+grisV+outros+icmsV-desc).toFixed(4));
      if (Math.abs(esp - vfrV) > T) vfr++;
    }
    // IMPOSTO: verifica se o texto bate com a regra da alíquota
    const aliqPctI = normalizarAliquotaPercentual(row['Aliquota ICMS/ISS']);
    if (aliqPctI !== null) {
      const impostoAtual = String(row['IMPOSTO'] ?? '').trim().toUpperCase();
      const impostoCorr  = aliqPctI === 0 ? '' : aliqPctI <= 5 ? 'ISS' : 'ICMS';
      if (impostoAtual !== impostoCorr) imposto++;
    }
  });
  return { gris, base, icms, vfr, imposto };
}

function ajAtualizarBadges() {
  const r = ajGetResultado();
  if (!r) return;
  const d = ajContarDesvios(r);
  ajSetBadge('aj-b-gris', d.gris);
  ajSetBadge('aj-b-base', d.base);
  ajSetBadge('aj-b-icms', d.icms);
  ajSetBadge('aj-b-vfr',  d.vfr);
  ajSetBadge('aj-b-imposto', d.imposto);
  ajAtualizarBotao();
}

function ajAtualizarBotao() {
  const algum = ['aj-gris','aj-base','aj-icms','aj-vfr','aj-imposto'].some(id => {
    const el = document.getElementById(id);
    return el && el.checked;
  });
  const btn = document.getElementById('aj-btn');
  btn.disabled = !algum;
  btn.style.opacity = algum ? '1' : '.5';
  btn.style.cursor  = algum ? 'pointer' : 'not-allowed';

  const r = ajGetResultado();
  const resumo = document.getElementById('aj-resumo');
  if (algum && r) {
    const d = ajContarDesvios(r);
    const partes = [];
    if (document.getElementById('aj-gris').checked    && d.gris)    partes.push('GRIS (' + d.gris + ')');
    if (document.getElementById('aj-base').checked    && d.base)    partes.push('Base Calc (' + d.base + ')');
    if (document.getElementById('aj-icms').checked    && d.icms)    partes.push('ICMS (' + d.icms + ')');
    if (document.getElementById('aj-vfr').checked     && d.vfr)     partes.push('VFR (' + d.vfr + ')');
    if (document.getElementById('aj-imposto').checked && d.imposto) partes.push('IMPOSTO (' + d.imposto + ')');
    resumo.innerHTML = partes.length
      ? '<strong>Será corrigido:</strong> ' + partes.join(' · ')
      : '✓ Nenhum desvio detectado nos campos selecionados.';
    resumo.style.display = 'block';
  } else {
    resumo.style.display = 'none';
  }
}

// Recarrega rows de um resultado sob demanda (re-lê o File e re-normaliza)
async function _recarregarRows(r) {
  if (r.rows && r.rows.length > 0) return; // já tem rows
  if (!r.file) { throw new Error('Arquivo original não disponível. Faça upload novamente.'); }
  // Timeout de segurança com cleanup — evita que o setTimeout fique pendurado após resolve
  let _timeoutHandle;
  const _timeout = new Promise((_, reject) => {
    _timeoutHandle = setTimeout(() => reject(new Error('Timeout ao reler arquivo — possível arquivo muito grande ou corrompido.')), 3 * 60 * 1000);
  });
  const rawRows = await Promise.race([
    lerExcel(r.file).finally(() => clearTimeout(_timeoutHandle)),
    _timeout
  ]);
  let normRows;
  if (rawRows.length > 5000) {
    normRows = await normalizarColunasAsync(rawRows, () => {});
    normRows = normRows.map(row => { row.__normalizado = true; return row; });
  } else {
    normRows = normalizarColunas(rawRows);
  }
  r.rows = normRows;
}

// ══ Edição manual de uma linha (sem baixar/reenviar arquivo) ══════════════
async function _rowsParaEdicao(r) {
  if (r.rows && r.rows.length) return r.rows;
  if (r._blobUrl) {
    const resp = await fetch(r._blobUrl);
    const buf  = await resp.arrayBuffer();
    const f = new File([buf], r._blobNome || r.nome,
      { type: r._isCsv ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const rawRows = await lerExcel(f);
    r.rows = normalizarColunas(rawRows);
    return r.rows;
  }
  await _recarregarRows(r);
  return r.rows;
}

let _editLinhaCtx = null;

async function abrirEditorLinha(ri, linha) {
  const r = appState.results[ri];
  if (!r) { _toast('⚠️ Arquivo não encontrado.', 'warn'); return; }
  let rows;
  try {
    rows = await _rowsParaEdicao(r);
  } catch (e) {
    _toast('❌ Não foi possível carregar os dados da linha: ' + e.message, 'err', 6000);
    return;
  }
  const row = (rows || []).find(x => x._linha_excel === linha);
  if (!row) { _toast('⚠️ Linha não encontrada — pode já ter sido alterada.', 'warn'); return; }
  _editLinhaCtx = { ri, linha };
  _renderModalEdicaoLinha(row, linha);
}

function _renderModalEdicaoLinha(row, linha) {
  const campos = Object.keys(row).filter(k => !k.startsWith('_') && k !== '__normalizado');
  let overlay = document.getElementById('edit-linha-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'edit-linha-overlay';
  overlay.className = 'modal-overlay show';
  overlay.addEventListener('click', ev => { if (ev.target === overlay) fecharEditorLinha(); });
  overlay.innerHTML = `
    <div class="modal" style="width:min(680px,95vw)">
      <div class="modal-title">Editar linha ${escHtml(String(linha))}
        <button class="modal-close" onclick="fecharEditorLinha()">✕</button>
      </div>
      <div style="max-height:56vh;overflow-y:auto;padding-right:4px;margin-bottom:6px">
        <div class="grid2">
          ${campos.map(c => `
            <div class="form-row">
              <label class="label">${escHtml(c)}</label>
              <input class="input" data-campo="${escHtml(c).replace(/"/g,'&quot;')}" value="${escHtml(row[c] ?? '')}">
            </div>`).join('')}
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="salvarEdicaoLinha()">💾 Salvar e revalidar</button>
        <button class="btn btn-secondary" onclick="fecharEditorLinha()">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.querySelector('input[data-campo]')?.focus(), 50);
}

function fecharEditorLinha() {
  const overlay = document.getElementById('edit-linha-overlay');
  if (overlay) overlay.remove();
  _editLinhaCtx = null;
}

async function salvarEdicaoLinha() {
  if (!_editLinhaCtx) return;
  const { ri, linha } = _editLinhaCtx;
  const r = appState.results[ri];
  const overlay = document.getElementById('edit-linha-overlay');
  if (!r || !overlay) { fecharEditorLinha(); return; }

  const row = (r.rows || []).find(x => x._linha_excel === linha);
  if (!row) { _toast('⚠️ Linha não encontrada.', 'warn'); fecharEditorLinha(); return; }

  overlay.querySelectorAll('input[data-campo]').forEach(inp => {
    const campo = inp.dataset.campo;
    const valOriginal = row[campo];
    const valNovo = inp.value;
    if (typeof valOriginal === 'number') {
      const parsed = num(valNovo);
      row[campo] = parsed !== null ? parsed : valNovo;
    } else {
      row[campo] = valNovo;
    }
  });
  fecharEditorLinha();

  try {
    r.erros = await validarArquivo(r.rows, r.nome);
    r.rows  = validarArquivo.__lastNormalizedRows || r.rows;

    const exportRows = r.rows.map(rw => {
      const clean = {};
      Object.keys(rw).filter(k => !k.startsWith('_') && k !== '__normalizado').forEach(k => clean[k] = rw[k]);
      return clean;
    });
    const { buf, isCsv, ext, mime } = await escreverXlsxAsync(exportRows, (r.abaOriginal || 'BASE').slice(0, 31));
    if (r._blobUrl) { try { URL.revokeObjectURL(r._blobUrl); } catch(e) {} }
    r._blobUrl  = URL.createObjectURL(new Blob([buf], { type: mime }));
    r._blobNome = isCsv ? r.nome.replace(/\.xlsx?$/i, ext) : r.nome;
    r._isCsv    = isCsv;

    renderResultados();
    atualizarVeredicto();
    if (typeof atualizarBotoesDownload === 'function') atualizarBotoesDownload();
    _toast('✅ Linha atualizada e arquivo revalidado.', 'ok', 3000);
  } catch (e) {
    _toast('❌ Erro ao revalidar: ' + e.message, 'err', 6000);
  }
}

async function abrirAjuste() {
  // Inclui arquivos com blob pré-gerado (rows já liberadas) ou com rows em memória
  const comArquivo = appState.results.filter(r => r._blobUrl || r.file || (r.rows && r.rows.length));
  if (!comArquivo.length) {
    _toast('⚠️ Valide os arquivos primeiro.', 'warn'); return;
  }
  const sel = document.getElementById('aj-arquivo');
  sel.innerHTML = comArquivo
    .map((r, i) => '<option value="' + i + '">' + r.nome + (r._blobUrl ? ' ✓ corrigido' : '') + '</option>')
    .join('');
  ['aj-gris','aj-base','aj-icms','aj-vfr'].forEach(id => {
    const el = document.getElementById(id); if (el) el.checked = false;
  });

  // Limpa estado do modal
  const resumo = document.getElementById('aj-resumo');
  if (resumo) resumo.style.display = 'none';

  // Oculta botão "Ver Resultados" até correção ser feita
  const btnVR = document.getElementById('aj-btn-ver-resultados');
  if (btnVR) btnVR.style.display = 'none';

  // Restaura botão de download se já existe blob para o arquivo selecionado
  _ajRestaurarBotaoBaixar(comArquivo[0]);

  document.getElementById('ajuste-overlay').classList.add('aberto');

  // Carrega rows do primeiro arquivo selecionado
  await _ajCarregarArquivoSelecionado();
}

// Restaura o botão de download se o arquivo já tem blob pré-gerado
function _ajRestaurarBotaoBaixar(r) {
  const btnB = document.getElementById('aj-btn-baixar');
  if (!btnB) return;
  if (r && r._blobUrl) {
    btnB.style.display = '';
    btnB.disabled = false;
    btnB.textContent = '⬇ Baixar arquivo corrigido';
    btnB.onclick = function() { ajBaixarCorrigido(r); };
  } else {
    btnB.style.display = 'none';
    btnB.disabled = true;
  }
}

async function _ajCarregarArquivoSelecionado() {
  const sel = document.getElementById('aj-arquivo');
  const comArquivo = appState.results.filter(r => r._blobUrl || r.file || (r.rows && r.rows.length));
  const idx = parseInt(sel.value || '0');
  const r = comArquivo[idx];
  if (!r) return;

  // Sempre restaura botão de download ao trocar arquivo
  _ajRestaurarBotaoBaixar(r);

  const resumo = document.getElementById('aj-resumo');
  const btnCorrigir = document.getElementById('aj-btn');
  if (r.rows && r.rows.length > 0) {
    ajAtualizarBadges();
    return;
  }

  // Se o arquivo já foi corrigido (blob existe mas rows foram liberadas), mostra msg
  if (r._blobUrl && r._rowsLiberadas) {
    if (resumo) {
      resumo.innerHTML = '✅ Arquivo já corrigido. Use o botão Baixar para salvar.';
      resumo.style.display = 'block';
    }
    return;
  }
  // Avisa se o arquivo for grande antes de iniciar a releitura
  const sizeMB = r.file ? (r.file.size / 1024 / 1024) : 0;
  if (sizeMB > 10) {
    resumo.innerHTML = `⏳ Arquivo grande (${sizeMB.toFixed(0)} MB) — relendo em background, aguarde…`;
    resumo.style.display = 'block';
  } else {
    resumo.innerHTML = '⏳ Relendo arquivo...';
    resumo.style.display = 'block';
  }
  if (btnCorrigir) { btnCorrigir.disabled = true; btnCorrigir.style.opacity = '.5'; }
  ['aj-b-gris','aj-b-base','aj-b-icms','aj-b-vfr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '…'; el.className = 'ajuste-badge loading'; }
  });
  try {
    await _recarregarRows(r);
    resumo.style.display = 'none';
    ajAtualizarBadges();
  } catch(e) {
    resumo.innerHTML = '❌ ' + e.message;
  }
}

function fecharAjuste() {
  document.getElementById('ajuste-overlay').classList.remove('aberto');
}

// Close on backdrop click
document.addEventListener('DOMContentLoaded', function() {

  document.getElementById('ajuste-overlay').addEventListener('click', function(e) {
    if (e.target === this) fecharAjuste();
  });
  // Restaura sessão anterior se o Chrome reiniciou a aba por crash/OOM
  restaurarSessao();


  // ── Atalhos de teclado ─────────────────────────────────────────────────────
  // Captura rejeições não tratadas — evita falhas silenciosas travando a UI
  window.addEventListener('unhandledrejection', event => {
    console.error('[Prefat] Rejeição não tratada:', event.reason);
    if (_validando) {
      _validando = false;
      _cancelando = false;
      try { esconderProgresso(); } catch(e) {}
      const btn = document.getElementById('btn-validate');
      if (btn) btn.disabled = false;
      _toast('❌ Erro inesperado durante validação. Verifique o Console (F12).', 'err', 8000);
    }
  });

  document.addEventListener('keydown', e => {
    if (!document.getElementById('page-validador')?.classList.contains('active')) return;
    // Ctrl+Enter — validar (funciona de qualquer página)
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      const btn = document.getElementById('btn-validate');
      if (btn && !btn.disabled) { validarTodos(); }
      else if (appState.files.length > 0) { _toast('Arquivos já validados. Adicione novos ou use ⚡ Corrigir.', 'info', 3000); }
    }
    // Escape — cancelar processamento ou fechar modais
    if (e.key === 'Escape') {
      if (_processando) { cancelarProcessamento(); return; }
      const modal = document.getElementById('ajuste-overlay');
      if (modal && modal.classList.contains('aberto')) { fecharAjuste(); return; }
    }
    // Ctrl+U — ir para upload
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); showPage('upload'); }
    // Ctrl+R — ir para resultados
    if (e.ctrlKey && e.key === 'r' && appState.results.length > 0) { e.preventDefault(); showPage('results'); }
  });
  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('page-validador')?.classList.contains('active')) return;
    // Ctrl+F ou Cmd+F → foca busca de erros (só na página results)
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const search = document.getElementById('results-search');
      if (search) {
        e.preventDefault();
        // Se não estiver na página de resultados, navega primeiro
        if (!document.getElementById('val-page-results').classList.contains('active')) {
          showPage('results');
        }
        requestAnimationFrame(() => { search.focus(); search.select(); });
      }
    }
    // Esc → fecha modais/overlays abertos
    if (e.key === 'Escape') {
      const ajuste = document.getElementById('ajuste-overlay');
      if (ajuste && ajuste.classList.contains('aberto')) fecharAjuste();
      const modal = document.querySelector('.modal-sessao');
      if (modal) modal.remove();
      if (document.getElementById('prog-overlay')?.style.display === 'block') {
        if (!_validando && !_corrigindo) esconderProgOverlay();
      }
    }
    // Alt+ArrowDown → próximo arquivo nos resultados
    if (e.key === 'ArrowDown' && e.altKey) {
      const results = document.querySelectorAll('.file-result');
      const openIdx = Array.from(results).findIndex(r => r.classList.contains('open'));
      const nextIdx = openIdx + 1 < results.length ? openIdx + 1 : 0;
      if (results[nextIdx]) {
        results[nextIdx].scrollIntoView({behavior:'smooth', block:'nearest'});
        const ri = parseInt(results[nextIdx].dataset.ri);
        if (!isNaN(ri)) toggleResult(ri);
      }
    }
  });
});

async function ajCorrigir() {
  const r = ajGetResultado();
  if (!r) return;
  try {
  const T = CFG.tolerancia || 0.05;
  const chkGris    = document.getElementById('aj-gris').checked;
  const chkBase    = document.getElementById('aj-base').checked;
  const chkIcms    = document.getElementById('aj-icms').checked;
  const chkVfr     = document.getElementById('aj-vfr').checked;
  const chkImposto = document.getElementById('aj-imposto').checked;
  let n = { gris:0, base:0, icms:0, vfr:0, imposto:0 };

  r.rows.forEach(row => {
    const nf      = num(row['Valor nota Fiscal Mercadoria']);
    const aliq    = normalizarAliquotaTaxa(row['Aliquota ICMS/ISS']); // decimal, mesma fn do validador
    const tarifa  = num(row['Frete/Tarifa Base (Peso/KM/Veículo)']) ?? num(row['Tarifa Aplicada']) ?? 0;
    const outros  = num(row['Outros Valores']) ?? 0;
    const desc    = num(row['Descontos']) ?? 0;
    const espera  = num(row['Tarifa de Espera']) ?? 0;

    // ── 0. IMPOSTO ────────────────────────────────────────────────────────
    // Alíq 0 → vazio; 1–5% → ISS; >5% → ICMS
    if (chkImposto) {
      const aliqPct = normalizarAliquotaPercentual(row['Aliquota ICMS/ISS']);
      if (aliqPct !== null) {
        const impostoAtual = String(row['IMPOSTO'] ?? '').trim().toUpperCase();
        let impostoCorr;
        if (aliqPct === 0)     impostoCorr = '';
        else if (aliqPct <= 5) impostoCorr = 'ISS';
        else                    impostoCorr = 'ICMS';
        if (impostoAtual !== impostoCorr) {
          row['IMPOSTO'] = impostoCorr;
          n.imposto++;
        }
      }
    }

    // ── 1. GRIS ──────────────────────────────────────────────────────────
    if (chkGris && nf && nf > 0) {
      const grisAtual = num(row['GRIS']) ?? 0;
      const grisCorr  = parseFloat((nf * 0.001).toFixed(4));
      if (Math.abs(grisCorr - grisAtual) > T) { row['GRIS'] = grisCorr; n.gris++; }
    }

    // ── 2. VFR / Base Calc / ICMS — mesma lógica de cenários do validador ─
    // O validador usa: VFR esperado = soma + icms_arquivo
    // onde soma = tarifa + gris + outros + espera - desc
    // Então: a correção define VFR e Base Calc = soma + icms_arquivo
    // e só recalcula ICMS se chkIcms estiver marcado
    if (chkVfr || chkBase || chkIcms) {
      const gris = num(row['GRIS']) ?? 0;
      const icmsArq = num(row['Valor ICMS/ISS']) ?? 0;
      const vfrAtual = num(row['Valor Final à Receber']);
      const baseAtual = num(row['Base Calc ICMS/ISS']);

      
const calc = calcularMotorFiscal(row);

const soma = calc.liquido;


      // Cenário que o validador vai usar (mesma lógica de melhorVfr)
      // Para FM Bigs: testa com e sem GRIS, pega o mais próximo do VFR arquivo
      // Para os demais: sempre soma com GRIS
      const isBigs = isBigsRow(row);
      let vfrEsperado;
      if (isBigs) {
        const somaSemGris = tarifa + outros + espera - desc;
        const candComGris = soma + icmsArq;
        const candSemGris = somaSemGris + icmsArq;
        vfrEsperado = Math.abs(candComGris - (vfrAtual||0)) <= Math.abs(candSemGris - (vfrAtual||0))
          ? candComGris : candSemGris;
      } else {
        vfrEsperado = soma + icmsArq;
      }
      vfrEsperado = parseFloat(vfrEsperado.toFixed(4));

      // Corrigir VFR
      if (chkVfr && vfrAtual !== null && Math.abs(vfrEsperado - vfrAtual) > T) {
        row['Valor Final à Receber'] = vfrEsperado; n.vfr++;
      }

      // Corrigir Base Calc = Gross-up PMO esperado
      if (chkBase && baseAtual !== null && Math.abs(vfrEsperado - baseAtual) > T) {
        row['Base Calc ICMS/ISS'] = vfrEsperado; n.base++;
      }

      // Corrigir ICMS = Base × Alíq (gross-up: icms = base × aliq, base = vfrEsperado)
      if (chkIcms && aliq !== null) {
        const icmsCorr = parseFloat((vfrEsperado * aliq).toFixed(4));
        if (Math.abs(icmsCorr - icmsArq) > T) {
          row['Valor ICMS/ISS'] = icmsCorr; n.icms++;
        }
      }
    }
  });

  const total = n.gris + n.base + n.icms + n.vfr + n.imposto;
  const resumo = document.getElementById('aj-resumo');

  // Revalida sem re-normalizar (rows já têm __normalizado=true)
  r.erros = await validarArquivo(r.rows, r.nome);
  r.rows  = validarArquivo.__lastNormalizedRows || r.rows;

  if (total > 0) {
    // Gera o XLSX via Web Worker — não trava a UI em arquivos grandes
    const exportRows = r.rows.map(row => {
      const clean = {};
      Object.keys(row).filter(k => !k.startsWith('_') && k !== '__normalizado').forEach(k => clean[k] = row[k]);
      return clean;
    });
    resumo.innerHTML = '⏳ Gerando arquivo corrigido… aguarde.';
    resumo.style.display = 'block';
    let resultado;
    try {
      resultado = await escreverXlsxAsync(exportRows, (r.abaOriginal || 'BASE').slice(0, 31));
    } catch(e) {
      resumo.innerHTML = '❌ Erro ao gerar arquivo: ' + e.message;
      return;
    }
    const { buf, isCsv, ext, mime } = resultado;
    if (r._blobUrl) { try { URL.revokeObjectURL(r._blobUrl); } catch(e) {} }
    r._blobUrl  = URL.createObjectURL(new Blob([buf], { type: mime }));
    r._blobNome = isCsv ? r.nome.replace(/\.xlsx?$/i, ext) : r.nome;
    r._isCsv    = isCsv;
    r.rows = [];
    r._rowsLiberadas = true;
    resumo.innerHTML = isCsv
      ? `✅ <strong>${total} valor(es) corrigido(s)</strong> (GRIS: ${n.gris} | Base: ${n.base} | ICMS: ${n.icms} | VFR: ${n.vfr} | IMPOSTO: ${n.imposto}). Arquivo grande — <em>salvo como CSV</em>. Clique em Baixar.`
      : `✅ <strong>${total} valor(es) corrigido(s)</strong> (GRIS: ${n.gris} | Base: ${n.base} | ICMS: ${n.icms} | VFR: ${n.vfr} | IMPOSTO: ${n.imposto}). Clique em Baixar para salvar.`;
  } else {
    resumo.innerHTML = '⚠️ Nenhum valor alterado (sem desvio nos campos selecionados).';
  }
  resumo.style.display = 'block';

  // Habilita botão de baixar
  const btnB = document.getElementById('aj-btn-baixar');
  if (btnB) {
    btnB.style.display = '';
    btnB.disabled = total === 0;
    btnB.textContent = '⬇ Baixar arquivo corrigido';
    btnB.onclick = function() { ajBaixarCorrigido(r); };
  }

  // FIX: não fecha o modal automaticamente — usuário decide quando fechar
  // Revalida em background sem forçar navegação
  renderResultados();
  atualizarVeredicto();

  // Botão "Ver Resultados" no modal para quem quiser navegar
  const btnVerRes = document.getElementById('aj-btn-ver-resultados');
  if (btnVerRes) {
    btnVerRes.style.display = '';
    btnVerRes.onclick = function() {
      fecharAjuste();
      showPage('results');
      const ri = appState.results.indexOf(r);
      setTimeout(() => {
        const cardEl = ri >= 0 ? document.getElementById(`fr-${ri}`) : null;
        if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    };
  }

  const errosRestantes = errosAtivos(r).length;
  if (total > 0) {
    _toast(
      errosRestantes > 0
        ? `✅ ${total} valor(es) corrigido(s). ${errosRestantes} erro(s) restante(s).`
        : `✅ ${total} valor(es) corrigido(s) — aprovado!`,
      errosRestantes > 0 ? 'warn' : 'ok',
      5000
    );
  }
  } catch(errAj) {
    console.error('[ajCorrigir] Erro:', errAj);
    _toast('❌ Erro ao corrigir. Veja o console (F12).', 'err', 6000);
    const resumo = document.getElementById('aj-resumo');
    if (resumo) { resumo.innerHTML = '❌ Erro: ' + errAj.message; resumo.style.display = 'block'; }
  } finally {
    const btnAj = document.getElementById('aj-btn');
    if (btnAj) btnAj.disabled = false;
  }
}

function ajBaixarCorrigido(r) {
  if (!r) return;
  // Blob pré-gerado pelo ajCorrigir (rows já liberadas da memória)
  if (r._blobUrl) {
    const a = document.createElement('a');
    a.href = r._blobUrl;
    a.download = r._blobNome || r.nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
    return;
  }
  // Fallback: gera das rows se ainda estiverem em memória
  if (!r.rows || !r.rows.length) { _toast('Arquivo não disponível. Faça upload novamente.', 'warn'); return; }
  _downloadXlsx(r);
}

// ══ Histórico de validações (localStorage) ══════════════════════════════════
const HIST_KEY = 'prefat_historico_v1';
const HIST_MAX = 10;

function salvarHistorico() {
  // Chave canônica unificada — ambos HIST_KEY e 'validador_prefat_historico_v1'
  // apontam agora para o mesmo dado, no formato novo que renderHistorico() espera.
  const HIST_CANON = 'validador_prefat_historico_v1';
  try {
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(HIST_CANON) || '[]'); } catch(e) {}

    const ts = new Date().toISOString();
    const entry = {
      ts,
      arquivos: appState.results.map(r => {
        const nCrit = errosAtivos(r).filter(e => (BADGE_CAT[e.cat]||'info') === 'err').length;
        const nWarn = errosAtivos(r).filter(e => (BADGE_CAT[e.cat]||'info') === 'warn').length;
        return { nome: r.nome, erros: nCrit + nWarn, criticos: nCrit, alertas: nWarn,
                 linhas: r.linhas || 0, veredicto: nCrit>0?'REPROVADO':nWarn>0?'RESSALVA':'APROVADO' };
      }),
      totalErros: appState.results.reduce((s,r) => s + errosAtivos(r).length, 0),
    };

    // Deduplica por data (dia) + lista de arquivos
    const chaveEntrada = ts.slice(0,10) + '|' + entry.arquivos.map(a=>a.nome).sort().join(',');
    const semDup = hist.filter(h => {
      const c = (h.ts||'').slice(0,10) + '|' + (h.arquivos||[]).map(a=>a.nome).sort().join(',');
      return c !== chaveEntrada;
    });
    semDup.unshift(entry);
    const final = semDup.slice(0, HIST_MAX);
    localStorage.setItem(HIST_CANON, JSON.stringify(final));
    localStorage.setItem(HIST_KEY, JSON.stringify(final)); // compatibilidade
  } catch(e) { _dbgWarn('Histórico não salvo:', e); }
}

function carregarHistorico() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch(e) { return []; }
}

async function limparHistorico() {
  const ok = await _confirmarModal('Limpar histórico', 'Apagar todo o histórico de validações?', 'Limpar', 'Cancelar');
  if (!ok) return;
  localStorage.removeItem('validador_prefat_historico_v1');
  localStorage.removeItem(HIST_KEY);
  renderHistorico();
  // histórico desativado
}

function renderHistorico() {
  // Try new history format first, fall back to old
  let hist = [];
  try {
    const newHist = JSON.parse(localStorage.getItem('validador_prefat_historico_v1') || '[]');
    if (newHist.length > 0) {
      hist = newHist.map(entry => ({
        _isNew: true,
        ts: entry.ts,
        arquivos: entry.arquivos || [],
        totalErros: entry.totalErros || 0
      }));
    }
  } catch(e) {}
  if (!hist.length) {
    // Fall back to old history format
    hist = carregarHistorico().map(h => ({ _isOld: true, ...h }));
  }

  const el = document.getElementById('historico-lista');
  if (!el) return;
  if (!hist.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>Nenhuma validação registrada ainda</div>';
    return;
  }

  // Compare with current session
  const currentErros = appState.results.length > 0
    ? appState.results.reduce((s,r) => s + (r.erros||[]).length, 0) : null;
  const currentNomes = new Set(appState.results.map(r => r.nome));

  el.innerHTML = hist.map((h, idx) => {
    if (h._isNew) {
      const data = new Date(h.ts).toLocaleString('pt-BR');
      const arqCount = h.arquivos.length;
      const totalErr = h.totalErros;
      const semErro = h.arquivos.filter(a => a.erros === 0).length;
      const comErro = arqCount - semErro;
      const corTotal = totalErr > 0 ? 'var(--red)' : 'var(--green)';

      let diffHtml = '';
      if (idx === 0 && currentErros !== null) {
        const diff = currentErros - totalErr;
        const diffSign = diff > 0 ? '+' : '';
        const diffColor = diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--green)' : 'var(--text3)';
        diffHtml = `<div style="font-size:11px;color:${diffColor};margin-top:4px">Vs. sessão atual: ${diffSign}${diff} ocorrências</div>`;
      }

      const arqRows = h.arquivos.map(a => {
        const statusCor = a.erros > 0 ? 'var(--red)' : 'var(--green)';
        const statusIco = a.erros > 0 ? '🔴' : '✅';
        return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--border);font-size:11px">
          <span style="font-family:var(--mono);color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${a.nome}">${a.nome}</span>
          <span style="color:${statusCor};font-weight:600;flex-shrink:0">${statusIco} ${a.erros} erro(s)</span>
        </div>`;
      }).join('');

      return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:var(--text)">${data}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">${arqCount} arquivo(s) · ${semErro} sem erro · ${comErro} com erro</div>
            ${diffHtml}
          </div>
          <div style="text-align:right">
            <div style="font-size:20px;font-weight:700;color:${corTotal}">${totalErr}</div>
            <div style="font-size:10px;color:var(--text3)">ocorrências</div>
          </div>
        </div>
        <div style="max-height:160px;overflow-y:auto">${arqRows}</div>
      </div>`;
    } else {
      // Old format
      const cor = h.veredicto === 'REPROVADO' ? 'var(--red)' : h.veredicto === 'RESSALVA' ? 'var(--yellow)' : 'var(--green)';
      const data = new Date(h.data).toLocaleString('pt-BR');
      return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;display:flex;align-items:center;gap:16px">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;font-family:var(--mono);color:var(--text)">${h.nome}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${data} · ${(h.linhas||0).toLocaleString('pt-BR')} linhas · ${h.totalErros} ocorrência(s)</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:${cor};border:1.5px solid ${cor};padding:3px 12px;border-radius:12px">${h.veredicto}</div>
        ${h.criticos ? `<div style="font-size:11px;color:var(--red)">🔴 ${h.criticos} crítico(s)</div>` : ''}
        ${h.alertas  ? `<div style="font-size:11px;color:var(--yellow)">⚠️ ${h.alertas} alerta(s)</div>` : ''}
      </div>`;
    }
  }).join('');
}

// Hook into validarTodos to auto-save after each validation
const _validarTodosOrig = validarTodos;
validarTodos = async function() {
  await _validarTodosOrig.apply(this, arguments);
  // histórico desativado
  // histórico desativado
};

// ══ Corrigir Tudo — gross-up consistente, sem loop ══════════════════════════
/**
 * Serializa rows para XLSX em Web Worker — não bloqueia a thread principal.
 * Para arquivos grandes (>30k linhas) a diferença é enorme: UI fica responsiva.
 * Fallback síncrono caso Worker falhe ou não seja suportado.
 */
/**
 * Para arquivos pequenos (< 1M células): gera XLSX via Web Worker.
 * Para arquivos grandes (≥ 1M células): gera CSV (100× mais rápido),
 * que o Excel abre normalmente. 1M células ≈ 17k linhas × 58 colunas.
 */
// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE DE ESCRITA — nativa, sem XLSX.js, sem workers, sem CDN
// Usa JSZip (já carregado) + XML gerado em chunks. Retorna {buf, isCsv, ext, mime}
// ═══════════════════════════════════════════════════════════════════════════════

function _colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n-1)%26; s = String.fromCharCode(65+m)+s; n = Math.floor((n-1)/26); }
  return s;
}
function _escXml(v) {
  return String(v??'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
}

async function _gerarXlsxNativo(exportRows, sheetName) {
  if (!exportRows.length) return new Uint8Array(0);
  const safeSheet = (sheetName||'BASE').slice(0,31).replace(/[\\/?*[\]:]/g,'_');
  const headers = Object.keys(exportRows[0]);
  const CHUNK = 500; // chunks menores = UI respira mais; TextEncoder é leve
  const enc   = new TextEncoder();

  // Codifica em Uint8Array por partes — evita string intermediária de centenas de MB
  const parts  = [];
  let totalLen = 0;
  const push   = s => { const b = enc.encode(s); parts.push(b); totalLen += b.byteLength; };

  push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  push('<sheetData>');
  push('<row r="1">' + headers.map((h,ci) =>
    `<c r="${_colLetter(ci+1)}1" t="inlineStr"><is><t>${_escXml(h)}</t></is></c>`
  ).join('') + '</row>');

  for (let ri = 0; ri < exportRows.length; ri++) {
    const row = exportRows[ri];
    const rowNum = ri + 2;
    const cells = [];
    headers.forEach((h, ci) => {
      const v = row[h];
      if (v === null || v === undefined || v === '') return;
      const ref = `${_colLetter(ci+1)}${rowNum}`;
      if (typeof v === 'number' && isFinite(v)) {
        cells.push(`<c r="${ref}"><v>${v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" t="inlineStr"><is><t>${_escXml(v)}</t></is></c>`);
      }
    });
    if (cells.length) push(`<row r="${rowNum}">${cells.join('')}</row>`);
    if (ri % CHUNK === CHUNK - 1) await yieldToUI();
  }
  push('</sheetData></worksheet>');
  await yieldToUI();

  // Monta o Uint8Array final sem join de string
  const xmlBytes = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { xmlBytes.set(p, off); off += p.byteLength; }
  parts.length = 0; // libera memória das partes codificadas
  await yieldToUI();

  // Para arquivos muito grandes usa nível de compressão menor (muito mais rápido,
  // arquivo ligeiramente maior mas abre normalmente no Excel)
  const nCells   = exportRows.length * headers.length;
  const compLevel = nCells > 2_000_000 ? 1 : 6;

  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${_escXml(safeSheet)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>');
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>');
  zip.file('xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '</styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', xmlBytes);

  const ab = await zip.generateAsync({ type:'arraybuffer', compression:'DEFLATE', compressionOptions:{ level: compLevel } });
  return new Uint8Array(ab);
}

async function _gerarCsvAsync(rows) {
  if (!rows.length) return new Uint8Array(0);
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(h => `"${String(h).replace(/"/g,'""')}"`).join(',')];
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    rows.slice(i, i + CHUNK).forEach(r => {
      lines.push(headers.map(h => {
        const v = r[h];
        return (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g,'""')}"`;
      }).join(','));
    });
    await yieldToUI();
  }
  return new TextEncoder().encode('\ufeff' + lines.join('\n'));
}

/**
 * Ponto de entrada unificado para geração de arquivo corrigido.
 * Sempre gera XLSX nativo (JSZip, sem XLSX.js, sem workers, sem CDN).
 * Para arquivos grandes usa compressão nível 1 (muito mais rápido).
 * Retorna: { buf: Uint8Array, isCsv: boolean, ext: string, mime: string }
 */
async function escreverXlsxAsync(exportRows, sheetName) {
  const buf = await _gerarXlsxNativo(exportRows, sheetName);
  return { buf, isCsv: false, ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
function _mostrarToastCorrigirTudo({ corrigidos, campos, semDesvio, pulados, cancelado, nomes }) {
  const old = document.getElementById('toast-corrigir-tudo');
  if (old) old.remove();

  // ── Painel de download inline (acima da lista de resultados) ──────────
  const arquivosComBlob = appState.results.filter(r => r._blobUrl);
  const panelAnterior = document.getElementById('painel-download-pos-correcao');
  if (panelAnterior) panelAnterior.remove();

  if (arquivosComBlob.length > 0) {
    // Auto-download se 1 arquivo
    if (arquivosComBlob.length === 1) {
      const r = arquivosComBlob[0];
      const a = document.createElement('a');
      a.href = r._blobUrl;
      a.download = r._blobNome || r.nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    // Painel verde persistente no topo dos resultados
    const painel = document.createElement('div');
    painel.id = 'painel-download-pos-correcao';
    painel.style.cssText = 'margin-bottom:14px;background:rgba(5,150,105,.1);border:1px solid rgba(5,150,105,.35);border-radius:10px;padding:14px 16px';
    const botoesArquivos = arquivosComBlob.map((r, i) => {
      const errRest = (r.erros || []).filter(e => !e.ignorado).length;
      const badgeErrs = errRest > 0
        ? `<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--red-dim);color:var(--red);font-weight:600;margin-left:6px">${errRest} err</span>`
        : `<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--green-dim);color:var(--green);font-weight:600;margin-left:6px">✓ ok</span>`;
      return `<button onclick="_dlBlobDireto(${appState.results.indexOf(r)})"
        style="display:flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid rgba(0,166,81,.35);border-radius:7px;padding:7px 12px;font-size:12px;color:#067a3b;cursor:pointer;font-family:var(--mono);text-align:left;flex:1;min-width:0">
        ⬇ <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${escHtml(r.nome)}">${escHtml(r.nome.length>40?r.nome.slice(0,38)+'…':r.nome)}</span>${badgeErrs}
      </button>`;
    }).join('');
    const btnTodos = arquivosComBlob.length > 1
      ? `<button onclick="baixarTodosCorrigidos()" style="background:#059669;border:1px solid #047857;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap">⬇ Baixar todos (ZIP)</button>`
      : '';
    painel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:15px">✅</span>
        <span style="font-size:13px;font-weight:600;color:#067a3b">${campos} campo(s) corrigido(s) — arquivos prontos para baixar</span>
        <button onclick="document.getElementById('painel-download-pos-correcao').remove()" style="margin-left:auto;background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-height:220px;overflow-y:auto;padding-right:4px">
        ${botoesArquivos}
        ${btnTodos}
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text3)">
        🔍 Resultados abaixo refletem a revalidação pós-correção — verifique os erros restantes antes de usar os arquivos.
        ${semDesvio > 0 ? ` · ${semDesvio} arquivo(s) sem desvio.` : ''}
        ${pulados > 0 ? ` · ${pulados} arquivo(s) sem erros corrigíveis (pulados).` : ''}
      </div>`;

    const rl = document.getElementById('results-list');
    if (rl) rl.parentNode.insertBefore(painel, rl);
  }

  // ── Toast leve (para o caso de cancelamento ou sem desvios) ──────────
  if (cancelado || corrigidos === 0) {
    const cor = cancelado ? 'var(--yellow)' : 'var(--accent)';
    const icone = cancelado ? '⏹' : '✓';
    const msg = cancelado ? 'Correção cancelada' : 'Nenhum desvio encontrado';
    const div = document.createElement('div');
    div.id = 'toast-corrigir-tudo';
    div.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--bg2);border:1px solid ${cor};color:${cor};border-radius:8px;padding:10px 18px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.5)`;
    div.textContent = icone + ' ' + msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
  }
}

/** Download direto do blob pré-gerado pelo corrigirTudo */
function _dlBlobDireto(ri) {
  const r = appState.results[ri];
  if (!r || !r._blobUrl) { _toast('Arquivo não disponível.', 'warn'); return; }
  const a = document.createElement('a');
  a.href = r._blobUrl;
  a.download = r._blobNome || r.nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Campos que o botão global "⚡ Corrigir" (Corrigir Tudo) pode alterar
const CAMPOS_CORRIGIR_TUDO = [
  { key: 'gris',    label: 'GRIS' },
  { key: 'imposto', label: 'IMPOSTO' },
  { key: 'icms',    label: 'Valor ICMS/ISS' },
  { key: 'vfr',     label: 'Valor Final à Receber' },
  { key: 'base',    label: 'Base Calc ICMS/ISS' },
  { key: 'cnpj',    label: 'CNPJ Tomador (sem prefixo 42)' },
];

async function corrigirTudo() {
  // Resultados com arquivo disponível para releitura (rows podem estar vazias)
  const resultados = appState.results.filter(r => r.file || (r.rows && r.rows.length));
  if (!resultados.length) {
    _toast('⚠️ Valide os arquivos primeiro.', 'warn'); return;
  }

  // Deixa o usuário escolher quais campos serão corrigidos antes de aplicar em todos os arquivos
  const selGlobais = await _selecionarCamposCorrecao('Corrigir Tudo', CAMPOS_CORRIGIR_TUDO);
  if (!selGlobais) return; // cancelado

  // Feedback visual: desabilita botão e mostra barra de progresso
  const btnCT = document.getElementById('btn-corrigir-tudo');
  const labelOriginal = btnCT ? btnCT.innerHTML : '';
  if (btnCT) { btnCT.disabled = true; btnCT.style.opacity = '.6'; btnCT.innerHTML = '⚡ Corrigindo...'; }
  _corrigindo = true;
  _cancelando = false;
  const cancelBtnCT = document.getElementById('prog-ov-cancel');
  if (cancelBtnCT) { cancelBtnCT.disabled = false; cancelBtnCT.textContent = '\u23f9 Cancelar'; }
  mostrarProgOverlay(0, `Corrigindo 0 de ${resultados.length} arquivos…`, 'Relendo arquivos e aplicando correções', '⚡ Corrigindo Prefats');

  let totalCorrigidos = 0;
  const nomes = [];
  let arquivosSemDesvio = 0;
  let arquivosPulados = resultados.length - resultados.filter(r => (r.erros || []).some(e => CATS_CORRIGIVEIS[e.cat])).length;

  try {
  for (let ri = 0; ri < resultados.length; ri++) {
    if (_cancelando) break;
    const r = resultados[ri];

    // Pula arquivos sem erros corrigíveis (ex: só Estrutura/coluna ausente)
    const temCorrigivel = (r.erros || []).some(e => CATS_CORRIGIVEIS[e.cat]);
    if (!temCorrigivel) continue;

    mostrarProgOverlay(
      ri / resultados.length,
      `Corrigindo arquivo ${ri + 1} de ${resultados.length}`,
      r.nome.length > 55 ? r.nome.slice(0,53)+'…' : r.nome
    );
    await yieldToUI();
    // Recarrega rows sob demanda se foram liberadas
    try { await _recarregarRows(r); } catch(e) { continue; }
    if (!r.rows || !r.rows.length) continue;
    const T = CFG.tolerancia || 0.05;
    let n = { gris: 0, icms: 0, vfr: 0, imposto: 0, cnpj: 0 };

    const _corrigirLinha = row => {
      const nf = num(row['Valor nota Fiscal Mercadoria']);

      // Corrige CNPJ Tomador que não inicia com 42
      if (selGlobais.includes('cnpj')) {
        const cnpjLimpo = limparCnpj(row['CNPJ Tomador']);
        if (cnpjLimpo && !cnpjLimpo.startsWith('42')) {
          row['CNPJ Tomador'] = CNPJ_TOMADOR_CORRECAO; n.cnpj++;
        }
      }

      // Corrige GRIS se NF disponível (0,1% da NF)
      if (selGlobais.includes('gris') && nf && nf > 0) {
        const grisAtual = num(row['GRIS']) ?? 0;
        const grisCorr  = parseFloat((nf * 0.001).toFixed(4));
        if (Math.abs(grisCorr - grisAtual) > T) { row['GRIS'] = grisCorr; n.gris++; }
      }

      // Corrige coluna IMPOSTO com base na alíquota:
      //   0%        → nulo/vazio
      //   1% a 5%   → ISS
      //   > 5%      → ICMS
      if (selGlobais.includes('imposto')) {
        const aliqPct = normalizarAliquotaPercentual(row['Aliquota ICMS/ISS']);
        if (aliqPct !== null) {
          const impostoAtual = String(row['IMPOSTO'] ?? '').trim().toUpperCase();
          let impostoCorr;
          if (aliqPct === 0)          impostoCorr = '';
          else if (aliqPct <= 5)      impostoCorr = 'ISS';
          else                         impostoCorr = 'ICMS';
          const impostoNorm = impostoCorr === '' ? '' : impostoCorr;
          if (impostoAtual !== impostoNorm) {
            row['IMPOSTO'] = impostoCorr;
            n.imposto = (n.imposto || 0) + 1;
          }
        }
      }

      // Motor PMO como única fonte de verdade — evita cálculo manual com bugs
      if (selGlobais.includes('icms') || selGlobais.includes('vfr') || selGlobais.includes('base')) {
        const calc = calcularMotorFiscal(row);
        if (calc.aliquota !== null && calc.aliquota !== undefined) {
          const { baseCalc: baseCorr, valorImposto: icmsCorr, valorFinal: vfrCorr } = calc;
          const icmsAtual = num(row['Valor ICMS/ISS']) ?? 0;
          const vfrAtual  = num(row['Valor Final à Receber']);
          const baseAtual = num(row['Base Calc ICMS/ISS']);

          if (selGlobais.includes('icms') && Math.abs(icmsCorr - icmsAtual) > T) {
            row['Valor ICMS/ISS'] = parseFloat(icmsCorr.toFixed(2)); n.icms++;
          }
          // Valor Final = Tarifa + GRIS + ICMS + Outros + Espera - Descontos (fórmula PMO)
          if (selGlobais.includes('vfr') && vfrAtual !== null && Math.abs(vfrCorr - vfrAtual) > T) {
            row['Valor Final à Receber'] = parseFloat(vfrCorr.toFixed(2)); n.vfr++;
          }
          if (selGlobais.includes('base') && baseAtual !== null && Math.abs(baseCorr - baseAtual) > T) {
            row['Base Calc ICMS/ISS'] = parseFloat(baseCorr.toFixed(2));
          }
        }
      }
    };
    // Processa correções em chunks — browser respira a cada 5000 linhas
    for (let __ci = 0; __ci < r.rows.length; __ci++) {
      _corrigirLinha(r.rows[__ci]);
      if (__ci % 5000 === 4999) {
        mostrarProgOverlay(
          ri / resultados.length,
          `Corrigindo arquivo ${ri + 1} de ${resultados.length} — ${Math.min(__ci+1, r.rows.length).toLocaleString('pt-BR')}/${r.rows.length.toLocaleString('pt-BR')} linhas`,
          r.nome.length > 55 ? r.nome.slice(0,53)+'…' : r.nome
        );
        await yieldToUI();
      }
    }
    await yieldToUI();

    const total = n.gris + n.icms + n.vfr + (n.imposto || 0) + (n.cnpj || 0);
    if (total > 0) {
      totalCorrigidos += total;
      nomes.push(`${r.nome} → GRIS: ${n.gris} | ICMS: ${n.icms} | VFR: ${n.vfr} | IMPOSTO: ${n.imposto||0} | CNPJ: ${n.cnpj||0}`);
    } else {
      arquivosSemDesvio++;
    }

    // Revalida com rows já normalizadas (cede ao browser antes para não travar a UI)
    mostrarProgOverlay(
      ri / resultados.length,
      `Revalidando arquivo ${ri + 1} de ${resultados.length}…`,
      r.nome.length > 55 ? r.nome.slice(0,53)+'…' : r.nome
    );
    await yieldToUI();
    r.erros = await validarArquivo(r.rows, r.nome);
    r.rows  = validarArquivo.__lastNormalizedRows || r.rows;

    // Gera Blob e libera rows da memória (mesmo padrão do ajCorrigir)
    if (total > 0) {
      mostrarProgOverlay(
        ri / resultados.length,
        `Gerando XLSX corrigido ${ri + 1} de ${resultados.length}…`,
        r.nome.length > 55 ? r.nome.slice(0,53)+'…' : r.nome
      );
      await yieldToUI();
      const exportRows = r.rows.map(row => {
        const clean = {};
        Object.keys(row).filter(k => !k.startsWith('_') && k !== '__normalizado').forEach(k => clean[k] = row[k]);
        return clean;
      });
      // Usa CSV para arquivos grandes (>50k linhas), XLSX para menores
      const { buf, isCsv, ext, mime } = await escreverXlsxAsync(exportRows, (r.abaOriginal || 'BASE').slice(0, 31));
      if (r._blobUrl) { try { URL.revokeObjectURL(r._blobUrl); } catch(e) {} }
      r._blobUrl  = URL.createObjectURL(new Blob([buf], { type: mime }));
      r._blobNome = isCsv ? r.nome.replace(/\.xlsx?$/i, ext) : r.nome;
      r._isCsv    = isCsv;
      // sempre XLSX — sem fallback CSV
      r.rows = [];
      if (r.file) r.file.__rawBuffer = null;
    } else {
      r.rows = []; // libera mesmo sem correções
    }
    mostrarProgOverlay(
      (ri + 1) / resultados.length,
      `Arquivo ${ri + 1} de ${resultados.length} concluído`,
      nomes.length > 0 ? `✅ ${nomes[nomes.length-1].split(' → ')[0]}` : '— sem desvios'
    );
    await yieldToUI();
  }

  const foiCancelado = _cancelando;

  if (foiCancelado) {
    mostrarProgOverlay(1, '⏹ Correção cancelada', `${totalCorrigidos} campo(s) ajustado(s) até o cancelamento`);
  } else {
    mostrarProgOverlay(1, '✅ Correção concluída!', `${totalCorrigidos} campo(s) ajustado(s) em ${nomes.length} arquivo(s)`);
  }
  await yieldToUI();
  setTimeout(esconderProgOverlay, 1500);

  renderResultados();
  atualizarVeredicto();
  atualizarBotoesDownload();

  // Navega para resultados e rola ao topo para o usuário ver o resumo atualizado
  showPage('results');
  setTimeout(() => {
    const rl = document.getElementById('results-list');
    if (rl) rl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 350);

  } catch(errCorrigir) {
    console.error('[corrigirTudo] Erro inesperado:', errCorrigir);
    _toast('❌ Erro durante a correção. Verifique o console (F12).', 'err', 7000);
    esconderProgOverlay();
  } finally {
    _corrigindo  = false;
    _cancelando  = false;
    // Restaura botão SEMPRE — mesmo se houver erro
    if (btnCT) { btnCT.disabled = false; btnCT.style.opacity = '1'; btnCT.innerHTML = labelOriginal; }
  }

  // Toast inline — substitui o alert() bloqueante
  _mostrarToastCorrigirTudo({
    corrigidos: nomes.length,
    campos: totalCorrigidos,
    semDesvio: arquivosSemDesvio,
    pulados: arquivosPulados,
    cancelado: foiCancelado,
    nomes
  });
}


// ══ Download Prefat Corrigida ════════════════════════════════════════════════
function toggleDownloadMenu() {
  const menu = document.getElementById('download-menu');
  const btn  = document.querySelector('#download-group > button');
  if (menu.style.display !== 'none' && menu.style.display !== '') {
    menu.style.display = 'none';
    return;
  }
  // Posiciona como fixed usando as coordenadas do botão para nunca ser cortado
  if (btn) {
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top  = (rect.bottom + 6) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    menu.style.zIndex = '99999';
  }
  menu.style.display = 'block';
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!e.target.closest('#download-group')) {
        menu.style.display = 'none';
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function atualizarBotoesDownload() {
  const group = document.getElementById('download-group');
  const menu  = document.getElementById('download-menu');
  if (!group || !menu) return;

  const arquivos = appState.results.filter(r => r._blobUrl || (r.rows && r.rows.length > 0));
  if (!arquivos.length) { group.style.display = 'none'; return; }

  group.style.display = '';
  menu.innerHTML = arquivos.map((r, i) =>
    `<button onclick="baixarArquivoCorrigido(${i})" class="dl-menu-btn"
      title="${escHtml(r.nome)}">
      📄 ${escHtml(r.nome.length > 35 ? r.nome.slice(0,32)+'...' : r.nome)}
    </button>`
  ).join('') +
  (arquivos.length > 1 ? `
    <div style="border-top:1px solid var(--border);margin:4px 0"></div>
    <button onclick="baixarTodosCorrigidos()" class="dl-menu-btn" style="color:#1d4ed8;font-weight:600">
      ⬇ Baixar todos em ZIP (${arquivos.length} arquivos)
    </button>` : '');
}

function baixarArquivoCorrigido(idx) {
  document.getElementById('download-menu').style.display = 'none';
  const arquivos = appState.results.filter(r => r._blobUrl || (r.rows && r.rows.length > 0));
  const r = arquivos[idx];
  if (!r) return;
  _downloadXlsx(r);
}

async function baixarTodosCorrigidos() {
  document.getElementById('download-menu').style.display = 'none';
  const arquivos = appState.results.filter(r => r._blobUrl || (r.rows && r.rows.length > 0));
  if (!arquivos.length) return;

  // Um único arquivo → download direto sem ZIP
  if (arquivos.length === 1) { _downloadXlsx(arquivos[0]); return; }

  // Vários arquivos → empacota em ZIP com JSZip
  // Arquivos com blob pré-gerado são adicionados diretamente; outros geram das rows
  const zip = new JSZip();
  // Processa sequencialmente — evita iniciar N workers/blobs ao mesmo tempo (pico de memória)
  for (const r of arquivos) {
    if (r._blobUrl) {
      const resp = await fetch(r._blobUrl);
      const buf  = await resp.arrayBuffer();
      zip.file(r._blobNome || r.nome, buf);
    } else {
      const exportRows = r.rows.map(row => {
        const clean = {};
        Object.keys(row).filter(k => !k.startsWith('_') && k !== '__normalizado').forEach(k => clean[k] = row[k]);
        return clean;
      });
      const { buf: bufZip, isCsv: isCsvZ, ext: extZ } = await escreverXlsxAsync(exportRows, (r.abaOriginal || 'BASE').slice(0, 31));
      const nomeZip = isCsvZ ? r.nome.replace(/\.xlsx?$/i, extZ) : r.nome;
      zip.file(nomeZip, bufZip);
    }
  }
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  const data = new Date().toISOString().slice(0, 10);
  a.download = `prefat_corrigidos_${data}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function _downloadXlsx(r) {
  // Se já existe um Blob pré-gerado (post ajCorrigir), usa ele diretamente
  if (r._blobUrl) { ajBaixarCorrigido(r); return; }
  if (!r.rows || !r.rows.length) { _toast('Arquivo não disponível. Faça upload novamente.', 'warn'); return; }
  const exportRows = r.rows.map(row => {
    const clean = {};
    Object.keys(row)
      .filter(k => !k.startsWith('_') && k !== '__normalizado')
      .forEach(k => clean[k] = row[k]);
    return clean;
  });
  const nomAba = (r.abaOriginal || 'BASE').slice(0, 31);
  const { buf, isCsv, ext, mime } = await escreverXlsxAsync(exportRows, nomAba);
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = isCsv ? r.nome.replace(/\.xlsx?$/i, ext) : r.nome;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ══ Ajustar rotas zeradas (engine de Ajustes do portal) sem baixar/reenviar ═
function _modoAjusteRotas(op) {
  const o = String(op || '').toUpperCase();
  if (o.includes('FM')) return 'fm';
  if (o.includes('LH')) return 'lh';
  return 'zer'; // LM / LM 3PL / LM FF / INCENTIVO LM / FROTA DEDICADA — usa a engine LM
}
const _MODO_LABEL = { zer: 'LM', fm: 'FM', lh: 'LH' };

// Heurística: arquivo "parece" ter rotas zeradas se tiver erro nas categorias
// que indicam Valor Final/Tarifa Base zerados — usado só pra pré-marcar.
function _pareceTerRotaZerada(r) {
  return (r.erros || []).some(e => e.cat === 'Valor Final' || e.cat === 'Tarifa Base');
}

async function abrirAjusteRotasZeradas() {
  const resultados = appState.results.filter(r => r.nome && (r._blobUrl || (r.rows && r.rows.length) || r.file));
  if (!resultados.length) { _toast('⚠️ Valide ao menos um arquivo primeiro.', 'warn'); return; }

  let overlay = document.getElementById('ajuste-rotas-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'ajuste-rotas-overlay';
  overlay.className = 'modal-overlay show';
  overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });

  const linhasArquivo = resultados.map((r, i) => {
    const op = _origemOp[r.nome] || '';
    const modo = op ? _modoAjusteRotas(op) : '';
    const sugestao = _pareceTerRotaZerada(r);
    const opLabel = op ? `${escHtml(op)} (${_MODO_LABEL[modo]})` : 'operação não detectada';
    return `
      <label class="ajuste-row" style="cursor:pointer">
        <input type="checkbox" class="ajr-chk" data-idx="${i}" data-op="${escHtml(op)}" ${sugestao ? 'checked' : ''} style="flex-shrink:0">
        <div style="min-width:0;flex:1;overflow:hidden">
          <b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${sugestao ? 600 : 500}" title="${escHtml(r.nome)}">${escHtml(r.nome)}</b>
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${opLabel}${sugestao ? ' · parece ter rotas zeradas' : ''}</span>
        </div>
        <span class="ajuste-badge ${sugestao ? 'err' : ''}" id="ajr-status-${i}" style="flex-shrink:0">${sugestao ? '⚠ verificar' : '—'}</span>
      </label>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal" style="width:min(640px,95vw)">
      <div class="modal-title">Ajustar rotas zeradas (lote)
        <button class="modal-close" onclick="document.getElementById('ajuste-rotas-overlay').remove()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Usa a mesma engine da aba <strong>Ajustes</strong> do portal (LM/FM/LH) — localiza linhas com
        Valor Final à Receber zerado, aplica as tarifas do arquivo de rotas e recalcula. Os arquivos já
        carregados aqui são reaproveitados, sem precisar baixar nem reenviar. Marcados em laranja já
        parecem ter o problema — desmarque os que não quer processar agora.
      </p>
      <div class="form-row">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <label class="label" style="margin-bottom:0">Arquivos (${resultados.length})</label>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.ajr-chk').forEach(c=>c.checked=true)">Marcar todos</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.ajr-chk').forEach(c=>c.checked=false)">Desmarcar todos</button>
          </div>
        </div>
        <div class="up-review-scroll" style="max-height:240px">${linhasArquivo}</div>
      </div>
      <div class="form-row">
        <label class="label">Arquivo de rotas (tarifas) — usado para todos os arquivos marcados</label>
        <input type="file" class="input" id="ajr-rotas" accept=".xlsx">
        <div style="font-size:11px;color:var(--text3);margin-top:5px">Esperado: colunas <code>associate_order_no</code> (ou <code>trip</code>) e <code>new_price</code> (ou <code>valor_rate_table</code>).</div>
      </div>
      <div id="ajr-progresso" style="display:none;margin:10px 0">
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px" id="ajr-progresso-lbl"></div>
        <div class="prog-real show"><div class="prog-real-bar" id="ajr-progresso-bar" style="width:0%"></div></div>
        <div id="ajr-progresso-msg" style="font-size:12px;color:var(--text2);margin-top:6px"></div>
      </div>
      <div id="ajr-erro" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:8px"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="ajr-btn-ok" onclick="executarAjusteRotasZeradas()">⚙️ Processar selecionados</button>
        <button class="btn btn-secondary" onclick="document.getElementById('ajuste-rotas-overlay').remove()">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function executarAjusteRotasZeradas() {
  const overlay = document.getElementById('ajuste-rotas-overlay');
  if (!overlay) return;
  const resultados = appState.results.filter(r => r.nome && (r._blobUrl || (r.rows && r.rows.length) || r.file));
  const rotasInput = overlay.querySelector('#ajr-rotas');
  const erroBox = overlay.querySelector('#ajr-erro');
  erroBox.style.display = 'none';

  const checks = [...overlay.querySelectorAll('.ajr-chk:checked')];
  if (!checks.length) {
    erroBox.textContent = 'Marque ao menos um arquivo.'; erroBox.style.display = 'block'; return;
  }
  if (!rotasInput.files || !rotasInput.files[0]) {
    erroBox.textContent = 'Selecione o arquivo de rotas.'; erroBox.style.display = 'block'; return;
  }
  const rotasFile = rotasInput.files[0];

  const btn = overlay.querySelector('#ajr-btn-ok');
  const progWrap = overlay.querySelector('#ajr-progresso');
  const progLbl  = overlay.querySelector('#ajr-progresso-lbl');
  const progBar  = overlay.querySelector('#ajr-progresso-bar');
  const progMsg  = overlay.querySelector('#ajr-progresso-msg');
  btn.disabled = true; btn.textContent = '⏳ Processando...';
  progWrap.style.display = 'block';

  const total = checks.length;
  let totalAjustadas = 0, totalAindaZeradas = 0;
  const falhas = [];

  for (let n = 0; n < total; n++) {
    const idx = parseInt(checks[n].dataset.idx, 10);
    const r = resultados[idx];
    const op = checks[n].dataset.op || _origemOp[r.nome] || '';
    const statusEl = document.getElementById(`ajr-status-${idx}`);
    progLbl.textContent = `Arquivo ${n + 1} de ${total}: ${r.nome}`;
    progBar.style.width = Math.round((n / total) * 100) + '%';
    if (statusEl) { statusEl.className = 'ajuste-badge loading'; statusEl.innerHTML = '<span class="spin"></span>'; }

    try {
      const dados = await _blobParaUpload(r);
      if (!dados) throw new Error('Sem dados do arquivo.');
      const blob = new Blob([dados.buf], { type: dados.mime });

      let modo = op ? _modoAjusteRotas(op) : null;
      if (!modo) {
        const opDetectado = await _detectarOpDoArquivo(blob, dados.nome);
        modo = opDetectado ? _modoAjusteRotas(opDetectado) : 'zer';
      }
      const endpoint = { zer: '/api/ajuste_zerado', fm: '/api/ajuste_fm', lh: '/api/ajuste_lh' }[modo];

      const fd = new FormData();
      fd.append('file', blob, dados.nome);
      fd.append('rotas', rotasFile);

      progMsg.textContent = `Enviando ${r.nome}...`;
      const resp = await _ajApiFetch(endpoint, { method: 'POST', body: fd });
      const d = await resp.json();
      if (d.erro) throw new Error(d.erro);

      progMsg.textContent = `Processando ${r.nome}...`;
      const msg = await new Promise((resolve, reject) => {
        let sse = null, done = false;
        sse = makeSSE(`/api/progress/${d.job_id}`,
          m => {
            if (m.type === 'progress') {
              progMsg.textContent = m.msg;
            } else if (m.type === 'done') {
              if (sse) sse.close();
              if (!done) { done = true; resolve(m); }
            } else if (m.type === 'error' || m.type === 'cancelled') {
              if (sse) sse.close();
              if (!done) { done = true; reject(new Error(m.msg || 'Falha no processamento')); }
            }
          },
          () => { if (!done) { done = true; reject(new Error('Conexão perdida com o servidor')); } }
        );
      });

      progMsg.textContent = `Recarregando ${r.nome}...`;
      const dlResp = await _ajApiFetch('/api/ajuste/download/' + msg.token);
      if (!dlResp.ok) throw new Error('Falha ao buscar arquivo ajustado.');
      const novoBlob = await dlResp.blob();
      const novoFile = new File([novoBlob], msg.filename || r.nome,
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      if (r._blobUrl) { try { URL.revokeObjectURL(r._blobUrl); } catch(e) {} }
      r._blobUrl = null; r._blobNome = null;
      const rawRows = await lerExcel(novoFile);
      r.rows = normalizarColunas(rawRows);
      r.file = novoFile;
      r.erros = await validarArquivo(r.rows, r.nome);
      r.rows  = validarArquivo.__lastNormalizedRows || r.rows;

      const ajustadas = msg.total_ajustadas ?? 0;
      const ainda = msg.total_ainda_zeradas ?? 0;
      totalAjustadas += ajustadas;
      totalAindaZeradas += ainda;

      if (statusEl) {
        statusEl.className = 'ajuste-badge ' + (ainda > 0 ? 'warn' : 'ok');
        statusEl.textContent = ainda > 0 ? `${ajustadas} ok · ${ainda} restam` : `✅ ${ajustadas} ajustada(s)`;
      }
    } catch (e) {
      falhas.push(r.nome);
      if (statusEl) { statusEl.className = 'ajuste-badge err'; statusEl.textContent = '❌ erro'; }
    }
    progBar.style.width = Math.round(((n + 1) / total) * 100) + '%';
  }

  renderResultados();
  atualizarVeredicto();
  showPage('results');

  btn.disabled = false; btn.textContent = '⚙️ Processar selecionados';
  progLbl.textContent = 'Concluído';
  progMsg.textContent = `${total - falhas.length}/${total} arquivo(s) processado(s)`;

  const partes = [`✅ ${totalAjustadas} rota(s) ajustada(s) em ${total - falhas.length} arquivo(s)`];
  if (totalAindaZeradas > 0) partes.push(`⚠️ ${totalAindaZeradas} ainda zerada(s)`);
  if (falhas.length) partes.push(`❌ falhou em: ${falhas.join(', ')}`);
  _toast(partes.join(' · '), falhas.length || totalAindaZeradas > 0 ? 'warn' : 'ok', 8000);

  if (!falhas.length) overlay.remove();
}

// ══ Salvar (corrigido ou original) no servidor e ir pro Consolidar ════════
async function _blobParaUpload(r) {
  if (r._blobUrl) {
    const resp = await fetch(r._blobUrl);
    const buf  = await resp.arrayBuffer();
    return { buf, nome: r._blobNome || r.nome, mime: r._isCsv ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  if (r.rows && r.rows.length) {
    const exportRows = r.rows.map(row => {
      const clean = {};
      Object.keys(row).filter(k => !k.startsWith('_') && k !== '__normalizado').forEach(k => clean[k] = row[k]);
      return clean;
    });
    const { buf, isCsv, ext, mime } = await escreverXlsxAsync(exportRows, (r.abaOriginal || 'BASE').slice(0, 31));
    return { buf, nome: isCsv ? r.nome.replace(/\.xlsx?$/i, ext) : r.nome, mime };
  }
  if (r.file) {
    const buf = await r.file.arrayBuffer();
    return { buf, nome: r.nome, mime: r.file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  return null;
}

async function _detectarOpDoArquivo(blob, nome) {
  try {
    const fd = new FormData();
    fd.append('file', blob, nome);
    const r = await _ajApiFetch('/api/detect_op', { method: 'POST', body: fd });
    const d = await r.json();
    return d && d.op ? d.op : null;
  } catch (e) { return null; }
}

async function irParaConsolidarValidados() {
  const resultados = appState.results.filter(r => r.nome && (r._blobUrl || (r.rows && r.rows.length) || r.file));
  if (!resultados.length) {
    _toast('⚠️ Valide ao menos um arquivo primeiro.', 'warn'); return;
  }
  const btn = document.querySelector('[onclick="irParaConsolidarValidados()"]');
  const labelOriginal = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:11px;height:11px;display:inline-block;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite"></span> Salvando...'; }

  const opsTocadas = new Set();
  const falhas = [];
  try {
    for (const r of resultados) {
      const dados = await _blobParaUpload(r);
      if (!dados) { falhas.push(r.nome); continue; }
      const blob = new Blob([dados.buf], { type: dados.mime });
      let op = _origemOp[r.nome] || await _detectarOpDoArquivo(blob, dados.nome);
      if (!op) { falhas.push(r.nome); continue; }
      const fd = new FormData();
      fd.append('op', op);
      fd.append('sobrescrever', 'sim');
      fd.append('files', blob, dados.nome);
      const resp = await _ajApiFetch('/api/upload_prefat', { method: 'POST', body: fd });
      const d = await resp.json();
      if (d && !d.erro) { opsTocadas.add(op); }
      else { falhas.push(r.nome); }
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = labelOriginal; }
  }

  if (opsTocadas.size) {
    _toast(`✅ ${resultados.length - falhas.length} arquivo(s) salvo(s) em enviar/ — indo pro Consolidar`, 'ok', 4000);
  }
  if (falhas.length) {
    _toast('⚠️ Não consegui identificar a operação de: ' + falhas.join(', ') + ' — envie pela aba Upload.', 'warn', 7000);
  }
  if (opsTocadas.size && typeof go === 'function') {
    go('consolidar');
    if (typeof loadConsolTabela === 'function') loadConsolTabela();
  }
}

// Sub-função: minihub — volumes zerados em dias úteis
// Sub-função: alerta CNPJ Tomador único no arquivo
// Sub-função: VFR deve ser igual à Base Calc ICMS/ISS
// Sub-função: isenção SP — origens SP não devem ter ICMS tributado
function _valIsencaoSP(rows, erros, tem) {
  if (!CFG.regras.isencao_sp?.on || !tem('UF Origem') || !tem('IMPOSTO') || !tem('Aliquota ICMS/ISS')) return;
  rows.forEach(r => {
    if (r['UF Origem'] === 'SP' && r['IMPOSTO'] === 'ICMS' && normalizarAliquotaPercentual(r['Aliquota ICMS/ISS']) !== 0)
      erros.push(reg('Isenção SP', r._linha_excel, r['id_rota'],
        `Origem SP com ICMS ${r['Aliquota ICMS/ISS']}% — verificar isenção`,
        'Pacotes com origem SP podem ser isentos conforme regra fiscal vigente.'));
  });
}

function _valVFRBase(rows, erros, tem) {
  if (!CFG.regras.vfr_igual_base?.on || !tem('Valor Final à Receber') || !tem('Base Calc ICMS/ISS')) return;
  const T = CFG.tolerancia;
  rows.forEach(r => {
    const vfr  = num(r['Valor Final à Receber']);
    const base = num(r['Base Calc ICMS/ISS']);
    if (vfr !== null && base !== null && Math.abs(vfr - base) > T)
      erros.push(reg('VFR ≠ Base Calc', r._linha_excel, r['id_rota'],
        `Valor Final à Receber (${vfr.toFixed(4)}) ≠ Base Calc ICMS/ISS (${base.toFixed(4)}) | Diff: ${Math.abs(vfr-base).toFixed(4)}`,
        'VFR deve ser igual à Base Calc ICMS/ISS em todas as operações.'));
  });
}

function _valCNPJUnico(rows, erros, tem) {
  if (!CFG.regras.cnpj_tomador_unico?.on || !tem('CNPJ Tomador')) return;
  const cnpjs = new Set(rows.map(r => String(r['CNPJ Tomador'] || '').replace(/[^0-9]/g,'')).filter(Boolean));
  if (cnpjs.size === 1)
    erros.push(reg('CNPJ Tomador', null, null,
      `Arquivo tem apenas 1 CNPJ Tomador: ${[...cnpjs][0]}. Esperado: múltiplos CNPJs.`,
      'Arquivos com somente um CNPJ Tomador podem indicar erro de filtragem ou arquivo incompleto.'));
}

// Sub-função: validações Air Haul
function _valAirHaul(rows, erros, tem) {
  if (!rows.some(r => isAirHaulRow(r))) return;
  rows.forEach(r => {
    if (!isAirHaulRow(r)) return;
    if (CFG.regras.air_haul_veiculo?.on && tem('Tipo do Veículo')) {
      const v = String(r['Tipo do Veículo'] || '').toUpperCase();
      if (v && !v.includes('AIR') && !v.includes('AVIAO') && !v.includes('AVIÃO'))
        erros.push(reg('Air Haul', r._linha_excel, r['id_rota'],
          `Tipo do Veículo '${r['Tipo do Veículo']}' não é compatível com Air Haul`,
          'Esperado: AIR ou AVIÃO', getBR(r)));
    }
  });
}

function _valMinihub(rows, erros, tem) {
  if (CFG.regras.minihub_vol_zero && CFG.regras.minihub_vol_zero.on && tem('Operação')) {
    const FERIADOS_NAC_SET = new Set(CFG.feriadosNacionais || []);
    rows.forEach(r => {
      const op = String(r['Operação'] || '').toUpperCase();
      if (!op.includes('MINIHUB') && !op.includes('MINI HUB')) return;
      const rawData = r['Data da Prestação do Serviço'];
      if (!rawData) return;
      const d = new Date(rawData);
      if (isNaN(d)) return;
      const dow = d.getDay(); // 0=dom, 6=sab
      if (dow === 0 || dow === 6) return; // sábado/domingo OK
      const ymd = d.toISOString().slice(0,10);
      if (FERIADOS_NAC_SET.has(ymd)) return; // feriado nacional OK
      const hub = String(r['Hub'] || '').trim();
      const qtd = num(r['Quantidade Volume']) ?? 0;
      if (hub && qtd === 0)
        erros.push(reg('Minihub Vol Zero', r._linha_excel, r['id_rota'],
          `Minihub '${hub}' com volume zerado em dia útil: ${rawData}`,
          'Volumes zerados em dias úteis podem indicar ausência indevida de operação.'));
    });
  }
}

