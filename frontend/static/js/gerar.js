// ── GERAR (Pré-Fatura) — busca 3PLs na API Datasuite e gera direto na fila ─
// Depende de helpers definidos em portal.js: apiFetch, makeSSE, addLL, clearLog, toast, go.
let _ger3plData=[], _gerSel3pl=new Set(), _currentGerJobId=null;

document.addEventListener('DOMContentLoaded', () => {
  const hoje=new Date();
  const anoEl=document.getElementById('ger-ano');
  const mesEl=document.getElementById('ger-mes');
  const quinzenaEl=document.getElementById('ger-quinzena');
  if(anoEl && !anoEl.value) anoEl.value=hoje.getFullYear();
  if(mesEl && !mesEl.value) mesEl.value=hoje.getMonth()+1;
  if(quinzenaEl) quinzenaEl.value=hoje.getDate()<=15?'01':'02';
});

function irParaValidar(){ location.href=U('/validar'); }

let _ultimosGerados=[];

// Gerar → Validar em lote: carrega TODOS os arquivos recém-gerados de uma vez
// (em vez de clicar "Validar agora" um por um) e roda a validação uma única
// vez no final, já com todos na fila.
async function irValidarTodosGerados(){
  const itens=_ultimosGerados;
  if(!itens.length){ toast('⚠️ Nenhum arquivo gerado nesta sessão.','warn',4000); return; }
  go('validador');
  if(typeof showPage==='function') showPage('upload');
  let ok=0; const falhas=[];
  for(const g of itens){
    try{
      const r=await apiFetch(`/api/arquivo/${encodeURIComponent(g.op)}/${encodeURIComponent(g.arquivo)}`);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const blob=await r.blob();
      const f=new File([blob],g.arquivo,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      if(typeof registrarOrigemOp==='function') registrarOrigemOp(g.arquivo, g.op);
      if(typeof adicionarArquivos==='function') adicionarArquivos([f]);
      ok++;
    }catch(e){
      falhas.push(g.arquivo);
    }
  }
  toast(`📥 ${ok} arquivo(s) carregado(s) no Validador${falhas.length?' · '+falhas.length+' falharam':''}`,
    falhas.length?'warn':'ok', 4000);
  setTimeout(()=>{ if(typeof validarTodos==='function') validarTodos(); }, 500);
}

// Gerar → Validar sem reload de página: navega pra aba Validar (SPA) e já
// carrega + roda a validação do arquivo recém-gerado.
async function irValidarGerado(op, arquivo){
  go('validador');
  if(typeof showPage==='function') showPage('upload');
  try{
    const r=await apiFetch(`/api/arquivo/${encodeURIComponent(op)}/${encodeURIComponent(arquivo)}`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const blob=await r.blob();
    const f=new File([blob],arquivo,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    if(typeof registrarOrigemOp==='function') registrarOrigemOp(arquivo, op);
    if(typeof adicionarArquivos==='function'){
      adicionarArquivos([f]);
      setTimeout(()=>{ if(typeof validarTodos==='function') validarTodos(); },400);
    }
  }catch(e){
    toast('❌ Erro ao carregar arquivo pro validador: '+e.message,'err',6000);
  }
}

async function gerBuscar3pls(){
  const modalidade=document.getElementById('ger-modalidade').value;
  const ano=document.getElementById('ger-ano').value.trim();
  const mesRaw=document.getElementById('ger-mes').value.trim();
  const quinzena=document.getElementById('ger-quinzena').value;
  if(!ano||!mesRaw){ toast('⚠️ Informe ano e mês.','warn',4000); return; }
  const mes=mesRaw.padStart(2,'0');

  const btn=document.getElementById('btn-ger-buscar');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Buscando...';
  try{
    const r=await apiFetch('/api/gerar/buscar_3pls',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({modalidade,ano,mes,quinzena})});
    const d=await r.json();
    if(!d.ok){ toast('❌ '+d.error,'err',6000); return; }
    _ger3plData=d.data||[]; _gerSel3pl=new Set();
    document.getElementById('ger-3pl-wrap').style.display='';
    renderGer3plChips();
    if(!_ger3plData.length) toast('⚠️ Nenhuma 3PL encontrada para este período.','warn',5000);
  }catch(e){
    toast('❌ Erro ao buscar 3PLs: '+e.message,'err',6000);
  }finally{
    btn.disabled=false; btn.innerHTML='🔎 Buscar 3PLs do período';
  }
}

function renderGer3plChips(){
  const box=document.getElementById('ger-3pl-chips');
  if(!_ger3plData.length){ box.innerHTML='<div style="padding:14px;color:var(--text3);font-size:13px">Nenhuma 3PL encontrada.</div>'; return; }
  box.innerHTML=_ger3plData.map(item=>{
    const nome=String(item.transportador||'').trim();
    const qtd=item.qnt!=null?item.qnt:(item.qtd_pacotes!=null?item.qtd_pacotes:null);
    const on=_gerSel3pl.has(nome)?' on':'';
    const safeNome=nome.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<div class="ger-3pl-row${on}" onclick="gerToggleChip('${safeNome}')">
      <span class="ger-3pl-check">${_gerSel3pl.has(nome)?'✓':''}</span>
      <span class="ger-3pl-name">${nome}</span>
      ${qtd!=null?'<span class="ger-3pl-qtd">'+qtd.toLocaleString('pt-BR')+'</span>':''}
    </div>`;
  }).join('');
}

function gerToggleChip(nome){
  if(_gerSel3pl.has(nome)) _gerSel3pl.delete(nome); else _gerSel3pl.add(nome);
  renderGer3plChips();
}
function gerSelAll3pl(){ _gerSel3pl=new Set(_ger3plData.map(i=>String(i.transportador||'').trim())); renderGer3plChips(); }
function gerClrAll3pl(){ _gerSel3pl=new Set(); renderGer3plChips(); }

function gerExecutarUm({modalidade,transportador,ano,mes,quinzena,dia_corte}){
  return new Promise(async (resolve,reject)=>{
    try{
      const r=await apiFetch('/api/gerar/iniciar',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({modalidade,transportador,ano,mes,quinzena,dia_corte})});
      const d=await r.json();
      if(!d.job_id){ reject(new Error(d.error||'job_id não retornado')); return; }
      _currentGerJobId=d.job_id;
      const es=makeSSE(`/api/progress/${d.job_id}`, m=>{
        if(m.type==='progress'){
          addLL('log-ger', m.msg);
          document.getElementById('ger-prog-label').textContent=m.msg;
        } else if(m.type==='done'){
          addLL('log-ger', `✅ ${transportador}: ${m.arquivo} (${(m.linhas||0).toLocaleString('pt-BR')} linhas)`, 'ok');
          es.close(); resolve(m);
        } else if(m.type==='cancelled'){
          addLL('log-ger', `⊘ ${transportador} cancelado`, 'err');
          es.close(); resolve(null);
        } else if(m.type==='error'){
          addLL('log-ger', `✗ ${transportador}: ${m.msg}`, 'err');
          es.close(); reject(new Error(m.msg||'erro desconhecido'));
        }
      }, ()=>reject(new Error('Conexão perdida com o servidor')));
    }catch(e){ reject(e); }
  });
}

async function gerIniciar(){
  let lista=[..._gerSel3pl];
  if(!lista.length){ toast('⚠️ Selecione ao menos uma 3PL.','warn',4000); return; }

  // Sempre gera da menor pra maior (por volume/qnt), não importa a ordem em
  // que as 3PLs foram clicadas/selecionadas — deixa as maiores (mais lentas
  // na API Datasuite) pro final.
  const qntPorNome={};
  for(const item of _ger3plData){
    const nome=String(item.transportador||'').trim();
    qntPorNome[nome]=item.qnt!=null?item.qnt:(item.qtd_pacotes!=null?item.qtd_pacotes:0);
  }
  lista=lista.slice().sort((a,b)=>(qntPorNome[a]||0)-(qntPorNome[b]||0));

  const modalidade=document.getElementById('ger-modalidade').value;
  const ano=document.getElementById('ger-ano').value.trim();
  const mes=document.getElementById('ger-mes').value.trim().padStart(2,'0');
  const quinzena=document.getElementById('ger-quinzena').value;
  const dia_corte=document.getElementById('ger-corte').value.trim()||null;

  const btn=document.getElementById('btn-ger-iniciar');
  const btnCancel=document.getElementById('btn-ger-cancelar');
  const pb=document.getElementById('ger-prog-bar');
  const pbf=document.getElementById('ger-prog-bar-fill');
  const lbl=document.getElementById('ger-prog-label');
  const stats=document.getElementById('ger-prog-stats');
  const stTotal=document.getElementById('ger-stat-total');
  const stOk=document.getElementById('ger-stat-ok');
  const stPend=document.getElementById('ger-stat-pend');
  const stErr=document.getElementById('ger-stat-err');
  const stErrWrap=document.getElementById('ger-stat-err-wrap');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Gerando...';
  btnCancel.style.display='';
  pb.classList.add('show'); lbl.classList.add('show'); stats.classList.add('show');
  document.getElementById('log-ger').innerHTML=''; document.getElementById('log-ger').classList.add('show');
  document.getElementById('ger-res').innerHTML='';
  pbf.style.width='0%';

  // Contadores ao vivo — quantas já baixaram, quantas faltam, quantas falharam.
  let okCount=0, errCount=0;
  const total=lista.length;
  const atualizarContadores=()=>{
    stTotal.textContent=total;
    stOk.textContent=okCount;
    stPend.textContent=total-okCount-errCount;
    stErr.textContent=errCount;
    stErrWrap.classList.toggle('zero', errCount===0);
  };
  atualizarContadores();

  const gerados=[];
  for(let i=0;i<lista.length;i++){
    const transportador=lista[i];
    lbl.textContent=`(${i+1}/${lista.length}) Gerando ${transportador}...`;
    addLL('log-ger', `▶ Iniciando ${transportador} (${i+1}/${lista.length})`);
    try{
      const result=await gerExecutarUm({modalidade,transportador,ano,mes,quinzena,dia_corte});
      if(result){ gerados.push(result); okCount++; } else { errCount++; }
    }catch(e){
      errCount++;
      toast('❌ Falha em '+transportador+': '+e.message,'err',6000);
    }
    atualizarContadores();
    pbf.style.width=Math.round(((i+1)/lista.length)*100)+'%';
  }

  btn.disabled=false; btn.innerHTML='⚙️ Gerar Pré-Fatura(s)';
  btnCancel.style.display='none'; _currentGerJobId=null;
  pb.classList.remove('show'); lbl.classList.remove('show');

  if(gerados.length){
    _ultimosGerados=gerados;
    const barraLote=gerados.length>1?`
      <div class="btn-row" style="margin:0 0 12px">
        <button class="btn btn-primary btn-sm" onclick="irValidarTodosGerados()">✅ Validar todos os gerados (${gerados.length})</button>
        <button class="btn btn-ghost btn-sm" onclick="go('consolidar');loadConsolTabela()">🔗 Ir para Consolidar</button>
      </div>`:'';
    document.getElementById('ger-res').innerHTML=barraLote+gerados.map(g=>`
      <div class="result-card ok">
        <div class="rh"><span class="r-op" title="${g.op} · ${g.arquivo}">✅ ${g.op} · ${g.arquivo}</span><span class="badge b-ok">${(g.linhas||0).toLocaleString('pt-BR')} linhas</span></div>
        <div class="r-msg">Salvo em enviar/${g.op}/ — pronto para validar ou consolidar.</div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" onclick="irValidarGerado('${g.op.replace(/'/g,"\\'")}','${g.arquivo.replace(/'/g,"\\'")}')">🔎 Validar agora</button>
          <button class="btn btn-ghost btn-sm" onclick="go('consolidar');loadConsolTabela()">🔗 Ir para Consolidar</button>
        </div>
      </div>`).join('');
  }
  if(typeof loadStats==='function') loadStats();
}

function gerCancelar(){
  if(!_currentGerJobId) return;
  apiFetch(`/api/cancelar/${_currentGerJobId}`,{method:'POST'});
  toast('⛔ Cancelamento solicitado — aguardando job atual finalizar...','warn',4000);
}
