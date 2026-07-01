// ── Workspace isolation ───────────────────────────────────────────────────────
const WS_ID = (() => {
  try {
    let id = localStorage.getItem('pmo_ws_id');
    if (!id || !/^ws_[a-z0-9]{6}$/.test(id)) {
      id = 'ws_' + Math.random().toString(36).substr(2, 6);
      localStorage.setItem('pmo_ws_id', id);
    }
    return id;
  } catch(e) { return 'ws_' + Math.random().toString(36).substr(2, 6); }
})();

// apiFetch — injeta WS_ID (e, quando admin ativo, WS e token override)
function apiFetch(path, opts = {}) {
  const wsId    = (typeof _adminWsId !== 'undefined' && _adminWsId) ? _adminWsId : WS_ID;
  const headers = Object.assign({}, opts.headers || {}, {'X-Workspace-ID': wsId});
  if (typeof _adminToken !== 'undefined' && _adminToken) {
    headers['X-Admin-Token'] = _adminToken;
  }
  opts.headers = headers;
  return fetch(path, opts);
}

// Mostra workspace ID no topbar
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('ws-badge');
  if (badge) badge.textContent = WS_ID;
});
// -- Primeiro uso ----------------------------------------------------------
function puFechar() {
  document.getElementById('pu-overlay').classList.remove('visible');
}

async function puVerificar() {
  try {
    const d = await (await apiFetch('/api/config')).json();
    if (!d.EMAIL_FROM || !d.EMAIL_TOKEN) {
      document.getElementById('pu-overlay').classList.add('visible');
      setTimeout(() => document.getElementById('pu-email').focus(), 200);
    }
  } catch(e) { /* servidor pode ainda estar subindo */ }
}

async function puSalvar() {
  const email = document.getElementById('pu-email').value.trim();
  const token = document.getElementById('pu-token').value.trim().split(' ').join('');
  const err   = document.getElementById('pu-err');

  if (!email || !email.includes('@')) {
    err.textContent = 'Digite um e-mail válido.'; err.classList.add('show'); return;
  }
  if (!token || token.length < 8) {
    err.textContent = 'App Password inválido — deve ter ao menos 8 caracteres.'; err.classList.add('show'); return;
  }
  err.classList.remove('show');

  const btn = document.querySelector('#pu-overlay .btn-primary');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Salvando...';

  try {
    const cfg = await (await apiFetch('/api/config')).json();
    cfg.EMAIL_FROM  = email;
    cfg.EMAIL_TOKEN = token;
    const r = await (await apiFetch('/api/config', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg)
    })).json();

    if (r.ok) { puFechar(); loadStats(); }
    else { err.textContent = 'Erro ao salvar. Tente novamente.'; err.classList.add('show'); }
  } catch(e) {
    err.textContent = 'Erro de conexão: ' + e; err.classList.add('show');
  } finally {
    btn.disabled = false; btn.innerHTML = '✅ Salvar e começar';
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────
setInterval(()=>{
  document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
},1000);

// ── modalConfirm — substitui confirm() nativo em todo o app ──────────────
// Retorna Promise<boolean>. Suporta HTML no campo `body`.
function modalConfirm(title, body, confirmLabel='Confirmar', confirmColor='var(--orange)', cancelLabel='Cancelar'){
  return new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML=`<div style="background:var(--surface);border-radius:16px;width:min(500px,95vw);max-height:85vh;overflow-y:auto;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:700;margin-bottom:12px">${title}</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:24px;line-height:1.6">${body}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
        <button id="mc-cancel" class="btn btn-ghost btn-sm">${cancelLabel}</button>
        <button id="mc-confirm" class="btn btn-sm" style="background:${confirmColor};color:white;padding:8px 20px">${confirmLabel}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const cleanup=val=>{document.body.removeChild(ov);resolve(val);};
    ov.querySelector('#mc-confirm').onclick=()=>cleanup(true);
    ov.querySelector('#mc-cancel').onclick=()=>cleanup(false);
    ov.addEventListener('keydown',e=>{if(e.key==='Escape')cleanup(false);});
    setTimeout(()=>ov.querySelector('#mc-confirm').focus(),50);
  });
}

// ── Navigation ────────────────────────────────────────────────────────────
const PAGES=['gerar','upload','consolidar','enviar','ajustes','historico','validador'];
const PAGE_LABELS={gerar:'Gerar',upload:'Upload',consolidar:'Consolidar',enviar:'Enviar',ajustes:'Ajustes',historico:'Histórico',validador:'Validar'};
function go(name){
  PAGES.forEach(p=>{
    const el=document.getElementById('page-'+p);
    if(el) el.classList.toggle('active',p===name);
  });
  document.querySelectorAll('.tab[data-page]').forEach(t=>{
    t.classList.toggle('active', t.dataset.page===name);
  });
  const title=document.getElementById('topbar-title');
  if(title && PAGE_LABELS[name]) title.textContent=PAGE_LABELS[name];
}
function goSub(name){
  ['imposto','zerado','fm','lh'].forEach(s=>{
    document.getElementById('sub-'+s).classList.toggle('active',s===name);
  });
  document.querySelectorAll('.sub-tab').forEach((t,i)=>t.classList.toggle('active',['imposto','zerado','fm','lh'][i]===name));
}

// ── Ops ───────────────────────────────────────────────────────────────────
let OPS=[], _sel={consol:[],enviar:[]}, _opCounts={};
// Marca se o usuário já interagiu manualmente com a seleção (chip, Todas,
// Limpar) — depois disso loadStats() para de auto-marcar operações com
// arquivo pendente, senão ela "ressuscitava" a seleção por baixo dos panos
// a cada atualização de stats, fazendo o Limpar parecer não funcionar.
let _selTouched={consol:false, enviar:false};
async function loadOps(){
  try{
    const r=await apiFetch('/api/ops');
    if(!r.ok) throw new Error('HTTP '+r.status);
    OPS=await r.json();
    renderChips('chips-consol','consol');
    renderChips('chips-enviar','enviar');
  }catch(e){
    console.error('loadOps falhou:',e);
    toast('⚠️ Não foi possível carregar as operações: '+e.message,'warn',5000);
  }
}
function renderChips(cid,key){
  const c=document.getElementById(cid); if(!c) return; c.innerHTML='';
  OPS.forEach(op=>{
    const d=document.createElement('div');
    const on=(_sel[key]||[]).includes(op);
    d.className='chip'+(on?' on':'');
    const n=_opCounts[op]||0;
    // badge em ambas as chaves quando há arquivos
    d.innerHTML=op+(n?`<span class="chip-badge">${n}</span>`:'');
    d.onclick=()=>toggleOp(op,d,key);
    c.appendChild(d);
  });
}
function toggleOp(op,el,key){
  _selTouched[key]=true;
  const arr=_sel[key]||(_sel[key]=[]);
  const i=arr.indexOf(op);
  if(i>=0){arr.splice(i,1);el.classList.remove('on')}else{arr.push(op);el.classList.add('on')}
}
function selAll(k){_selTouched[k]=true;_sel[k]=[...OPS];renderChips('chips-'+k,k)}
function clrAll(k){_selTouched[k]=true;_sel[k]=[];renderChips('chips-'+k,k)}

// ── Health ────────────────────────────────────────────────────────────────
async function checkHealth(){
  const icons={drive:'☁️',sheets:'📊',smtp:'📧'};
  const labels={drive:'Google Drive',sheets:'Google Sheets',smtp:'SMTP / Gmail'};
  // Estado: verificando
  ['drive','sheets','smtp'].forEach(k=>{
    const el=document.getElementById('h-'+k);
    el.className='health-card checking';
    el.innerHTML=`<div class="health-icon">${icons[k]}</div>
      <div class="health-label">${labels[k]}</div>
      <div class="health-msg"><span class="spin"></span> Verificando...</div>`;
  });
  try{
    const d=await (await apiFetch('/api/health')).json();
    for(const [k,v] of Object.entries(d)){
      const el=document.getElementById('h-'+k);
      if(!el) continue;
      el.className='health-card '+(v.ok?'ok':'err');
      el.innerHTML=`<div class="health-icon">${icons[k]||'🔧'} ${v.ok?'✅':'❌'}</div>
        <div class="health-label">${labels[k]||k}</div>
        <div class="health-msg">${v.msg||''}</div>`;
    }
  }catch(e){
    ['drive','sheets','smtp'].forEach(k=>{
      const el=document.getElementById('h-'+k);
      el.className='health-card err';
      el.innerHTML=`<div class="health-icon">${icons[k]} ❌</div>
        <div class="health-label">${labels[k]}</div>
        <div class="health-msg">Erro de conexão: ${e}</div>`;
    });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────
async function loadStats(){
  try{
    const r=await apiFetch('/api/stats');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d=await r.json();
    // usa String() para garantir que 0 apareça como "0" e não como "—"
    document.getElementById('s-pendentes').textContent = (d.arquivos_pendentes != null) ? d.arquivos_pendentes : '—';
    document.getElementById('s-hoje').textContent      = (d.envios_hoje      != null) ? d.envios_hoje      : '—';
    document.getElementById('s-falhas').textContent    = (d.falhas_hoje      != null) ? d.falhas_hoje      : '—';
    window._statsFailCount=0; // reset contador de falhas após sucesso
    if(d.por_op){
      _opCounts=d.por_op;
      const opsComArquivo=Object.keys(d.por_op);
      // Só auto-marca operações com arquivo pendente enquanto o usuário não
      // tiver tocado na seleção manualmente — depois de um clique em algum
      // chip, "Todas" ou "Limpar", essa escolha passa a ser respeitada e
      // não é mais sobrescrita nas próximas atualizações de stats.
      ['consol','enviar'].forEach(key=>{
        if(_selTouched[key]) return;
        const arr=_sel[key]||(_sel[key]=[]);
        opsComArquivo.forEach(op=>{ if(!arr.includes(op)) arr.push(op); });
      });
      renderChips('chips-consol','consol');
      renderChips('chips-enviar','enviar');
      // Tab dots — mostra ponto laranja nas abas com trabalho pendente
      const hasPending=opsComArquivo.length>0;
      document.getElementById('tdot-upload')?.classList.toggle('visible', hasPending);
      document.getElementById('tdot-consolidar')?.classList.toggle('visible', hasPending);
      document.getElementById('tdot-enviar')?.classList.toggle('visible', hasPending);
    }
    if(d.arquivos_antigos&&d.arquivos_antigos.length&&!window._antigoToastShown){
      window._antigoToastShown=true;
      const nomes=d.arquivos_antigos.slice(0,3).map(a=>`${a.op}/${a.arquivo} (${a.dias}d)`).join(', ');
      const extra=d.arquivos_antigos.length>3?` e mais ${d.arquivos_antigos.length-3}`:''
      toast(`🕐 ${d.arquivos_antigos.length} arquivo(s) há +3 dias na fila sem envio: ${nomes}${extra}`,'warn',10000);
    }
    if(!d.arquivos_antigos||!d.arquivos_antigos.length) window._antigoToastShown=false;
  }catch(e){
    console.warn('loadStats:',e);
    window._statsFailCount=(window._statsFailCount||0)+1;
    if(window._statsFailCount===1) toast('⚠️ Servidor não responde — verifique se o app está rodando.','warn',6000);
  }
}

// ── Dark mode ─────────────────────────────────────────────────────────────
function toggleDark(){
  document.body.classList.toggle('dark');
  const on=document.body.classList.contains('dark');
  document.getElementById('btn-dark').textContent=on?'☀️':'🌙';
  try{localStorage.setItem('pmo_dark',on?'1':'0');}catch(e){}
}
(function(){
  try{
    const v=localStorage.getItem('pmo_dark');
    if(v==='1'){document.body.classList.add('dark');document.getElementById('btn-dark').textContent='☀️';}
  }catch(e){}
})();

// ── Stepper dinâmico (página upload) ──────────────────────────────────────
function updateStepper(){
  // step 1 = done se há arquivos pendentes
  // usamos s-pendentes stat
  const pend=parseInt(document.getElementById('s-pendentes').textContent)||0;
  const s1=document.getElementById('step-1');
  if(!s1) return;
  if(pend>0){s1.classList.add('done');s1.classList.remove('active');
    s1.querySelector('.step-num').textContent='✓';}
  else{s1.classList.remove('done');s1.classList.add('active');
    s1.querySelector('.step-num').textContent='1';}
}

// ── Upload automático one-shot ─────────────────────────────────────────────
let _pendingFiles=[];
function dzDrag(e,on){e.preventDefault();document.getElementById('up-dz').classList.toggle('drag',on)}
function dzDrop(e){e.preventDefault();document.getElementById('up-dz').classList.remove('drag');upFilesAuto(e.dataTransfer.files)}

async function upFilesAuto(files){
  if(!files.length) return;
  const arr=Array.from(files).filter(f=>f.name.match(/\.(xlsx|xls|csv)$/i));
  if(!arr.length){document.getElementById('up-res').innerHTML='<div class="alert a-warn">⚠️ Selecione arquivos .xlsx, .xls ou .csv</div>';return;}
  document.getElementById('up-res').innerHTML='';
  try{
  _pendingFiles=arr;
  const res=document.getElementById('up-res');
  const rev=document.getElementById('up-review');
  const revList=document.getElementById('up-review-list');
  res.innerHTML='<div class="alert a-info"><span class="spin"></span> Detectando operações...</div>';
  rev.style.display='none';

  // Detecta cada arquivo em paralelo
  const detections=await Promise.all(arr.map(async(f,i)=>{
    const fd=new FormData(); fd.append('file',f);
    try{
      const d=await (await apiFetch('/api/detect_op',{method:'POST',body:fd})).json();
      return {idx:i,file:f,op:d.op,raw:d.raw,transp:d.transp,confianca:d.confianca,erro:d.erro};
    }catch(e){return {idx:i,file:f,op:null,raw:'',transp:'',confianca:'falhou',erro:String(e)};}
  }));

  res.innerHTML='';
  // Monta tabela de revisão
  revList.innerHTML=detections.map(d=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="font-size:12px;font-family:monospace;color:var(--text2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.file.name}">📄 ${d.file.name}</span>
      ${d.transp?`<span style="font-size:11px;color:var(--text3);flex:0 0 auto">${d.transp}</span>`:''}
      <select class="select" id="rev-op-${d.idx}" style="flex:0 0 auto;padding:5px 8px;font-size:12px;min-width:120px">
        ${OPS.map(o=>`<option value="${o}"${o===d.op?' selected':''}>${o}</option>`).join('')}
        <option value=""${!d.op?' selected':''}>— selecionar —</option>
      </select>
      ${d.confianca==='exata'
        ?`<span style="font-size:11px;background:var(--greenL);color:var(--green);border-radius:12px;padding:2px 8px;border:1px solid #bbf7d0">✓ detectado</span>`
        :d.op
          ?`<span style="font-size:11px;background:var(--yellowL);color:var(--yellow);border-radius:12px;padding:2px 8px;border:1px solid #fde68a">⚠ inferido</span>`
          :`<span style="font-size:11px;background:var(--redL);color:var(--red);border-radius:12px;padding:2px 8px;border:1px solid #fecaca">❌ não detectado</span>`
      }
    </div>`).join('');
  rev.style.display='block';
  // Scroll suave para a área de revisão sem sair da página
  setTimeout(()=>document.getElementById('up-review').scrollIntoView({behavior:'smooth',block:'nearest'}),50);
  }catch(_ufErr){
    document.getElementById('up-res').innerHTML=`<div class="alert a-err">❌ Erro ao processar arquivo: ${_ufErr.message||_ufErr}</div>`;
    console.error('upFilesAuto erro:',_ufErr);
  }
}

async function upConfirmar(){
  const res=document.getElementById('up-res');
  const rev=document.getElementById('up-review');
  res.innerHTML='<div class="alert a-info"><span class="spin"></span> Salvando arquivos...</div>';
  rev.style.display='none';

  // Passo 1: tentar salvar todos (sem sobrescrever)
  let ok=0, erros=[], todasDups=[], dupOps={};
  const resultados = await Promise.all(_pendingFiles.map(async(f,i)=>{
    const op=document.getElementById(`rev-op-${i}`)?.value||'';
    if(!op) return {f,op,erro:`${f.name}: operação não selecionada`};
    const fd2=new FormData(); fd2.append('op',op); fd2.append('files',f);
    try{
      const d=await (await apiFetch('/api/upload_prefat',{method:'POST',body:fd2})).json();
      return {f,op,d};
    }catch(e){ return {f,op,erro:String(e)}; }
  }));

  // Coleta todos os duplicados de uma vez
  resultados.forEach(r=>{
    if(r.erro){ erros.push(r.erro); return; }
    if(r.d.erro){ erros.push(`${r.f.name}: ${r.d.erro}`); return; }
    if(r.d.duplicados&&r.d.duplicados.length){
      r.d.duplicados.forEach(n=>{todasDups.push(n); dupOps[n]=r.op;});
    } else { ok++; }
  });

  // Passo 2: se há duplicados, um único modal para todos
  if(todasDups.length){
    const lista=todasDups.map(n=>`<li style="font-family:monospace;font-size:12px">${n}</li>`).join('');
    const sobrescrever=await modalConfirm(
      `⚠️ ${todasDups.length} arquivo(s) já existem na fila`,
      `<ul style="padding-left:16px;margin:8px 0 14px">${lista}</ul>Deseja sobrescrever todos?`,
      'Sobrescrever todos',
      'var(--orange)',
      'Manter originais'
    );
    if(sobrescrever){
      await Promise.all(todasDups.map(async nome=>{
        const arq=_pendingFiles.find(f=>f.name===nome); if(!arq) return;
        const op=dupOps[nome]||'';
        const fd3=new FormData(); fd3.append('op',op); fd3.append('files',arq); fd3.append('sobrescrever','sim');
        try{
          const d2=await (await apiFetch('/api/upload_prefat',{method:'POST',body:fd3})).json();
          if(d2.erro) erros.push(`${nome}: ${d2.erro}`); else ok++;
        }catch(e){ erros.push(`${nome}: ${e}`); }
      }));
    } else {
      ok += todasDups.length; // manteve originais — conta como sucesso sem sobrescrever
    }
  }
  _pendingFiles=[];
  const _fi=document.getElementById('up-file'); if(_fi) _fi.value='';
  if(erros.length)
    res.innerHTML=`<div class="alert a-warn">⚠️ ${ok} salvo(s), ${erros.length} erro(s):<br>${erros.join('<br>')}</div>`;
  else {
    // Descobre quais ops foram salvas para exibir no CTA
    const _opsLabel=Object.keys(_opCounts).length
      ? Object.entries(_opCounts).filter(([,n])=>n>0).map(([op,n])=>`${op} (${n})`).join(', ')
      : `${ok} arquivo(s)`;
    res.innerHTML=`<div style="background:var(--greenL);border:1.5px solid #86efac;border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:4px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;color:#15803d;margin-bottom:3px">✅ ${ok} arquivo(s) salvos com sucesso!</div>
        <div style="font-size:12px;color:#166534">Operações detectadas: <strong>${_opsLabel}</strong> — prontos para consolidar.</div>
      </div>
      <button class="btn btn-green" style="flex-shrink:0;white-space:nowrap" onclick="go('consolidar');loadConsolTabela()">🔗 Consolidar agora →</button>
    </div>`;
  }
  await loadStats();
  setTimeout(updateStepper,500);
}

function upCancelar(){
  _pendingFiles=[];
  document.getElementById('up-review').style.display='none';
  document.getElementById('up-res').innerHTML='';
  document.getElementById('up-file').value='';
}

// ── Consolidar e Enviar (ação combinada) ─────────────────────────────────
async function doConsolEEnviar(){
  const btn=document.getElementById('btn-consol-enviar');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Consolidando...';
  // Aguarda consolidação completar via SSE
  const ops=_sel.consol.length?_sel.consol:[];
  const r=await apiFetch('/api/consolidar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops})});
  const {job_id}=await r.json();
  await new Promise((resolve,reject)=>{
    const sse=makeSSE(
      `/api/progress/${job_id}`,
      m=>{
        if(m.type==='progress'){
          btn.innerHTML=`<span class="spin"></span> ${m.msg.length>40?m.msg.slice(0,40)+'…':m.msg}`;
          addLL('log-consol',m.msg);
        } else if(m.type==='done'){
          sse.close();
          addLL('log-consol',m.msg,'ok'); loadStats(); loadConsolTabela();
          resolve(m);
        } else if(m.type==='error'){
          sse.close();
          document.getElementById('consol-res').innerHTML=`<div class="alert a-err">❌ ${m.msg}</div>`;
          reject(new Error(m.msg));
        }
      },
      ()=>reject(new Error('Conexão perdida — tente novamente'))
    );
  }).catch(e=>{
    btn.disabled=false; btn.innerHTML='📧 Consolidar e Enviar';
    toast('❌ '+e.message,'err',5000);
    return;
  });
  btn.innerHTML='<span class="spin"></span> Indo para Enviar...';
  btn.disabled=false; btn.innerHTML='📧 Consolidar e Enviar';
  // Sincroniza seleção de ops para enviar
  _sel.enviar=[...(_sel.consol.length?_sel.consol:OPS)];
  renderChips('chips-enviar','enviar');
  go('enviar');
  toast('✅ Consolidação concluída — revise o preview antes de disparar.','ok',5000);
}

// ── SSE com retry automático ──────────────────────────────────────────────
// Substitui `new EventSource(url)` puro. Reconecta até maxRetries vezes com
// backoff exponencial. Chama onMsg(parsedData) para cada mensagem, onFail()
// quando esgota as tentativas. Retorna objeto com .close().
function makeSSE(url, onMsg, onFail, maxRetries=8){
  let attempt=0, es=null, closed=false;
  function connect(){
    if(closed) return;
    es=new EventSource(url);
    es.onmessage=e=>{
      attempt=0;
      // Ignora heartbeats (comentários SSE chegam como mensagens vazias em alguns browsers)
      if(!e.data || e.data.trim()==='' || e.data.startsWith(':')) return;
      try{ onMsg(JSON.parse(e.data)); }catch(err){ console.error('SSE parse:',err); }
    };
    es.onerror=()=>{
      es.close();
      if(closed) return;
      attempt++;
      if(attempt<=maxRetries){
        const delay=Math.min(1500*Math.pow(1.8,attempt-1),30000); // 1.5s → 30s
        console.warn(`SSE desconectado — reconectando em ${Math.round(delay/1000)}s (${attempt}/${maxRetries})`);
        setTimeout(connect, delay);
      } else {
        console.error('SSE: esgotadas as tentativas de reconexão');
        if(onFail) onFail();
      }
    };
  }
  connect();
  return { close(){ closed=true; if(es) es.close(); } };
}

// ── Log helpers ───────────────────────────────────────────────────────────
function addLL(id,msg,cls=''){
  const b=document.getElementById(id); b.classList.add('show');
  const d=document.createElement('div'); d.className='ll '+(cls||'');
  d.textContent='› '+msg; b.appendChild(d); b.scrollTop=b.scrollHeight;
  // mostra botão limpar quando há conteúdo
  const btnId='btn-clear-'+id.replace('log-','');
  const btn=document.getElementById(btnId); if(btn) btn.style.display='';
}
function clearLog(logId, btnId){
  const b=document.getElementById(logId);
  if(b){b.innerHTML='';b.classList.remove('show');}
  const btn=document.getElementById(btnId); if(btn) btn.style.display='none';
}
// ── Consolidar ────────────────────────────────────────────────────────────
async function doConsol(){
  const btn=document.getElementById('btn-consol');
  const pb=document.getElementById('pb-consol');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Consolidando...';
  pb.classList.add('show');
  document.getElementById('log-consol').innerHTML=''; document.getElementById('log-consol').classList.remove('show');
  document.getElementById('consol-res').innerHTML='';
  const ops=_sel.consol.length?_sel.consol:[];
  const r=await apiFetch('/api/consolidar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops})});
  const {job_id}=await r.json();
  const sse=makeSSE(
    `/api/progress/${job_id}`,
    m=>{
      if(m.type==='progress'){
        addLL('log-consol',m.msg);
        document.getElementById('consol-res').innerHTML=`<div class="alert a-info"><span class="spin"></span> ${m.msg}</div>`;
      } else if(m.type==='done'){
        sse.close(); btn.disabled=false; btn.innerHTML='🔗 Gerar Consolidados'; pb.classList.remove('show');
        let html=`<div class="alert a-ok" style="flex-direction:column;align-items:flex-start;gap:10px">
          <span>✅ ${m.msg}</span>
          <button class="btn btn-primary btn-sm" onclick="go('enviar')">📧 Ir para Enviar →</button>
        </div>`;
        if(m.ignorados&&m.ignorados.length){
          const rows=m.ignorados.map(ig=>`<tr><td style="font-size:11px;font-family:monospace">${ig.op}</td><td style="font-size:11px;font-family:monospace">${ig.arquivo}</td><td style="font-size:11px;color:var(--red)">${ig.motivo}</td></tr>`).join('');
          html+=`<div style="margin-top:10px"><div class="alert a-warn" style="margin-bottom:8px">⚠️ ${m.ignorados.length} arquivo(s) ignorado(s) durante a consolidação:</div>
            <div class="tbl-wrap"><table><thead><tr><th>Op</th><th>Arquivo</th><th>Motivo</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
        }
        document.getElementById('consol-res').innerHTML=html;
        addLL('log-consol',m.msg,'ok'); loadStats(); loadConsolTabela();
      } else if(m.type==='error'){
        sse.close(); btn.disabled=false; btn.innerHTML='🔗 Gerar Consolidados'; pb.classList.remove('show');
        document.getElementById('consol-res').innerHTML=`<div class="alert a-err" style="white-space:pre-wrap">❌ ${m.msg}</div>`;
      }
    },
    ()=>{
      btn.disabled=false; btn.innerHTML='🔗 Gerar Consolidados'; pb.classList.remove('show');
      document.getElementById('consol-res').innerHTML=`<div class="alert a-err">❌ Conexão perdida — tente novamente.</div>`;
    }
  );
}

// ── Visualizador de Consolidados ──────────────────────────────────────────
let _consolRows=[], _consolOpsVis=new Set();

function fmtBRL(v){
  return 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

async function loadConsolTabela(){
  _consolRowLimit=50;
  document.getElementById('consol-tbody').innerHTML=
    '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)"><span class="spin"></span> Carregando...</td></tr>';
  try{
    const d=await (await apiFetch('/api/consolidados/tabela')).json();
    _consolRows=d.rows||[];
    // Popula dropdown de transportadoras
    const sel=document.getElementById('consol-q');
    const prevVal=sel.value;
    sel.innerHTML='<option value="">📋 Todas as transportadoras</option>';
    const transpSet=[...new Set(_consolRows.map(r=>r.transp).filter(Boolean))].sort();
    transpSet.forEach(t=>{
      const o=document.createElement('option');
      o.value=t.toLowerCase(); o.textContent=t;
      sel.appendChild(o);
    });
    sel.value=prevVal||'';
    // Cards de op
    const cards=document.getElementById('consol-op-cards');
    if(!d.por_op||!d.por_op.length){
      cards.innerHTML='<div class="alert a-warn" style="margin-bottom:0">Nenhum consolidado encontrado. Gere os consolidados primeiro.</div>';
      document.getElementById('consol-dl-area').style.display='none';
      document.getElementById('consol-filter-bar').style.display='none';
      document.getElementById('consol-tbody').innerHTML='<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Sem dados</td></tr>';
      return;
    }
    document.getElementById('consol-dl-area').style.display='';
    document.getElementById('consol-filter-bar').style.display='';
    _consolOpsVis=new Set(d.por_op.map(o=>o.op));
    cards.innerHTML=`<div class="consol-cards">`+d.por_op.map(o=>
      `<div class="consol-card on" data-op="${o.op}" onclick="toggleConsolOp(this,'${o.op}')">
        <div class="consol-card-op">${o.op}</div>
        <div class="consol-card-val">${fmtBRL(o.total)}</div>
        <div class="consol-card-sub">${o.linhas} linha(s)</div>
      </div>`
    ).join('')+`</div>`;
    // Chips de op para filtro de download
    const cv=document.getElementById('chips-consol-view'); cv.innerHTML='';
    d.por_op.forEach(o=>{
      const chip=document.createElement('div');
      chip.className='chip on'; chip.dataset.op=o.op; chip.textContent=o.op;
      chip.onclick=()=>{ chip.classList.toggle('on'); renderConsolTabela(); };
      cv.appendChild(chip);
    });
    renderConsolTabela();
    // total geral
    document.getElementById('consol-tbl-footer').textContent=
      `${_consolRows.length} linhas · Total geral: ${fmtBRL(d.total)}`;
  }catch(e){
    document.getElementById('consol-tbody').innerHTML=`<tr><td colspan="6" style="padding:16px;color:var(--red);text-align:center">❌ Erro ao carregar consolidados: ${e.message||e}</td></tr>`;
    document.getElementById('consol-op-cards').innerHTML=`<div class="alert a-err" style="margin:0">❌ ${e.message||e}</div>`;
    toast('❌ Erro ao carregar consolidados: '+(e.message||e),'err',6000);
  }
}

function toggleConsolOp(el, op){
  el.classList.toggle('on');
  if(_consolOpsVis.has(op)) _consolOpsVis.delete(op); else _consolOpsVis.add(op);
  // sincroniza chip
  document.querySelectorAll('#chips-consol-view .chip').forEach(c=>{
    if(c.dataset.op===op) c.classList.toggle('on', _consolOpsVis.has(op));
  });
  renderConsolTabela();
}

let _consolRowLimit=50;

function renderConsolTabela(){
  const q=(document.getElementById('consol-q').value||'').toLowerCase();
  const opsCard=new Set([...document.querySelectorAll('#consol-op-cards .consol-card.on')].map(c=>c.dataset.op));
  const opsChip=new Set([...document.querySelectorAll('#chips-consol-view .chip.on')].map(c=>c.dataset.op));
  const opsOk=new Set([...opsCard].filter(o=>opsChip.has(o)));
  let rows=_consolRows.filter(r=>opsOk.has(r.op));
  if(q) rows=rows.filter(r=>r.transp.toLowerCase()===q);
  const total=rows.reduce((s,r)=>s+r.valor,0);

  // Atualiza valor e linhas nos cards por op conforme filtro ativo
  document.querySelectorAll('#consol-op-cards .consol-card').forEach(card=>{
    const op=card.dataset.op;
    const opRows=rows.filter(r=>r.op===op);
    const opTotal=opRows.reduce((s,r)=>s+r.valor,0);
    const opLinhas=opRows.length;
    const valEl=card.querySelector('.consol-card-val');
    const subEl=card.querySelector('.consol-card-sub');
    if(valEl) valEl.textContent=fmtBRL(opTotal);
    if(subEl) subEl.textContent=opLinhas+' linha(s)';
  });
  const visible=rows.slice(0,_consolRowLimit);
  const hasMore=rows.length>_consolRowLimit;
  document.getElementById('consol-show-more').style.display=hasMore?'':'none';
  if(hasMore) document.querySelector('#consol-show-more button').textContent=
    `Ver mais (${rows.length - _consolRowLimit} restantes) ↓`;
  document.getElementById('consol-tbl-footer').textContent=
    `Exibindo ${visible.length} de ${rows.length} linha(s) · Total filtrado: ${fmtBRL(total)}`;
  if(!rows.length){
    document.getElementById('consol-tbody').innerHTML=
      '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Sem resultados para os filtros aplicados</td></tr>';
    return;
  }
  document.getElementById('consol-tbody').innerHTML=visible.map(r=>`<tr>
    <td><span class="badge b-vazio" style="font-size:10px">${r.op}</span></td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.transp}">${r.transp||'—'}</td>
    <td style="font-family:'IBM Plex Mono',monospace;font-size:11px">${r.cnpj||'—'}</td>
    <td style="font-size:12px">${r.operacao||'—'}</td>
    <td class="val-cell"><span class="val-pos">${fmtBRL(r.valor)}</span></td>
    <td style="font-family:'IBM Plex Mono',monospace;font-size:11px">${r.periodo||'—'}</td>
  </tr>`).join('');
}

function consolShowMore(){
  _consolRowLimit+=100;
  renderConsolTabela();
}

async function limparConsolidados(){
  const confirmed = await new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML=`<div style="background:var(--surface);border-radius:16px;width:min(420px,95vw);padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">🗑️ Limpar consolidados</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6">
        Remove todos os arquivos <strong>consolidados</strong> existentes.<br>
        Você precisará gerá-los novamente antes do próximo envio.<br><br>
        <strong>Essa ação não pode ser desfeita.</strong>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="lc-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="lc-confirm" class="btn" style="background:#b91c1c;color:white;padding:8px 20px">🗑️ Sim, limpar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#lc-cancel').onclick=()=>{document.body.removeChild(ov);resolve(false);};
    ov.querySelector('#lc-confirm').onclick=()=>{document.body.removeChild(ov);resolve(true);};
  });
  if(!confirmed) return;
  const btn=document.getElementById('btn-limpar-consol');
  const res=document.getElementById('consol-limpar-res');
  btn.disabled=true; btn.textContent='🗑️ Limpando...';
  try{
    const d=await (await apiFetch('/api/consolidados/limpar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    if(d.erros&&d.erros.length)
      res.innerHTML=`<div class="alert a-warn">⚠️ ${d.removidos} removido(s), ${d.erros.length} erro(s)</div>`;
    else
      res.innerHTML=`<div class="alert a-ok">✅ ${d.removidos} arquivo(s) removido(s)</div>`;
    _consolRows=[]; _consolRowLimit=50;
    document.getElementById('consol-op-cards').innerHTML='';
    document.getElementById('consol-tbody').innerHTML=
      '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Sem dados — gere os consolidados novamente</td></tr>';
    document.getElementById('consol-tbl-footer').textContent='';
    document.getElementById('consol-show-more').style.display='none';
  }catch(e){
    res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`;
  }finally{
    btn.disabled=false; btn.innerHTML='🗑️ Limpar antigos';
  }
}

// Operações com aba mapeada na planilha "dashboard" (ver
// app/core/sheets_export.py::OP_PARA_ABA — mantenha igual ao backend).
const OPS_SHEETS_MAP=['FM','FM BIGS','LH','LH HANDLING','LM','LM FF','INCENTIVO LH','INCENTIVO LM'];

// Modal simples pra escolher quais operações colar no Sheets, em vez de
// sempre processar as 8 de uma vez. Retorna a lista escolhida, ou null se
// o usuário cancelar.
function _pickOpsParaSheets(){
  return new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
    const itens=OPS_SHEETS_MAP.map(op=>`
      <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" class="pk-op" value="${op}" checked style="width:16px;height:16px"> ${op}
      </label>`).join('');
    ov.innerHTML=`<div style="background:var(--surface);border-radius:16px;width:min(380px,95vw);padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px">📋 Colar no Sheets</div>
      <div style="font-size:12px;color:var(--text-muted,#888);margin-bottom:14px">Escolha quais operações atualizar na planilha.</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="pk-all" class="btn btn-ghost btn-sm">Todas</button>
        <button id="pk-none" class="btn btn-ghost btn-sm">Nenhuma</button>
      </div>
      <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border,#3332);border-radius:8px;padding:4px;margin-bottom:18px">${itens}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="pk-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="pk-confirm" class="btn btn-primary btn-sm">📋 Colar selecionadas</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const cks=()=>[...ov.querySelectorAll('.pk-op')];
    ov.querySelector('#pk-all').onclick=()=>cks().forEach(c=>c.checked=true);
    ov.querySelector('#pk-none').onclick=()=>cks().forEach(c=>c.checked=false);
    const cleanup=sel=>{document.body.removeChild(ov);resolve(sel);};
    ov.querySelector('#pk-cancel').onclick=()=>cleanup(null);
    ov.querySelector('#pk-confirm').onclick=()=>{
      const sel=cks().filter(c=>c.checked).map(c=>c.value);
      if(!sel.length){toast('⚠️ Selecione ao menos uma operação','warn',3000);return;}
      cleanup(sel);
    };
    ov.addEventListener('click',e=>{if(e.target===ov)cleanup(null);});
    ov.addEventListener('keydown',e=>{if(e.key==='Escape')cleanup(null);});
  });
}

async function enviarConsolidadosSheets(){
  const opsEscolhidas=await _pickOpsParaSheets();
  if(!opsEscolhidas) return;

  // Existe um botão "Colar no Sheets" aqui em Gerar Consolidados e outro lá
  // embaixo em Consolidados existentes (mesma ação) — atualiza os dois, não
  // só o de baixo, senão quem clica no de cima não vê nenhum feedback de
  // carregando/concluído no lugar onde clicou.
  const btns=[...document.querySelectorAll('.js-btn-sheets-consol')];
  const res=document.getElementById('consol-sheets-res');
  btns.forEach(b=>{b.disabled=true; b.innerHTML='<span class="spin"></span> Colando...';});
  if(res) res.innerHTML='';
  try{
    const d=await (await apiFetch('/api/consolidados/enviar_sheets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops:opsEscolhidas})})).json();
    if(!d.ok && !d.total_novas){
      if(res) res.innerHTML=`<div class="alert a-err">❌ ${d.erro||(d.erros||[]).join(' · ')||'Falha ao colar no Sheets'}</div>`;
      toast('❌ Falha ao colar no Sheets','err',6000);
      return;
    }
    const porAba=Object.entries(d.abas||{}).filter(([,n])=>n>0).map(([aba,n])=>`${aba} (+${n})`).join(', ');
    if(d.total_novas>0){
      if(res) res.innerHTML=`<div class="alert a-ok">✅ ${d.total_novas} linha(s) nova(s) colada(s)${porAba?': '+porAba:''}</div>`;
      toast(`✅ ${d.total_novas} linha(s) coladas no Sheets`,'ok',5000);
    } else {
      if(res) res.innerHTML=`<div class="alert a-info">ℹ️ Nada novo pra colar — tudo que já existe em "Consolidados Reais" já está na planilha.</div>`;
      toast('ℹ️ Nada novo pra colar no Sheets','info',5000);
    }
    if(d.erros&&d.erros.length&&res){
      res.innerHTML+=`<div class="alert a-warn" style="margin-top:6px">⚠️ ${d.erros.join(' · ')}</div>`;
    }
  }catch(e){
    if(res) res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`;
    toast('❌ Erro: '+e.message,'err',6000);
  }finally{
    btns.forEach(b=>{b.disabled=false; b.innerHTML='📋 Colar no Sheets';});
  }
}

function downloadConsolFiltrado(mode){
  const ops=mode==='all'
    ? OPS
    : [...document.querySelectorAll('#consol-op-cards .consol-card.on')].map(c=>c.dataset.op);
  if(!ops.length){
    toast('⚠️ Selecione ao menos uma operação','warn',3000);
    return;
  }
  // Navegação direta via <a href> não manda o header X-Workspace-ID (só
  // fetch/apiFetch manda) — sem o ws na query string, o servidor caía
  // sempre no workspace "default" (vazio) e dava "Nenhum consolidado
  // encontrado", mesmo com o consolidado certinho no workspace atual.
  const wsId=(typeof _adminWsId!=='undefined'&&_adminWsId)?_adminWsId:WS_ID;
  const qs=ops.map(o=>`ops=${encodeURIComponent(o)}`).join('&')+`&ws=${encodeURIComponent(wsId)}`;
  const a=document.createElement('a');
  a.href=U(`/api/consolidados/download?${qs}`);
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('⬇️ Download iniciado!','ok',3000);
}

// ── Preview unificado: arquivos + e-mails em paralelo ────────────────────
async function doPreviewTudo(){
  const btn=document.getElementById('btn-prev-email');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Analisando...';
  document.getElementById('prev-email-res').innerHTML='';
  document.getElementById('prev-area').innerHTML='';
  // Dispara os dois em paralelo
  await Promise.all([doPreview(), doPreviewEmail()]);
  btn.disabled=false; btn.innerHTML='👁️ Analisar e visualizar e-mails';
}

// ── Preview de arquivos ────────────────────────────────────────────────────
async function doPreview(){
  const ops=_sel.enviar.length?_sel.enviar:[];
  const _pa=document.getElementById('prev-area');
  _pa.innerHTML='<div class="alert a-info"><span class="spin"></span> Analisando...</div>';
  let d;
  try{
    const _r=await apiFetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops})});
    if(!_r.ok) throw new Error('HTTP '+_r.status);
    d=await _r.json();
  }catch(e){
    _pa.innerHTML=`<div class="alert a-err">❌ Erro ao carregar preview: ${e.message}</div>`;
    return;
  }
  const useful=d.filter(o=>o.total_arquivos>0||o.erro);
  if(!useful.length){_pa.innerHTML='<div class="alert a-warn">Nenhum arquivo encontrado</div>';return;}
  _pa.innerHTML=useful.map(o=>{
    if(o.erro) return `<div class="result-card erro"><div class="rh"><span class="r-op">${o.op}</span><span class="badge b-err">ERRO</span></div><div class="r-msg">${o.erro}</div></div>`;
    const grupos=o.grupos.map(g=>
      `<div class="prev-grupo"><div class="prev-key">📁 ${g.chave.join(' · ')}</div><div class="prev-files">${g.arquivos.map(f=>'→ '+f).join('<br>')}</div></div>`
    ).join('');
    return `<div class="prev-op"><div class="prev-head"><strong>${o.op}</strong><span class="badge b-ok" style="margin-left:8px">${o.grupos.length} grupo(s)</span><span style="margin-left:auto;font-size:12px;color:var(--text3)">${o.total_arquivos} arquivo(s)</span></div><div class="prev-body">${grupos}</div></div>`;
  }).join('');
}

// ── Preview de E-mail ──────────────────────────────────────────────────────
let _epItems=[], _epIdx=0;
async function doPreviewEmail(){
  const res=document.getElementById('prev-email-res');
  const ops=_sel.enviar.length?_sel.enviar:[];
  res.innerHTML='<div class="alert a-info"><span class="spin"></span> Carregando e-mails...</div>';
  try{
    const _ctrl=new AbortController();
    const _toid=setTimeout(()=>_ctrl.abort(),120000);
    let _resp;
    try{ _resp=await apiFetch('/api/preview_email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops}),signal:_ctrl.signal}); }catch(_e){ clearTimeout(_toid); const _m=_e.name==='AbortError'?'Tempo esgotado (>2min) — verifique conexão com Google Sheets ou coloque base_nova.xlsx na pasta do app.':String(_e); res.innerHTML=`<div class="alert a-err">❌ ${_m}</div>`; return; }
    clearTimeout(_toid);
    const d=await _resp.json();
    if(d.erro){res.innerHTML=`<div class="alert a-err">❌ ${d.erro}</div>`;return;}
    if(!d.length){res.innerHTML='<div class="alert a-warn">Nenhum arquivo para pré-visualizar</div>';return;}
    _epItems=d; _epIdx=0;
    epRender();
    document.getElementById('ep-overlay').classList.add('show');
    res.innerHTML=`<div class="alert a-ok" style="cursor:pointer" onclick="document.getElementById('ep-overlay').classList.add('show')">✅ ${d.length} e-mail(s) prontos — clique aqui para reabrir</div>`;
  }catch(e){
    res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`;
  }
}
function epRender(){
  if(!_epItems.length) return;
  const it=_epItems[_epIdx];
  document.getElementById('ep-counter').textContent=`${_epIdx+1} / ${_epItems.length}`;
  // Header com op + transportadora
  const transp=it.chave?.[0]||'';
  document.querySelector('#ep-overlay .ep-header strong').innerHTML=
    `👁️ <span style="color:var(--orange)">${it.op}</span>${transp?` · <span style="color:var(--text2);font-weight:400;font-size:13px">${transp}</span>`:''}`;
  const cls=it.erro?'color:var(--red)':'color:var(--green)';
  document.getElementById('ep-meta').innerHTML=
    `<div><span>Operação:</span> ${it.op} &nbsp;|&nbsp; <span>Arquivo:</span> ${it.arquivos.join(', ')}</div>`+
    (it.erro?`<div style="${cls}">❌ Erro: ${it.erro}</div>`:`
    <div><span>Assunto:</span> ${it.subject}</div>
    <div><span>Para:</span> ${it.to.join(', ')||'—'}</div>
    <div><span>CC:</span> ${it.cc.join(', ')||'—'}</div>`);
  if(it.erro){
    document.getElementById('ep-iframe').srcdoc='<p style="padding:20px;color:red">'+it.erro+'</p>';
  } else {
    document.getElementById('ep-iframe').srcdoc=it.body;
  }
  document.getElementById('ep-info-wrap').innerHTML=`
    <p><strong>Operação:</strong> ${it.op}</p>
    <p><strong>Transportadora:</strong> ${transp||'—'}</p>
    <p><strong>Arquivos:</strong> ${it.arquivos.join(', ')}</p>
    <p><strong>Assunto:</strong> ${it.subject||'—'}</p>
    <p><strong>Para:</strong> ${(it.to||[]).join(', ')||'—'}</p>
    <p><strong>CC:</strong> ${(it.cc||[]).join(', ')||'—'}</p>
    ${it.erro?`<p style="color:var(--red)"><strong>Erro:</strong> ${it.erro}</p>`:''}`;
}
function epTab(tab){
  document.querySelectorAll('.ep-tab').forEach((t,i)=>t.classList.toggle('active',['rendered','info'][i]===tab));
  document.getElementById('ep-rendered-wrap').style.display=tab==='rendered'?'block':'none';
  document.getElementById('ep-info-wrap').style.display=tab==='info'?'block':'none';
}
function epNext(){if(_epIdx<_epItems.length-1){_epIdx++;epRender();}}
function epPrev(){if(_epIdx>0){_epIdx--;epRender();}}
function epClose(e){if(e.target===document.getElementById('ep-overlay'))epCloseBtn();}
function epCloseBtn(){document.getElementById('ep-overlay').classList.remove('show');}

// ── Base_NOVA timestamp ───────────────────────────────────────────────────
async function loadBaseNovaInfo(){
  try{
    const d=await (await apiFetch('/api/base_nova_info')).json();
    const el=document.getElementById('base-nova-txt');
    if(!el) return;
    if(d.ts){
      let idade='';
      if(d.epoch){
        const mins=Math.round((Date.now()/1000-d.epoch)/60);
        idade = mins<=0 ? ' · agora mesmo' : mins===1 ? ' · há 1 min' : ` · há ${mins} min`;
        if(mins>=5) idade += ' (cache)';
      }
      el.textContent=`Base_NOVA: ${d.linhas} linhas${idade}`;
    } else {
      el.textContent='Base_NOVA não carregada ainda — será carregada ao enviar';
    }
  }catch(e){}
}
function syncTesteBanner(){
  const on=document.getElementById('t-teste').checked;
  document.getElementById('teste-banner-on').style.display=on?'':'none';
  document.getElementById('teste-banner-off').style.display=on?'none':'';
  document.getElementById('env-warn-real').style.display='none';
  document.getElementById('env-confirm-real').style.display=on?'none':'';
  if(!on){
    // reseta checkbox ao entrar no modo real
    const ck=document.getElementById('ck-confirm-real');
    if(ck) ck.checked=false;
  }
  syncConfirmReal();
  const btn=document.getElementById('btn-env');
  if(on){ btn.className='btn btn-green'; btn.textContent='🧪 Enviar em Modo Teste'; btn.disabled=false; }
  else  { btn.className='btn'; btn.style.cssText='background:#b91c1c;color:white;opacity:.45;cursor:not-allowed'; btn.textContent='⚠️ ENVIAR REAL — Pré-Faturas'; }
}
function syncConfirmReal(){
  const isTeste=document.getElementById('t-teste').checked;
  if(isTeste) return;
  const ck=document.getElementById('ck-confirm-real');
  const btn=document.getElementById('btn-env');
  const checked=ck&&ck.checked;
  btn.style.cssText=checked
    ?'background:#b91c1c;color:white;opacity:1;cursor:pointer'
    :'background:#b91c1c;color:white;opacity:.45;cursor:not-allowed';
  btn.disabled=!checked;
}
function ativarTeste(){
  document.getElementById('t-teste').checked=true; syncTesteBanner();
}
async function pedirDesativarTeste(){
  const ok=await modalConfirm(
    '⚠️ Desativar Modo Teste?',
    'Ao confirmar, os próximos envios chegarão <strong>de verdade</strong> nas transportadoras.<br><br>Tem certeza que quer sair do modo teste?',
    'Sim, desativar',
    '#b91c1c'
  );
  if(ok){ document.getElementById('t-teste').checked=false; syncTesteBanner(); }
}

// ── renderEnvRes — exibe cards de resultado do envio ──────────────────────
function renderEnvRes(results){
  const cards=(results||[]).map(r=>{
    const cls=r.status==='ok'?'ok':r.status==='parcial'?'parcial':'erro';
    const badge=`<span class="badge b-${cls==='ok'?'ok':cls==='parcial'?'parcial':'err'}">${(r.status||'').toUpperCase()}</span>`;
    const links=r.drive_links?.length
      ?`<div style="margin-top:6px">${r.drive_links.map(d=>{
          const isFolder=d.link&&d.link.includes('/folders/');
          return `<a href="${d.link}" target="_blank"
            style="display:inline-flex;align-items:center;gap:5px;font-size:12px;
                   color:var(--blue);margin-right:10px;font-weight:${isFolder?700:400}">
            ${isFolder?'📁 Pasta: ':'🔗 '}${d.nome}</a>`;
        }).join('')}</div>`
      :'';
    return `<div class="result-card ${cls}"><div class="rh"><span class="r-op">${r.op}</span>${badge}</div>
      <div class="r-msg">${r.msg||''}</div>
      ${r.subject?`<div class="r-msg" style="font-size:12px;color:var(--text3)">📧 ${r.subject}</div>`:''}
      ${links}</div>`;
  }).join('');
  const el=document.getElementById('env-res');
  el.innerHTML+='<div style="margin-top:16px">'+cards+'</div>';
}

// ── Enviar com progresso real ──────────────────────────────────────────────
// ── Seleção granular de 3PLs ─────────────────────────────────────────────────
let _3plData = [];          // [{transportadora, op, periodo, arquivos, key}]
let _sel3pl  = new Set();   // keys selecionados

async function load3PLs() {
  const btn = document.getElementById('btn-load-3pls');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Lendo arquivos...';
  document.getElementById('chips-3pl').innerHTML =
    '<span style="color:var(--text3);font-size:13px"><span class="spin"></span> Carregando...</span>';

  const ops = _sel.enviar.length ? _sel.enviar : [];
  const qs  = ops.map(o => 'ops=' + encodeURIComponent(o)).join('&');
  try {
    const data = await (await apiFetch('/api/transportadoras_pendentes' + (qs ? '?' + qs : ''))).json();
    _3plData = data;
    _sel3pl  = new Set(data.map(d => d.key)); // todas selecionadas por padrão
    render3PLs();
  } catch(e) {
    document.getElementById('chips-3pl').innerHTML =
      '<span style="color:var(--red);font-size:12px">❌ Erro ao carregar: ' + e.message + '</span>';
  }
  btn.disabled = false;
  btn.innerHTML = '🔄 Carregar 3PLs pendentes';
}

function render3PLs() {
  const wrap = document.getElementById('chips-3pl');
  const pill = document.getElementById('pill-3pl');
  const act  = document.getElementById('chip-actions-3pl');
  const res  = document.getElementById('res-3pl');

  if (!_3plData.length) {
    wrap.innerHTML = '<span style="color:var(--text3);font-size:13px">✅ Nenhuma pré-fatura pendente na fila.</span>';
    pill.style.display = 'none';
    act.style.display  = 'none';
    res.textContent    = '';
    return;
  }

  act.style.display = '';
  pill.style.display = '';
  pill.textContent   = _sel3pl.size + '/' + _3plData.length + ' selecionadas';

  wrap.innerHTML = _3plData.map(d => {
    const on = _sel3pl.has(d.key) ? 'on' : '';
    const nArqs = d.arquivos.length;
    return `<div class="chip ${on}" title="${d.arquivos.join(', ')}"
      onclick="toggle3PL('${CSS.escape(d.key)}')"
      data-key="${d.key}"
      style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;min-width:0">
      <span style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${d.transportadora}</span>
      <span style="font-size:10px;color:var(--text3)">${d.op} · ${d.periodo} · ${nArqs} arq.</span>
    </div>`;
  }).join('');

  // Usa event delegation em vez de onclick inline p/ evitar problemas com caracteres especiais no key
  wrap.querySelectorAll('.chip[data-key]').forEach(el => {
    el.onclick = () => toggle3PL(el.dataset.key);
  });

  const total    = _3plData.reduce((s, d) => s + d.arquivos.length, 0);
  const selCount = _3plData.filter(d => _sel3pl.has(d.key)).reduce((s, d) => s + d.arquivos.length, 0);
  res.textContent = _sel3pl.size === _3plData.length
    ? `Todas as ${total} pré-fatura(s) serão enviadas.`
    : _sel3pl.size === 0
      ? '⚠️ Nenhuma 3PL selecionada — o envio será bloqueado.'
      : `${_sel3pl.size} de ${_3plData.length} 3PL(s) · ${selCount} pré-fatura(s) selecionada(s) de ${total}.`;
}

function toggle3PL(key) {
  if (_sel3pl.has(key)) _sel3pl.delete(key);
  else _sel3pl.add(key);
  render3PLs();
}

function selAll3PL() { _sel3pl = new Set(_3plData.map(d => d.key)); render3PLs(); }
function clrAll3PL() { _sel3pl.clear(); render3PLs(); }

/** Retorna lista de transportadoras a enviar; [] = sem filtro (envia tudo). */
function get3PLsSelected() {
  if (!_3plData.length) return [];                        // ainda não carregou — envia tudo
  if (_sel3pl.size === _3plData.length) return [];        // todas marcadas — envia tudo
  if (_sel3pl.size === 0) return null;                    // nenhuma — bloqueia
  return _3plData.filter(d => _sel3pl.has(d.key)).map(d => d.transportadora);
}

// ── Fluxo de envio: Passo 1 → seleção de 3PLs → Passo 2 → envio real ────────

function iniciarEnvio() {
  const isTeste = document.getElementById('t-teste').checked;
  if (isTeste) {
    // Modo teste: sem seleção de 3PLs — vai direto
    doEnviar();
    return;
  }
  // Modo real: valida checkbox de confirmação primeiro
  const ck = document.getElementById('ck-confirm-real');
  if (!ck || !ck.checked) {
    toast('⚠️ Marque a confirmação antes de enviar em modo real.', 'warn', 4000);
    return;
  }
  // Mostra passo 2 — seleção de 3PLs
  const sec = document.getElementById('sec-3pl-step');
  sec.style.display = '';
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Desabilita botão ENVIAR para evitar duplo clique
  const btnEnv = document.getElementById('btn-env');
  btnEnv.disabled = true;
  btnEnv.style.opacity = '.45';
  // Carrega a lista de 3PLs pendentes
  load3PLs();
}

function confirmarEnvioComPLs() {
  // Fecha o seletor e dispara o envio com os 3PLs já selecionados em _sel3pl
  document.getElementById('sec-3pl-step').style.display = 'none';
  const btnEnv = document.getElementById('btn-env');
  btnEnv.disabled = false;
  btnEnv.style.opacity = '';
  doEnviar();
}

function cancelar3PLStep() {
  document.getElementById('sec-3pl-step').style.display = 'none';
  const btnEnv = document.getElementById('btn-env');
  btnEnv.disabled = false;
  btnEnv.style.opacity = '';
  // Limpa seleção para o próximo clique recomeçar limpo
  _3plData = [];
  _sel3pl  = new Set();
}

async function doEnviar(){
  const teste=document.getElementById('t-teste').checked?'sim':'nao';
  // Bloqueia envio real se checkbox de confirmação não foi marcada
  if(teste==='nao'){
    const ck=document.getElementById('ck-confirm-real');
    if(!ck||!ck.checked){ toast('⚠️ Marque a confirmação antes de enviar em modo real.','warn',4000); return; }
  }

  // Verifica seleção de 3PLs
  const transp3pl = get3PLsSelected();
  if(transp3pl === null){ toast('⚠️ Nenhuma 3PL selecionada. Marque pelo menos uma.','warn',4000); return; }

  // Aviso se nenhuma op selecionada (vai enviar tudo)
  if(_sel.enviar.length===0&&OPS.length>0){
    const ok=await modalConfirm(
      '⚠️ Nenhuma operação selecionada',
      `Isso enviará <strong>todas as ${OPS.length} operações</strong> disponíveis. Deseja continuar?`,
      'Sim, enviar tudo',
      '#b91c1c'
    );
    if(!ok) return;
  }
  if(teste==='nao'){
    const ops_=_sel.enviar.length?_sel.enviar:[];
    const btnE=document.getElementById('btn-env');
    btnE.disabled=true; btnE.innerHTML='<span class="spin"></span> Validando transportadoras...';
    let vres;
    try{ vres=await (await apiFetch('/api/validar_envio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops:ops_})})).json(); }
    catch(e){ vres={ok:true,erros:[],avisos:['Validação indisponível: '+e.message]}; }
    btnE.disabled=false; btnE.innerHTML='⚠️ ENVIAR REAL — Pré-Faturas'; btnE.style.cssText='background:#b91c1c;color:white';
    if(!vres.ok){
      var resumo_=vres.resumo||{};
      var resumoHtml_=resumo_.total_arquivos!=null
        ?`<div style="background:var(--bg);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;border:1px solid var(--border)">📊 <strong>${resumo_.total_arquivos}</strong> arquivo(s) · <strong>${resumo_.total_linhas_excel||0}</strong> linhas · <strong>${resumo_.total_rotas_excel||0}</strong> rotas · <span style="color:var(--red);font-weight:700">${resumo_.arquivos_erro} erro(s)</span> · ${resumo_.arquivos_aviso} aviso(s)</div>`
        :'';
      var erroHtml=(vres.erros||[]).map(e=>`<li style="color:var(--red);font-size:12px;padding:2px 0">${e}</li>`).join('');
      var avisoHtml=(vres.avisos||[]).map(a=>`<li style="color:var(--yellow);font-size:12px;padding:2px 0">${a}</li>`).join('');
      var detHtml=(vres.detalhes||[]).map(d=>{
        var icon=d.status==='ok'?'✅':d.status==='erro'?'❌':'⚠️';
        var extra=[d.linhas&&(d.linhas+'L'),d.rotas_unicas&&(d.rotas_unicas+'R'),d.zeradas>0&&(d.zeradas+' zeradas')].filter(Boolean).join(' · ');
        return `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">${icon} <strong>[${d.op}]</strong> ${d.arquivo||''} <span style="color:var(--text3);font-family:monospace">${extra}</span><div style="color:var(--text2);padding-left:14px;margin-top:1px">${d.msg||''}</div></div>`;
      }).join('');
      var bodyHtml_=resumoHtml_
        +(erroHtml?`<div style="margin-bottom:10px"><strong style="font-size:12px;color:var(--red)">Erros:</strong><ul style="padding-left:16px;margin-top:4px">${erroHtml}</ul></div>`:'')
        +(avisoHtml?`<div style="margin-bottom:10px"><strong style="font-size:12px;color:var(--yellow)">Avisos:</strong><ul style="padding-left:16px;margin-top:4px">${avisoHtml}</ul></div>`:'')
        +(detHtml?`<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:8px">${detHtml}</div>`:'');
      var prosseguir=await modalConfirm('❌ Problemas encontrados na validação',bodyHtml_,'Enviar mesmo assim','#b91c1c');
      if(!prosseguir) return;
    } else {
      var resumo2_=vres.resumo||{};
      var detOkHtml=(vres.detalhes||[]).map(d=>{
        var extra=[d.linhas&&(d.linhas+' linhas'),d.rotas_unicas&&(d.rotas_unicas+' rotas'),d.zeradas>0&&(d.zeradas+' zeradas')].filter(Boolean).join(' · ');
        return `<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">✅ <strong>[${d.op}]</strong> ${d.arquivo||''} <span style="color:var(--text3)">${extra}</span></div>`;
      }).join('');
      var resumoOkHtml=resumo2_.total_arquivos!=null
        ?`<div style="background:var(--greenL);border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px">✅ <strong>${resumo2_.total_arquivos}</strong> arquivo(s) · <strong>${resumo2_.total_linhas_excel||0}</strong> linhas · <strong>${resumo2_.total_rotas_excel||0}</strong> rotas únicas<br><span style="color:var(--green)">Todas as transportadoras encontradas na Base_NOVA.</span></div>`
        :'';
      if(vres.avisos&&vres.avisos.length) toast(vres.avisos.join(' | '),'warn',5000);
      var bodyOk_=resumoOkHtml
        +(detOkHtml?`<div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:12px">${detOkHtml}</div>`:'')
        +'Os e-mails serão <strong>enviados de verdade</strong> para as transportadoras. Esta ação não pode ser desfeita.';
      var ok2=await modalConfirm('🚀 Confirmar Envio Real',bodyOk_,'✅ Confirmar Envio','#15803d');
      if(!ok2) return;
    }
  }
  const btn=document.getElementById('btn-env');
  const pb=document.getElementById('pb-env-real');
  const pbar=document.getElementById('pbar-env-real');
  const lbl=document.getElementById('prog-label-env');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Enviando...';
  pb.classList.add('show'); lbl.classList.add('show');
  document.getElementById('log-env').innerHTML=''; document.getElementById('log-env').classList.remove('show');
  document.getElementById('env-res').innerHTML='';
  const ops=_sel.enviar.length?_sel.enviar:[];
  const totalOps=ops.length||OPS.length;
  let doneOps=0;
  const r=await apiFetch('/api/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops,teste,transportadoras:transp3pl||[]})});
  const {job_id}=await r.json();
  _currentJobId=job_id;
  document.getElementById('btn-cancel-env').style.display='';
  let _envSse;
  function _envDone(){
    _envSse&&_envSse.close(); btn.disabled=false; btn.innerHTML='📧 Enviar Pré-Faturas';
    pb.classList.remove('show'); lbl.classList.remove('show');
    document.getElementById('btn-cancel-env').style.display='none'; _currentJobId=null;
  }
  _envSse=makeSSE(
    `/api/progress/${job_id}`,
    m=>{
      if(m.type==='progress'){
        addLL('log-env',m.msg);
        lbl.textContent=m.msg;
        if(m.msg.startsWith('Processando')||m.msg.includes('Grupo')){
          doneOps++; pbar.style.width=Math.min(95,Math.round(doneOps/totalOps*100))+'%';
        }
      } else if(m.type==='done'||m.type==='cancelled'){
        _envDone(); pbar.style.width='100%';
        if(m.type==='cancelled'){
          document.getElementById('env-res').innerHTML=`<div class="section" style="margin-top:16px"><div class="alert a-warn">⛔ ${m.msg}</div></div>`;
          if(m.results&&m.results.length) renderEnvRes(m.results);
          loadStats(); loadLog(); return;
        }
        const cards=(m.results||[]).map(r=>{
          const cls=r.status==='ok'?'ok':r.status==='parcial'?'parcial':'erro';
          const badge=`<span class="badge b-${cls==='ok'?'ok':cls==='parcial'?'parcial':'err'}">${r.status.toUpperCase()}</span>`;
          const links=r.drive_links?.length?`<div style="margin-top:6px">${r.drive_links.map(d=>`<a href="${d.link}" target="_blank" style="font-size:12px;color:var(--blue);margin-right:10px">🔗 ${d.nome}</a>`).join('')}</div>`:'';
          return `<div class="result-card ${cls}"><div class="rh"><span class="r-op">${r.op}</span>${badge}</div>
            <div class="r-msg">${r.msg||''}</div>
            ${r.subject?`<div class="r-msg" style="font-size:12px;color:var(--text3)">📧 ${r.subject}</div>`:''}${links}</div>`;
        }).join('');
        document.getElementById('env-res').innerHTML=`<div style="margin-top:16px">${cards}</div>`;
        loadStats(); loadLog(); loadBaseNovaInfo();
      } else if(m.type==='error'){
        _envDone();
        const errTxt=m.msg||'Erro desconhecido — veja o terminal';
        addLL('log-env','❌ '+errTxt,'err');
        document.getElementById('env-res').innerHTML=`<div class="section" style="margin-top:16px"><div class="alert a-err" style="white-space:pre-wrap">❌ <strong>Erro:</strong> ${errTxt}</div></div>`;
      }
    },
    ()=>{
      _envDone();
      document.getElementById('env-res').innerHTML=`<div class="section" style="margin-top:16px"><div class="alert a-err">❌ Conexão perdida durante o envio — verifique o log e tente novamente.</div></div>`;
    }
  );
}

// ── Ajustes LM + FM ───────────────────────────────────────────────────────
let _ajFiles={imp:[],rotas:null,zer:[],fm:[],fm_rotas:null,lh:[],lh_rotas:null};
let _ajPrev={};   // key -> {filename -> preview stats}
let _ajTplNomesZer=[]; // nomes únicos de 3PLs do arquivo de rotas LM
let _ajTplNomesFm =[];  // nomes únicos de 3PLs do arquivo de rotas FM
let _ajTplNomesLh =[];  // nomes únicos de 3PLs do arquivo de rotas LH
const _ajDone={};      // tracking de jobs concluídos por key

function ajDrop(e,key){e.preventDefault();e.currentTarget.classList.remove('drag');ajFiles(e.dataTransfer.files,key)}

async function ajFiles(files,key){
  const arr=Array.from(files).filter(f=>f.name.toLowerCase().endsWith('.xlsx'));
  if(!arr.length) return;
  if(key==='rotas'){
    _ajFiles.rotas=arr[0];
    document.getElementById('aj-rotas-nome').textContent='✅ '+arr[0].name+' ('+Math.round(arr[0].size/1024)+' KB)';
    // Envia pro servidor para extrair IDs de rotas (usado no preview de intersecao)
    _ajCacheRotas(arr[0],'zer');
    return;
  }
  if(key==='fm_rotas'){
    _ajFiles.fm_rotas=arr[0];
    document.getElementById('aj-fm-rotas-nome').textContent='✅ '+arr[0].name+' ('+Math.round(arr[0].size/1024)+' KB)';
    _ajCacheRotas(arr[0],'fm');
    return;
  }
  if(key==='lh_rotas'){
    _ajFiles.lh_rotas=arr[0];
    document.getElementById('aj-lh-rotas-nome').textContent='✅ '+arr[0].name+' ('+Math.round(arr[0].size/1024)+' KB)';
    _ajCacheRotas(arr[0],'lh');
    return;
  }
  _ajFiles[key]=arr;
  _ajPrev[key]={};
  const _ajListaIds={imp:'aj-imp-lista',zer:'aj-zer-lista',fm:'aj-fm-lista',lh:'aj-lh-lista'};
  const _ajResIds  ={imp:'aj-imp-res',  zer:'aj-zer-res',  fm:'aj-fm-res',  lh:'aj-lh-res'};
  const listaId=_ajListaIds[key];
  const resId  =_ajResIds[key];
  document.getElementById(resId).innerHTML='';

  // Summary + compact rows
  _ajDone[key]=new Set();
  let html='<div class="aj-summary" id="aj-sum-'+key+'">'
    +'<span class="aj-sum-chip" style="background:var(--bg);border:1px solid var(--border)">'
      +'<span id="aj-sum-tot-'+key+'">'+arr.length+'</span> arquivos'
    +'</span>'
    +'<span class="aj-sum-chip" style="background:var(--orangeL);color:var(--orange)">'
      +'<span id="aj-sum-match-'+key+'">—</span> com rotas'
    +'</span>'
    +'<span class="aj-sum-chip" style="background:var(--greenL);color:var(--green)">'
      +'<span id="aj-sum-done-'+key+'">0</span> prontos'
    +'</span>'
    +'<div class="aj-sum-bar-wrap">'
      +'<div class="aj-sum-bar-lbl" id="aj-sum-lbl-'+key+'">aguardando análise...</div>'
      +'<div class="aj-sum-pbar"><div class="aj-sum-pbar-fill" id="aj-sum-pbar-'+key+'"></div></div>'
    +'</div>'
  +'</div>';
  html+='<div class="aj-list">';
  arr.forEach((f,i)=>{
    const tpl=_extract3pl(f.name);
    const sz=Math.round(f.size/1024);
    html+='<div class="aj-row" id="aj-card-'+key+'-'+i+'" title="'+f.name+' ('+sz+' KB)">'
      +'<span class="aj-row-icon">📄</span>'
      +'<span class="aj-row-tpl">'+tpl+'</span>'
      +'<span class="aj-card-cst" id="aj-cst-'+key+'-'+i+'"><span class="spin"></span></span>'
      +'<span class="aj-row-stat" id="aj-stat-'+key+'-'+i+'">—</span>'
      +'<span class="aj-card-msg" id="aj-msg-'+key+'-'+i+'">analisando...</span>'
      +'<div class="aj-row-bar"><div class="aj-bar" id="aj-bar-'+key+'-'+i+'"></div></div>'
    +'</div>';
  });
  html+='</div>';
  html+='<div class="btn-row">'
    +'<button class="btn btn-primary" data-key="'+key+'" onclick="ajEnviar(this.dataset.key)">⚙️ Processar e Baixar</button>'
  +'</div>';
  document.getElementById(listaId).innerHTML=html;

  // Busca preview de cada arquivo em paralelo (só LM/FM têm stats de rotas)
  if(key!=='imp'){
    await Promise.all(arr.map((f,i)=>_ajCheckAndPreview(f,key,i)));
  } else {
    arr.forEach((f,i)=>{ _ajSetCst(key,i,'pronto','var(--text2)'); _ajSetMsg(key,i,'Arquivo pronto — clique em Processar para aplicar o ajuste de imposto'); });
  }
}

// Normaliza nome para comparação: remove acentos, pontuação, espaços → maiúsculas
function _normTpl(s){ return s.toUpperCase().replace(/[^A-Z0-9]/g,''); }

// Extrai nome do 3PL do filename (PRE_FATURA_Last_Mile_Hub_BOXDELIVERY_2026... → BOXDELIVERY)
function _extract3pl(filename){
  const m=filename.match(/Hub_(.+?)_?\d{4}/i);
  if(m) return m[1].replace(/_/g,' ').trim();
  return filename.replace(/\.xlsx$/i,'').replace(/PRE_FATURA[_\s]*/i,'');
}

// Verifica se o nome de um arquivo de pré-fatura contém algum 3PL da lista
function _matchTpl(filename, nomes){
  if(!nomes||!nomes.length) return true; // sem filtro → aceita tudo
  const fn=_normTpl(filename);
  return nomes.some(n=>fn.includes(_normTpl(n)));
}

// Envia arquivo de rotas ao servidor para extrair os nomes únicos de 3PLs (coluna A).
// Quando recebe, re-renderiza os cards dos arquivos já carregados aplicando o filtro.
async function _ajCacheRotas(file, type){
  try{
    const fd=new FormData(); fd.append('file',file);
    const r=await apiFetch('/api/ajuste/cache_rotas',{method:'POST',body:fd});
    const d=await r.json();
    if(d.erro){ console.warn('[cache_rotas]',d.erro); return; }
    if(type==='zer')      _ajTplNomesZer=d.tpl_nomes||[];
    else if(type==='lh')  _ajTplNomesLh =d.tpl_nomes||[];
    else                  _ajTplNomesFm =d.tpl_nomes||[];
    // Re-verifica arquivos já carregados com o novo filtro
    const existing=_ajFiles[type]||[];
    if(existing.length>0){
      await Promise.all(existing.map((f,i)=>_ajCheckAndPreview(f,type,i)));
    }
  }catch(e){ console.warn('[cache_rotas] erro:',e); }
}

// Verifica match de 3PL pelo filename e, se ok, dispara preview; se não, marca como sem-rota
async function _ajCheckAndPreview(file, key, idx){
  const nomes=key==='zer'?_ajTplNomesZer:key==='lh'?_ajTplNomesLh:_ajTplNomesFm;
  if(nomes.length>0 && !_matchTpl(file.name, nomes)){
    _ajSetCst(key,idx,'⏭️ sem rotas','var(--text3)');
    _ajSetMsg(key,idx,'⚠️ 3PL não encontrado no arquivo de tarifas — será ignorado');
    const card=document.getElementById('aj-card-'+key+'-'+idx);
    if(card) card.className='aj-row';
    _ajPrev[key][file.name]={_semRota:true}; // marca como sem-rota
    _ajUpdateBtn(key);
    return;
  }
  await _ajFetchPreview(file,key,idx);
}

async function _ajFetchPreview(file,key,idx){
  const fd=new FormData();
  fd.append('file',file);
  fd.append('key',key);
  try{
    const d=await (await apiFetch('/api/aj_preview',{method:'POST',body:fd})).json();
    _ajPrev[key][file.name]=d;
    _ajRenderPre(key,idx,d);
  }catch(e){
    _ajSetCst(key,idx,'⚠️','var(--yellow)');
    _ajSetMsg(key,idx,'Erro ao analisar: '+e);
  }
}

function _ajRenderPre(key,idx,p){
  if(p.erro){
    _ajSetCst(key,idx,'⚠️','var(--yellow)');
    _ajSetMsg(key,idx,'Erro ao analisar: '+p.erro);
    return;
  }
  const total=p.total_linhas||0, zer=p.zeradas||0, ok=total-zer;
  const pctOk=total>0?Math.round(ok/total*100):100;
  const stat=document.getElementById('aj-stat-'+key+'-'+idx);
  const bar =document.getElementById('aj-bar-'+key+'-'+idx);
  const card=document.getElementById('aj-card-'+key+'-'+idx);
  if(stat) stat.textContent=zer===0?'ok':zer.toLocaleString('pt-BR')+' zer';
  if(bar){bar.style.width=pctOk+'%';bar.style.background=zer===0?'var(--green)':'var(--orange)';}
  if(card&&zer===0) card.className='aj-row ok';
  _ajSetCst(key,idx,zer===0?'✅ ok':zer.toLocaleString('pt-BR')+' pend.',zer===0?'var(--green)':'var(--yellow)');
  _ajSetMsg(key,idx,zer===0?'sem zeradas — será ignorado'
    :zer.toLocaleString('pt-BR')+' zeradas · '+(p.rotas_zeradas_unicas||'?')+' rota(s)');
  _ajUpdateSummary(key);
}

function _ajRenderPost(key,idx,d){
  const card =document.getElementById('aj-card-'+key+'-'+idx);
  const stat =document.getElementById('aj-stat-'+key+'-'+idx);
  const bar  =document.getElementById('aj-bar-'+key+'-'+idx);
  const zer  =d.total_no_arquivo||0;
  const ajust=d.total_ajustadas||0;
  const pend =d.total_ainda_zeradas||0;
  const pct  =zer>0?Math.round(ajust/zer*100):100;

  // Stat inline
  if(stat){
    if(zer===0) stat.textContent='sem zeradas';
    else if(pend===0) stat.textContent=ajust.toLocaleString('pt-BR')+' ajust';
    else stat.textContent=ajust.toLocaleString('pt-BR')+' ajust · '+pend+' pend';
    stat.style.color=pend>0?'var(--red)':'var(--green)';
  }
  if(bar){bar.style.width=pct+'%';bar.style.background=pct>=100?'var(--green)':pct>=80?'var(--orange)':'var(--red)';}
  if(card) card.className='aj-row '+(pend===0?'ok':'warn');
  _ajSetCst(key,idx,pend===0?'✅ baixado':'⚠️ '+pend+' pend.',pend===0?'var(--green)':'var(--yellow)');

  // Mensagem compacta
  const adj=d.rotas_ajustadas||[], pends=d.rotas_ainda_zeradas||[];
  let msg=zer===0?'arquivo já OK — sem zeradas':`${pct}% ajustado`;
  if(adj.length) msg+=' · '+adj.slice(0,5).join(', ')+(adj.length>5?` +${adj.length-5}`:'');
  if(pends.length) msg+=' · ⚠️ ainda: '+pends.slice(0,3).join(', ')+(pends.length>3?` +${pends.length-3}`:'');
  _ajSetMsg(key,idx,msg);

  // Track done + update summary
  if(!_ajDone[key]) _ajDone[key]=new Set();
  _ajDone[key].add(idx);
  _ajUpdateSummary(key);
}

function _ajSet(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function _ajSetCst(key,idx,html,color){const el=document.getElementById('aj-cst-'+key+'-'+idx);if(el){el.innerHTML=html;el.style.color=color||'';}}
function _ajSetMsg(key,idx,txt){const el=document.getElementById('aj-msg-'+key+'-'+idx);if(el)el.textContent=txt;}

// Atualiza o botão "Processar" com a contagem de arquivos que realmente precisam de ajuste
function _ajUpdateSummary(key){
  if(key==='imp') return;
  const files=_ajFiles[key]||[];
  const prevMap=_ajPrev[key]||{};
  const _ajListaIds2={zer:'aj-zer-lista',fm:'aj-fm-lista',lh:'aj-lh-lista'};
  const listaId=_ajListaIds2[key];
  const btn=document.querySelector('#'+listaId+' button[data-key="'+key+'"]');

  const semRota =files.filter(f=>prevMap[f.name]&&prevMap[f.name]._semRota).length;
  const semZero =files.filter(f=>{ const p=prevMap[f.name]; return p&&!p._semRota&&!p.erro&&(p.zeradas||0)===0; }).length;
  const aProcessar=files.length-semRota-semZero;
  const done=(_ajDone[key]||new Set()).size;

  // Chips
  const matchEl=document.getElementById('aj-sum-match-'+key);
  const doneEl =document.getElementById('aj-sum-done-'+key);
  const pbarEl =document.getElementById('aj-sum-pbar-'+key);
  const lblEl  =document.getElementById('aj-sum-lbl-'+key);
  if(matchEl) matchEl.textContent=aProcessar;
  if(doneEl)  doneEl.textContent=done;
  const pct=aProcessar>0?Math.round(done/aProcessar*100):0;
  if(pbarEl)  pbarEl.style.width=pct+'%';
  if(lblEl){
    if(done===0&&aProcessar>0) lblEl.textContent=`${aProcessar} para processar · ${semZero+semRota} ignorados`;
    else if(done<aProcessar)   lblEl.textContent=`${done}/${aProcessar} processados — ${aProcessar-done} restantes...`;
    else if(aProcessar>0)      lblEl.textContent=`✅ todos ${aProcessar} processados`;
    else                       lblEl.textContent='sem arquivos para processar';
  }

  // Botão
  if(btn){
    if(aProcessar>0) btn.innerHTML=`⚙️ Processar ${aProcessar}`+(files.length>aProcessar?` de ${files.length}`:'');
    else             btn.innerHTML='⚙️ Processar e Baixar';
  }
}
function _ajUpdateBtn(key){ _ajUpdateSummary(key); }

// Processa UM arquivo de ajuste e retorna true se ok
async function _ajProcessOne(key, file, i){
  const _ajEndpoints={imp:'/api/ajuste_imposto',zer:'/api/ajuste_zerado',fm:'/api/ajuste_fm',lh:'/api/ajuste_lh'};
  const endpoint=_ajEndpoints[key];
  const card=document.getElementById('aj-card-'+key+'-'+i);
  if(card) card.className='aj-row act';
  _ajSetCst(key,i,'<span class="spin"></span>','');
  _ajSetMsg(key,i,'📤 Enviando arquivo...');

  const fd=new FormData();
  fd.append('file',file);
  if(key==='zer') fd.append('rotas',_ajFiles.rotas);
  if(key==='fm')  fd.append('rotas',_ajFiles.fm_rotas);
  if(key==='lh')  fd.append('rotas',_ajFiles.lh_rotas);

  try{
    const r=await fetch(endpoint,{method:'POST',body:fd});
    const ct=r.headers.get('Content-Type')||'';
    if(!r.ok){
      let errMsg='HTTP '+r.status;
      try{const body=await r.text();if(ct.includes('application/json')){const j=JSON.parse(body);errMsg=j.erro||errMsg;}}catch(_){}
      if(card) card.className='aj-row err';
      _ajSetCst(key,i,'❌','var(--red)');
      _ajSetMsg(key,i,'Erro: '+errMsg);
      return false;
    }

    if(key!=='imp'){
      // ZER / FM: resposta é {job_id} → acompanha via SSE
      const {job_id,erro}=await r.json();
      if(erro){
        if(card) card.className='aj-row err';
        _ajSetCst(key,i,'❌','var(--red)');
        _ajSetMsg(key,i,'Erro: '+erro);
        return false;
      }
      _ajSetMsg(key,i,'⏳ Na fila de processamento...');
      return await new Promise((resolve)=>{
        let sseConn=null, done=false;
        sseConn=makeSSE(`/api/progress/${job_id}`,
          (msg)=>{
            if(msg.type==='progress'){
              _ajSetMsg(key,i,msg.msg);
            } else if(msg.type==='done'){
              if(sseConn) sseConn.close();
              const a=document.createElement('a');
              a.href=U('/api/ajuste/download/'+msg.token);
              a.download=msg.filename;
              document.body.appendChild(a);a.click();document.body.removeChild(a);
              _ajRenderPost(key,i,msg);
              if(!done){done=true;resolve(true);}
            } else if(msg.type==='error'||msg.type==='cancelled'){
              if(sseConn) sseConn.close();
              if(card) card.className='aj-row err';
              _ajSetCst(key,i,'❌','var(--red)');
              _ajSetMsg(key,i,'❌ '+msg.msg);
              if(!done){done=true;resolve(false);}
            }
          },
          ()=>{ // SSE esgotou tentativas
            _ajSetMsg(key,i,'⚠️ Conexão perdida com o servidor.');
            if(!done){done=true;resolve(false);}
          }
        );
      });
    } else {
      // IMP: resposta binária direta
      if(ct.includes('application/json')){
        const d=await r.json();
        if(d.erro){
          if(card) card.className='aj-row err';
          _ajSetCst(key,i,'❌','var(--red)');
          _ajSetMsg(key,i,'Erro: '+d.erro);
          return false;
        }
        if(d.token){
          const a=document.createElement('a');a.href=U('/api/ajuste/download/'+d.token);a.download=d.filename;document.body.appendChild(a);a.click();document.body.removeChild(a);
        } else if(d.file){
          const bytes=Uint8Array.from(atob(d.file),c=>c.charCodeAt(0));
          const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
          const url=URL.createObjectURL(blob);
          const a=document.createElement('a');a.href=url;a.download=d.filename;a.click();URL.revokeObjectURL(url);
        }
        _ajRenderPost(key,i,d);
        return true;
      } else {
        const blob=await r.blob();
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=url;
        a.download=file.name;
        a.click();URL.revokeObjectURL(url);
        if(card) card.className='aj-row ok';
        _ajSetCst(key,i,'✅ baixado','var(--green)');
        _ajSetMsg(key,i,'Arquivo processado e baixado com sucesso');
        return true;
      }
    }
  }catch(e){
    if(card) card.className='aj-row err';
    _ajSetCst(key,i,'❌','var(--red)');
    _ajSetMsg(key,i,'Erro: '+e);
    return false;
  }
}

async function ajEnviar(key){
  const files=_ajFiles[key];
  if(!files||!files.length) return;
  const _ajResIds2={imp:'aj-imp-res',zer:'aj-zer-res',fm:'aj-fm-res',lh:'aj-lh-res'};
  const resId=_ajResIds2[key];
  const res=document.getElementById(resId);

  if(key==='zer'&&!_ajFiles.rotas){res.innerHTML='<div class="alert a-warn">⚠️ Carregue primeiro o arquivo de rotas</div>';return;}
  if(key==='fm'&&!_ajFiles.fm_rotas){res.innerHTML='<div class="alert a-warn">⚠️ Carregue primeiro o arquivo de rotas FM</div>';return;}
  if(key==='lh'&&!_ajFiles.lh_rotas){res.innerHTML='<div class="alert a-warn">⚠️ Carregue primeiro o arquivo de rotas LH</div>';return;}

  res.innerHTML='';
  let skipped=0;

  // Separa os que devem ser pulados (sem zerados)
  const tasks=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    if(key!=='imp'){
      const prev=(_ajPrev[key]||{})[file.name];
      const card=document.getElementById('aj-card-'+key+'-'+i);
      // Pula: marcado como sem-rota (3PL não consta no arquivo de tarifas)
      if(prev&&prev._semRota){
        if(card) card.className='aj-card';
        _ajSetCst(key,i,'⏭️ sem rotas','var(--text3)');
        _ajSetMsg(key,i,'⚠️ 3PL não consta no arquivo de tarifas — ignorado');
        skipped++; continue;
      }
      // Pula: sem linhas zeradas
      if(prev&&!prev.erro&&(prev.zeradas||0)===0){
        if(card) card.className='aj-row ok';
        _ajSetCst(key,i,'⏭️ pulado','var(--text3)');
        _ajSetMsg(key,i,'sem zeradas — ignorado');
        skipped++; continue;
      }
    }
    tasks.push({file,i});
  }

  // Dispara TODOS em paralelo — cada card atualiza de forma independente
  // O servidor limita a 2 simultâneos via semáforo; os outros ficam na fila com SSE
  const results=await Promise.allSettled(tasks.map(({file,i})=>_ajProcessOne(key,file,i)));
  const ok=results.filter(r=>r.status==='fulfilled'&&r.value===true).length;

  if(ok>0||skipped>0){
    const skipNote=skipped>0?` · <span style="color:var(--text3)">${skipped} já OK (ignorados)</span>`:'';
    res.innerHTML=`<div class="alert a-ok">✅ ${ok} arquivo(s) processado(s) e baixado(s)${skipNote}</div>`+res.innerHTML;
  }
}

// ── Cancelar Envio ────────────────────────────────────────────────────────
let _currentJobId=null;
async function cancelarEnvio(){
  if(!_currentJobId) return;
  try{ await fetch(`/api/cancelar/${_currentJobId}`,{method:'POST'}); }catch(e){}
  document.getElementById('btn-cancel-env').style.display='none';
}

// ── Log com filtros ────────────────────────────────────────────────────────
let _logAll=[], _logFilterStatus='all', _logFilterOp='all';

async function loadLog(){
  try{
    const _lr=await apiFetch('/api/log');
    if(!_lr.ok) throw new Error('HTTP '+_lr.status);
    _logAll=await _lr.json();
  }catch(e){
    console.warn('loadLog:',e); _logAll=[];
    const _tb=document.getElementById('log-tbody');
    if(_tb) _tb.innerHTML=`<tr><td colspan='7' style='padding:16px;color:var(--red);text-align:center'>❌ Erro ao carregar histórico: ${e.message}</td></tr>`;
    return;
  }
  // Monta chips de op dinamicamente
  const ops=[...new Set(_logAll.map(r=>r.operacao).filter(Boolean))];
  const fc=document.getElementById('log-op-filters');
  fc.innerHTML=`<div class="lf-chip on" data-op="all" onclick="setLogOpFilter(this,'all')">Todas ops</div>`+
    ops.map(o=>`<div class="lf-chip" data-op="${o}" onclick="setLogOpFilter(this,'${o}')">${o}</div>`).join('');
  renderLog();
}

function setLogFilter(el,status){
  document.querySelectorAll('#log-filters .lf-chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on'); _logFilterStatus=status; renderLog();
}
function setLogOpFilter(el,op){
  document.querySelectorAll('#log-op-filters .lf-chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on'); _logFilterOp=op; renderLog();
}
function filtLog(){renderLog();}

function renderLog(){
  const q=document.getElementById('log-q').value.toLowerCase();
  let rows=_logAll;
  if(_logFilterStatus!=='all'){
    if(_logFilterStatus==='reenvio') rows=rows.filter(r=>r.modo==='reenvio');
    else if(_logFilterStatus==='teste') rows=rows.filter(r=>r.modo==='sim'||r.modo?.includes('teste'));
    else rows=rows.filter(r=>r.status?.toUpperCase()===_logFilterStatus);
  }
  if(_logFilterOp!=='all') rows=rows.filter(r=>r.operacao===_logFilterOp);
  if(q) rows=rows.filter(r=>Object.values(r).some(v=>String(v).toLowerCase().includes(q)));

  // Quando filtro for "Todos", exclui testes do total exibido no rodapé
  const isTodosFilter = _logFilterStatus === 'all' && !q && _logFilterOp === 'all';
  const testsCount = isTodosFilter ? rows.filter(r=>r.modo==='sim'||r.modo?.includes('teste')).length : 0;
  if(isTodosFilter && testsCount > 0) rows = rows.filter(r=>r.modo!=='sim'&&!r.modo?.includes('teste'));

  // #9 — mostra total real, não corta silenciosamente
  const total=rows.length; const limit=200; const visible=rows.slice(0,limit);
  const footer=document.getElementById('log-footer');
  if(footer) footer.textContent=total>limit
    ?`⚠️ Exibindo ${limit} de ${total} registros — use os filtros para refinar`
    :`${total} registro(s)${isTodosFilter&&testsCount>0?' ('+testsCount+' testes ocultos — clique em 🧪 Teste para ver)':''}`;

  const STATUS_CLS={OK:'b-ok',ACEITO:'b-ok',ERRO:'b-err',ERRO_DRIVE:'b-err',PARCIAL:'b-parcial'};
  const ROW_CLS={OK:'log-ok',ACEITO:'log-ok',ERRO:'log-err',ERRO_DRIVE:'log-err',PARCIAL:'log-parcial'};
  document.getElementById('log-tbody').innerHTML=visible.map(r=>{
    const sc=STATUS_CLS[r.status?.toUpperCase()]||'b-vazio';
    const rc=ROW_CLS[r.status?.toUpperCase()]||'';
    const canReenv = r.status?.toUpperCase()==='OK'||r.status?.toUpperCase()==='PARCIAL';
    const reenvTitle=canReenv&&r.operacao?`Reenviar "${r.arquivo?.split(' | ')[0]}" · Op: ${r.operacao} · ${r.modo==='sim'||r.modo?.includes('teste')?'modo teste':'modo real'}`:'';
    const reenvBtn = canReenv&&r.operacao&&r.arquivo
      ? `<button class="btn-reenv" title="${reenvTitle}" data-op="${r.operacao.replace(/"/g,'&quot;')}" data-arq="${r.arquivo.split(' | ')[0].replace(/"/g,'&quot;')}" onclick="doReenviar(this.dataset.op,this.dataset.arq)">🔁 Reenviar</button>`
      : '—';
    const isTeste = r.modo==='sim'||r.modo?.includes('teste');
    return `<tr class="${rc}${isTeste?' log-teste':''}">
      <td style="white-space:nowrap;font-family:'IBM Plex Mono',monospace;font-size:11px">${r.timestamp||'—'}</td>
      <td><strong>${r.operacao||'—'}</strong></td>
      <td style="max-width:260px;font-size:12px;word-break:break-all;cursor:help" title="${r.arquivo||''}">${r.arquivo||'—'}${isTeste?' <span style="font-size:10px;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;padding:1px 5px;font-weight:600">TESTE</span>':''}</td>
      <td><span class="badge ${sc}">${r.status||'—'}</span></td>
      <td style="font-size:12px">${r.modo||'—'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text3)" title="${r.motivo||''}">${r.motivo||'—'}</td>
      <td>${reenvBtn}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text3)">Sem registros</td></tr>';
}

// #10 — reenviar com modal próprio (não confirm())
async function doReenviar(op, arquivo){
  const isTeste=document.getElementById('t-teste')?.checked!==false;
  const modoLabel=isTeste?'🧪 TESTE — apenas para o remetente':'⚠️ REAL — a transportadora receberá';
  const modoColor=isTeste?'#15803d':'#b91c1c';
  const modoStyle=`color:${modoColor};font-weight:700`;

  const confirmed = await new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML=`<div style="background:var(--surface);border-radius:16px;width:min(440px,95vw);padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:17px;font-weight:700;margin-bottom:6px">🔁 Confirmar reenvio</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">Arquivo: <code style="background:var(--bg);padding:2px 6px;border-radius:4px">${arquivo}</code></div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">Operação: <strong>${op}</strong></div>
      <div style="font-size:13px;font-weight:700;color:${modoColor};margin-bottom:20px">Modo: ${modoLabel}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="rv-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="rv-confirm" class="btn" style="background:${modoColor};color:white;padding:8px 20px">🔁 Reenviar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#rv-cancel').onclick=()=>{document.body.removeChild(ov);resolve(false);};
    ov.querySelector('#rv-confirm').onclick=()=>{document.body.removeChild(ov);resolve(true);};
  });
  if(!confirmed) return;
  // Aviso se já enviado hoje no modo real
  const _hoje=new Date().toISOString().slice(0,10);
  const _jaEnv=_logAll.find(r=>r.arquivo&&r.arquivo.split(' | ').some(a=>a===arquivo)&&r.timestamp&&r.timestamp.startsWith(_hoje)&&r.status&&r.status.toUpperCase()==='OK'&&r.modo!=='sim');
  if(_jaEnv){
    const _pr=await modalConfirm(
      '⚠️ Já enviado hoje',
      `Este arquivo já foi enviado às <strong>${_jaEnv.timestamp.slice(11,16)}</strong> no modo real.<br><br>Deseja reenviar mesmo assim?`,
      'Reenviar mesmo assim',
      '#d97706'
    );
    if(!_pr) return;
  }
  const res=document.getElementById('reenv-res');
  res.innerHTML=`<div class="alert ${isTeste?'a-info':'a-warn'}"><span class="spin"></span> Reenviando <strong>${arquivo}</strong> — <span style="${modoStyle}">${modoLabel}</span></div>`;
  try{
    const r=await apiFetch('/api/reenviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,arquivo,teste:isTeste?'sim':'nao'})});
    const {job_id,erro}=await r.json();
    if(erro){res.innerHTML=`<div class="alert a-err">❌ ${erro}</div>`;return;}
    const es=new EventSource(`/api/progress/${job_id}`);
    es.onmessage=e=>{
      const m=JSON.parse(e.data);
      if(m.type==='progress') res.innerHTML=`<div class="alert a-info"><span class="spin"></span> ${m.msg}</div>`;
      else if(m.type==='done'){ es.close(); res.innerHTML=`<div class="alert a-ok">✅ ${m.msg}</div>`; loadLog(); }
      else if(m.type==='error'){ es.close(); res.innerHTML=`<div class="alert a-err" style="white-space:pre-wrap">❌ ${m.msg}</div>`; }
    };
  }catch(e){ res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`; }
}

// ── Config ────────────────────────────────────────────────────────────────
async function showConfig(){
  const d=await (await apiFetch('/api/config')).json();
  document.getElementById('c-from').value=d.EMAIL_FROM||'';
  document.getElementById('c-token').value=d.EMAIL_TOKEN||'';
  document.getElementById('c-sheet').value=d.SPREADSHEET_ID||'';
  document.getElementById('c-drive').value=d.DRIVE_FOLDER_ID||'';
  document.getElementById('c-subj').value=d.SUBJECT_PREFIX||'';
  document.getElementById('c-to').value=(d.RAFAEL_ALWAYS_TO||[]).join(', ');
  document.getElementById('c-cc').value=(d.ALWAYS_CC||[]).join(', ');
  document.getElementById('c-ecc').value=(d.EXTRA_CC||[]).join(', ');
  document.getElementById('cfg-modal').classList.add('show');
}
function closeConfig(){document.getElementById('cfg-modal').classList.remove('show')}
function hideConfig(e){if(e.target===document.getElementById('cfg-modal'))closeConfig()}
async function saveConfig(){
  const body={
    EMAIL_FROM:document.getElementById('c-from').value,
    EMAIL_TOKEN:document.getElementById('c-token').value,
    SPREADSHEET_ID:document.getElementById('c-sheet').value,
    DRIVE_FOLDER_ID:document.getElementById('c-drive').value,
    SUBJECT_PREFIX:document.getElementById('c-subj').value,
    RAFAEL_ALWAYS_TO:document.getElementById('c-to').value.split(',').map(x=>x.trim()).filter(Boolean),
    ALWAYS_CC:document.getElementById('c-cc').value.split(',').map(x=>x.trim()).filter(Boolean),
    EXTRA_CC:document.getElementById('c-ecc').value.split(',').map(x=>x.trim()).filter(Boolean),
  };
  let d;
  try{
    const r=await apiFetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    d=await r.json();
  }catch(e){
    document.getElementById('cfg-res').innerHTML=`<div class="alert a-err">❌ Erro de conexão: ${e.message}</div>`;
    return;
  }
  document.getElementById('cfg-res').innerHTML=d.ok
    ?'<div class="alert a-ok">✅ Salvo</div>'
    :'<div class="alert a-err">❌ Erro ao salvar</div>';
}

// ── Limpar fila de uploads ────────────────────────────────────────────────
async function limparEnviar(){
  const res=document.getElementById('up-res');
  const btn=document.getElementById('btn-limpar');
  // Modal de confirmação próprio
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px';
  overlay.innerHTML=`<div style="background:var(--surface);border-radius:16px;width:min(420px,95vw);padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">🗑️ Limpar fila</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6">
      Isso vai <strong>remover permanentemente</strong> todos os arquivos pendentes das pastas <code style="background:var(--bg);padding:2px 6px;border-radius:4px">enviar/</code> de todas as operações.<br><br>
      <strong>Essa ação não pode ser desfeita.</strong>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="lf-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
      <button id="lf-confirm" class="btn" style="background:#b91c1c;color:white;padding:8px 20px">🗑️ Sim, remover tudo</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  return new Promise(resolve=>{
    overlay.querySelector('#lf-cancel').onclick=()=>{document.body.removeChild(overlay);resolve(false);};
    overlay.querySelector('#lf-confirm').onclick=async()=>{
      document.body.removeChild(overlay);
      btn.disabled=true; btn.textContent='🗑️ Limpando...';
      res.innerHTML='<div class="alert a-info"><span class="spin"></span> Removendo arquivos...</div>';
      try{
        const d=await (await apiFetch('/api/limpar_enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
        if(d.erros&&d.erros.length)
          res.innerHTML=`<div class="alert a-warn">⚠️ ${d.removidos} removido(s), ${d.erros.length} erro(s): ${d.erros.join(', ')}</div>`;
        else
          res.innerHTML=`<div class="alert a-ok">✅ ${d.removidos} arquivo(s) removido(s) com sucesso</div>`;
        loadStats(); setTimeout(updateStepper,500);
      }catch(e){
        res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`;
      }finally{
        btn.disabled=false; btn.innerHTML='🗑️ Limpar fila';
      }
      resolve(true);
    };
  });
}

// ── URL de rede ───────────────────────────────────────────────────────────
async function loadNetUrl() {
  try {
    const d = await (await apiFetch('/api/server_info')).json();
    if (d.ip && d.ip !== '127.0.0.1') {
      const badge = document.getElementById('net-url-badge');
      document.getElementById('net-url-text').textContent = d.local_url;
      badge.style.display = 'flex';
      badge._url = d.local_url;
    }
  } catch(e) {}
}
function copyNetUrl() {
  const badge = document.getElementById('net-url-badge');
  const url = badge._url;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const c = document.getElementById('net-url-copied');
    c.style.display = 'inline';
    setTimeout(() => c.style.display = 'none', 2000);
  });
}

// ── Presença ──────────────────────────────────────────────────────────────
async function pingPresence(){
  try{
    const d=await (await apiFetch('/api/presence',{method:'POST'})).json();
    const badge=document.getElementById('presence-badge');
    const dot=document.getElementById('presence-dot');
    const txt=document.getElementById('presence-txt');
    const n=d.total||1;
    const outros=n-1;
    badge.style.display='flex';
    if(outros===0){
      badge.style.background='var(--greenL)';
      badge.style.borderColor='#86efac';
      badge.style.color='#15803d';
      dot.style.background='#16a34a';
      txt.textContent='Só você online';
    } else {
      badge.style.background='var(--yellowL)';
      badge.style.borderColor='#fde68a';
      badge.style.color='#92400e';
      dot.style.background='#d97706';
      const ips=d.users.filter(u=>!u.eu).map(u=>u.ip);
      txt.textContent=`+${outros} usuário${outros>1?'s':''} online`;
      badge.title=`Usuários online agora:\\n${d.users.map(u=>(u.eu?'• Você':'• '+u.ip)).join('\\n')}`;
    }
  }catch(e){}
}
pingPresence();
setInterval(pingPresence,15000);

// ── Escape fecha modais ────────────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  ['ep-overlay','cfg-modal','pu-overlay','reset-modal'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.remove('show','visible');
  });
  // fecha modais dinâmicos (limpar, reenviar)
  document.querySelectorAll('[data-modal-close]').forEach(el=>el.remove());
});

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type='info', ms=3000){
  const bg={info:'#1e293b',ok:'#15803d',err:'#b91c1c',warn:'#92400e'}[type]||'#1e293b';
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg};color:white;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .3s`;
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300);},ms);
}

// ── Reset modal ────────────────────────────────────────────────────────────
function showReset(){
  document.getElementById('reset-res').innerHTML='';
  ['enviar','consolidado','enviado','log'].forEach(k=>{
    const cb=document.getElementById('reset-'+k);
    const row=document.getElementById('reset-row-'+k);
    const sync=()=>{ row.style.borderColor=cb.checked?'var(--red)':'var(--border2)'; row.style.background=cb.checked?'var(--redL)':''; };
    cb.onchange=sync; sync();
  });
  document.getElementById('reset-modal').classList.add('show');
}
function closeReset(){ document.getElementById('reset-modal').classList.remove('show'); }
function hideReset(e){ if(e.target===document.getElementById('reset-modal')) closeReset(); }

async function execReset(){
  const escopos=[];
  if(document.getElementById('reset-enviar').checked)      escopos.push('enviar');
  if(document.getElementById('reset-consolidado').checked) escopos.push('consolidado');
  if(document.getElementById('reset-enviado').checked)     escopos.push('enviado');
  if(document.getElementById('reset-log').checked)         escopos.push('log');
  if(!escopos.length){ toast('Selecione ao menos um escopo','warn'); return; }

  const btn=document.getElementById('btn-reset-exec');
  const res=document.getElementById('reset-res');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Resetando...';
  res.innerHTML='';
  try{
    const d=await (await apiFetch('/api/reset_tudo',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({escopos})
    })).json();
    if(!d.ok){ res.innerHTML=`<div class="alert a-err">❌ Erro: ${JSON.stringify(d)}</div>`; return; }
    const r=d.resultado;
    const linhas=[];
    if(r.enviar)      linhas.push(`• Fila envio: ${r.enviar.removidos} arquivo(s) removido(s)`);
    if(r.consolidado) linhas.push(`• Consolidados: ${r.consolidado.removidos} arquivo(s) removido(s)`);
    if(r.enviado)     linhas.push(`• Enviados: ${r.enviado.removidos} arquivo(s) removido(s)`);
    if(r.log)         linhas.push(`• Log: ${r.log.ok?'limpo com sucesso':'❌ '+r.log.erro}`);
    const errosTodos=[...(r.enviar?.erros||[]),...(r.consolidado?.erros||[]),...(r.enviado?.erros||[])];
    res.innerHTML=`<div class="alert a-ok" style="flex-direction:column;align-items:flex-start;gap:4px">
      <strong>✅ Reset concluído</strong>
      ${linhas.map(l=>`<span style="font-size:12px">${l}</span>`).join('')}
    </div>`+(errosTodos.length?`<div class="alert a-warn" style="margin-top:8px;font-size:12px">⚠️ ${errosTodos.length} erro(s): ${errosTodos.join(', ')}</div>`:'');
    loadStats(); loadLog(); loadConsolTabela(); loadBaseNovaInfo();
    if(escopos.includes('consolidado')){
      _consolRows=[]; _consolRowLimit=50;
      document.getElementById('consol-op-cards').innerHTML='';
      document.getElementById('consol-tbody').innerHTML='<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">Sem dados</td></tr>';
      document.getElementById('consol-tbl-footer').textContent='';
    }
  }catch(e){
    res.innerHTML=`<div class="alert a-err">❌ ${e}</div>`;
  }finally{
    btn.disabled=false; btn.innerHTML='🔄 Executar Reset';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
// Pequeno delay para garantir que o servidor Flask já está pronto
setTimeout(()=>{
  loadOps();
  loadStats();
  loadLog();
  syncTesteBanner();
  loadNetUrl();
  loadConsolTabela();
  loadBaseNovaInfo();
  // checkHealth() removido do boot — é pesado (Drive+Sheets+SMTP em série).
  // Roda apenas ao clicar "Verificar" na aba de configurações.
  // Workspace badge e link de download do log
  const badge = document.getElementById('ws-badge');
  if (badge) badge.textContent = WS_ID;
  const dlLink = document.getElementById('log-dl-link');
  if (dlLink) dlLink.href = U(`/api/log/download?ws=${WS_ID}`);
}, 300);
setInterval(loadStats, 10000);
setInterval(()=>updateStepper(), 35000);

// ── Badge de carga do servidor ─────────────────────────────────────────────
async function pollCarga(){
  try{
    const d=await (await apiFetch('/api/status_carga')).json();
    const badge=document.getElementById('carga-badge');
    const envOc=d.envio?.ocupados||0, envEsp=d.envio?.esperando||0;
    const ajOc=d.ajuste?.ocupados||0, ajEsp=d.ajuste?.esperando||0;
    const busy=envOc>0||ajOc>0||envEsp>0||ajEsp>0;
    if(!busy){ badge.style.display='none'; return; }
    badge.style.display='flex';
    const parts=[];
    if(envOc>0) parts.push(`📤 ${envOc} envio`);
    if(envEsp>0) parts.push(`⏳ ${envEsp} aguardando envio`);
    if(ajOc>0)  parts.push(`⚙️ ${ajOc} ajuste`);
    if(ajEsp>0) parts.push(`⏳ ${ajEsp} aguardando ajuste`);
    badge.textContent=parts.join('  ·  ');
    const overload=envEsp>0||ajEsp>0;
    badge.style.background=overload?'var(--redL)':'var(--yellowL)';
    badge.style.borderColor=overload?'#fecaca':'#fde68a';
    badge.style.color=overload?'var(--red)':'var(--yellow)';
  }catch(e){}
}
pollCarga();
setInterval(pollCarga,10000);

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN MODE
// ══════════════════════════════════════════════════════════════════════════════
const _MY_WS_ID = WS_ID;   // workspace real do usuário
let _adminToken  = '';
let _adminWsId   = '';      // workspace sendo visualizado (vazio = próprio)

// Aplica override de workspace: todas as chamadas apiFetch usarão esse WS_ID
function _adminApplyWs(wsId, email=''){
  _adminWsId = wsId;
  const banner = document.getElementById('admin-banner');
  const pill   = document.getElementById('admin-ws-pill');
  const em     = document.getElementById('admin-ws-email');
  if(wsId && wsId !== _MY_WS_ID){
    banner.classList.add('show');
    pill.textContent = wsId;
    em.textContent   = email ? `· ${email}` : '';
    document.getElementById('admin-ws-overlay').classList.remove('show');
    // Recarrega todos os dados com o novo WS
    loadStats(); loadLog(); loadConsolTabela();
    toast(`👁️ Visualizando como ${email||wsId}`, 'info', 5000);
  } else {
    banner.classList.remove('show');
    _adminWsId = '';
  }
}

// apiFetch já suporta admin override (ver definição no início do script)
window._adminGetWs = () => (typeof _adminWsId !== 'undefined' && _adminWsId) ? _adminWsId : WS_ID;

function adminOpen(){
  if(_adminToken){
    // Já autenticado — abre workspace selector
    showAdminWorkspaces();
  } else {
    document.getElementById('admin-pin-input').value='';
    document.getElementById('admin-pin-err').style.display='none';
    document.getElementById('admin-pin-overlay').classList.add('show');
    setTimeout(()=>document.getElementById('admin-pin-input').focus(),100);
  }
}

async function adminAuthSubmit(){
  const pin = document.getElementById('admin-pin-input').value.trim();
  const err = document.getElementById('admin-pin-err');
  if(!pin){ err.textContent='Digite o PIN'; err.style.display=''; return; }
  const btn = document.querySelector('#admin-pin-overlay .btn-primary');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span>';
  try{
    const r = await fetch('/api/admin/auth',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({pin})
    });
    const d = await r.json();
    if(d.ok){
      _adminToken = d.token;
      document.getElementById('admin-pin-overlay').classList.remove('show');
      showAdminWorkspaces();
    } else {
      err.textContent = d.erro||'PIN incorreto';
      err.style.display = '';
    }
  } catch(e){
    err.textContent = 'Erro de conexão: '+e.message;
    err.style.display = '';
  }
  btn.disabled=false; btn.innerHTML='Entrar';
}

async function loadAdminWorkspaces(){
  const list = document.getElementById('admin-ws-list');
  list.innerHTML='<div style="padding:28px;text-align:center;color:var(--text3)"><span class="spin"></span> Carregando...</div>';
  try{
    const r = await fetch('/api/admin/workspaces',{headers:{'X-Admin-Token':_adminToken}});
    if(!r.ok){ list.innerHTML='<div style="padding:20px;color:var(--red)">❌ Token expirado — faça login novamente.</div>'; _adminToken=''; return; }
    const wss = await r.json();
    if(!wss.length){ list.innerHTML='<div style="padding:28px;text-align:center;color:var(--text3)">Nenhum workspace encontrado</div>'; return; }
    list.innerHTML = wss.map(w=>{
      const isMe = w.ws_id===_MY_WS_ID;
      const ini  = (w.email||w.ws_id).charAt(0).toUpperCase();
      const sub  = [
        w.ultimo_envio ? '📅 '+w.ultimo_envio.substring(0,10) : 'sem atividade',
        w.total_envios  ? w.total_envios+' envios' : '',
      ].filter(Boolean).join(' · ');
      const badges = [
        w.pendentes  ? `<span class="awc-badge pend">📤 ${w.pendentes} pend.</span>` : '',
        w.envios_hoje ? `<span class="awc-badge hoje">✅ ${w.envios_hoje} hoje</span>` : '',
        isMe          ? `<span class="awc-badge" style="background:var(--blueL);color:var(--blue)">eu</span>` : '',
      ].join('');
      return `<div class="admin-ws-card${isMe?' me':''}" onclick="${isMe?'':'adminSelectWs(\''+w.ws_id+'\',\''+w.email+'\')'}">
        <div class="awc-avatar">${ini}</div>
        <div class="awc-info">
          <div class="awc-email">${w.email||w.ws_id}</div>
          <div class="awc-sub">${w.ws_id} · ${sub}</div>
        </div>
        <div class="awc-badges">${badges}</div>
      </div>`;
    }).join('');
  } catch(e){
    list.innerHTML=`<div style="padding:20px;color:var(--red)">❌ ${e.message}</div>`;
  }
}

function showAdminWorkspaces(){
  document.getElementById('admin-ws-overlay').classList.add('show');
  loadAdminWorkspaces();
}

function adminSelectWs(wsId, email){
  _adminApplyWs(wsId, email);
}

function adminExit(){
  _adminApplyWs(_MY_WS_ID);
  document.getElementById('admin-banner').classList.remove('show');
  loadStats(); loadLog(); loadConsolTabela();
  toast('Voltou para seu workspace', 'info');
}
setTimeout(()=>{ if(OPS.length===0){ console.log('retry loadOps'); loadOps(); } }, 2500);
setTimeout(()=>{ loadStats(); updateStepper(); }, 2500); // retry stats após 2.5s
// Atualiza imediatamente ao voltar para a aba — evita dados stale quando usuário alterna janelas
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ loadStats(); updateStepper(); pingPresence(); } });
// Primeiro uso: pede e-mail se ainda não foi configurado
setTimeout(puVerificar, 1000);  // pequeno delay para o servidor estar pronto