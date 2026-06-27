// Hotfix de recuperacao dos cliques principais do SMC.
(function(){
  function byId(id){ return document.getElementById(id); }

  function preencherDataAtualSeguro(){
    try {
      const agora = new Date();
      const data = agora.toLocaleDateString('pt-BR');
      const dia = agora.toLocaleDateString('pt-BR', { weekday:'long' });
      const hora = agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      if (byId('dataAbertura')) byId('dataAbertura').value = data;
      if (byId('diaAbertura')) byId('diaAbertura').value = dia.charAt(0).toUpperCase() + dia.slice(1);
      if (byId('horaAbertura')) byId('horaAbertura').value = hora;
    } catch (_) {}
  }

  function mostrarTela(id){
    document.querySelectorAll('.screen').forEach(function(sec){ sec.classList.remove('active'); });
    const destino = byId(id);
    if (destino) destino.classList.add('active');
    try { window.scrollTo({ top:0, behavior:'smooth' }); } catch (_) { window.scrollTo(0,0); }
    if (id === 'formulario') preencherDataAtualSeguro();
    if (id === 'painel' && typeof window.loadSolicitacoes === 'function') {
      try { window.loadSolicitacoes(); } catch (e) { console.warn('Falha ao carregar painel:', e); }
    }
  }

  function instalarShowScreen(){
    const original = typeof window.showScreen === 'function' ? window.showScreen : null;
    window.showScreen = function(id){
      try {
        if (original) return original(id);
      } catch (e) {
        console.warn('showScreen original falhou, usando fallback:', e);
      }
      return mostrarTela(id);
    };
  }

  function cardTemTexto(card, texto){
    return String(card.textContent || '').toLowerCase().includes(texto.toLowerCase());
  }

  function instalarCliques(){
    const cards = Array.from(document.querySelectorAll('.option-card'));
    cards.forEach(function(card){
      if (card.dataset.smcClickFix === '1') return;
      card.dataset.smcClickFix = '1';
      card.style.cursor = 'pointer';
      card.addEventListener('click', function(event){
        if (cardTemTexto(card, 'Abrir solicitação')) {
          event.preventDefault();
          event.stopPropagation();
          mostrarTela('formulario');
        } else if (cardTemTexto(card, 'Painel de solicitações')) {
          event.preventDefault();
          event.stopPropagation();
          mostrarTela('painel');
        }
      }, true);
    });

    document.querySelectorAll('[data-voltar-home], .smc-voltar-home').forEach(function(btn){
      if (btn.dataset.smcClickFix === '1') return;
      btn.dataset.smcClickFix = '1';
      btn.addEventListener('click', function(event){
        event.preventDefault();
        mostrarTela('home');
      }, true);
    });
  }

  function instalarResponsavelOpcional(){
    const prioridade = byId('prioridade');
    if (!prioridade || byId('responsavelInicial')) return;
    const field = document.createElement('div');
    field.className = 'field smc-responsible-field';
    field.innerHTML = '<label>Responsável inicial <span class="mini">(opcional)</span></label><select id="responsavelInicial"><option value="">Sem responsável definido</option></select><span class="mini">A solicitação pode ser aberta sem responsável e atribuída depois.</span>';
    const base = prioridade.closest('.field');
    if (base) base.after(field);
  }

  function instalarSubmitSeguro(){
    const form = byId('formSolicitacao');
    if (!form || form.dataset.smcSubmitFix === '1') return;
    form.dataset.smcSubmitFix = '1';
    form.addEventListener('submit', function(){
      const resp = byId('responsavelInicial');
      if (resp && !resp.value) {
        resp.removeAttribute('required');
      }
    }, true);
  }

  function instalarWatchdogCarregamento(){
    if (window.__smcLoadWatchdog) return;
    window.__smcLoadWatchdog = true;
    setTimeout(function(){
      try {
        if (document.readyState !== 'complete') {
          console.warn('SMC: carregamento externo demorou demais; interrompendo para manter a tela utilizável.');
          window.stop();
        }
        if (!byId('smcAuthOverlay') && !byId('smcSessionPill') && typeof window.smcRenderLoginProfissional === 'function') {
          window.smcRenderLoginProfissional();
        }
        if (!byId('smcAuthOverlay') && !byId('smcInternalOverlay')) {
          document.body.classList.remove('smc-auth-locked');
        }
        instalarCliques();
        instalarResponsavelOpcional();
        instalarSubmitSeguro();
      } catch (e) {
        console.warn('SMC watchdog falhou:', e);
      }
    }, 9000);
  }

  function init(){
    instalarWatchdogCarregamento();
    instalarShowScreen();
    instalarCliques();
    instalarResponsavelOpcional();
    instalarSubmitSeguro();
    preencherDataAtualSeguro();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 300);
  setTimeout(init, 1000);
  setTimeout(init, 2500);
})();
