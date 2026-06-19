// Incremental SMC panel upgrade: responsible field, SAVES.json first, panel tabs.
(function(){
  const PLANNER_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/planner-api";
  const state = { users:[], permissions:[], currentUser:null, loaded:false };
  function esc(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function code(email){ return String(email || "").toLowerCase().split("@")[0] || "-"; }
  function authHeaders(){ return typeof smcAuthHeader === "function" ? smcAuthHeader() : {}; }
  function headers(){ return { "Content-Type":"application/json", ...authHeaders() }; }
  function isManager(){ const p = window.smcPerfil || state.currentUser?.perfil || "publico"; return p === "master" || p === "admin"; }
  async function plannerBootstrap(){
    const token = typeof smcSession !== "undefined" ? smcSession?.access_token : "";
    if (!token) return;
    try {
      const res = await fetch(`${PLANNER_API}?action=bootstrap`, { headers:headers() });
      const json = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(json.error || "Falha ao carregar usuários da Engenharia.");
      state.currentUser = json.current_user;
      state.users = json.users || [];
      state.permissions = json.permissions || [];
      state.loaded = true;
      fillResponsibleOptions();
      buildPanelTabs();
    } catch(error) { console.warn("SMC Planner bootstrap:", error.message); }
  }
  function permissionFor(userId, taskType){ return state.permissions.find(p => p.user_id === userId && p.task_type === taskType); }
  function canExecute(userId, taskType){ return Boolean(permissionFor(userId, taskType)?.can_execute); }
  function fillResponsibleOptions(){
    const select = document.getElementById("responsavelInicial");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Selecione o responsável...</option>` + state.users.map(u => `<option value="${esc(u.id)}" data-email="${esc(u.email)}" data-code="${esc(u.user_code || code(u.email))}">${esc(u.user_code || code(u.email))} • ${esc(u.nome || "")}</option>`).join("");
    if (current) select.value = current;
  }
  function addResponsibleField(){
    const tipo = document.getElementById("tipo");
    const prioridade = document.getElementById("prioridade");
    if (!tipo || !prioridade || document.getElementById("responsavelInicial")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.innerHTML = `<label>Direcionar para responsável <span class="required">*</span></label><select id="responsavelInicial" required><option value="">Carregando responsáveis...</option></select><span id="responsavelHint" class="mini">Lista restrita a colaboradores autorizados da Engenharia de Processo.</span>`;
    prioridade.closest(".field")?.after(wrapper);
    fillResponsibleOptions();
    document.getElementById("responsavelInicial").addEventListener("change", validateResponsible);
    tipo.addEventListener("change", validateResponsible);
  }
  function validateResponsible(){
    const responsible = document.getElementById("responsavelInicial")?.value || "";
    const type = document.getElementById("tipo")?.value || "";
    const hint = document.getElementById("responsavelHint");
    if (!hint) return true;
    if (!responsible || !type) { hint.textContent = "Selecione o tipo e o responsável inicial."; hint.style.color = ""; return false; }
    if (state.loaded && !canExecute(responsible, type)) {
      hint.textContent = "Este colaborador não possui permissão para executar este tipo de tarefa.";
      hint.style.color = "#ffd0d0";
      return false;
    }
    hint.textContent = "Responsável autorizado para este tipo de solicitação.";
    hint.style.color = "#b7ffd0";
    return true;
  }
  window.SmcPanelUpgradeValidateResponsible = validateResponsible;
  window.SmcPanelUpgradeState = state;
  function selectedResponsiblePayload(){
    const select = document.getElementById("responsavelInicial");
    const opt = select?.selectedOptions?.[0];
    return { responsible_id:select?.value || "", responsible_email:opt?.dataset.email || "", responsible_user_code:opt?.dataset.code || "" };
  }
  async function withSolicitacoesAuth(fn){
    const originalFetch = window.fetch;
    window.fetch = (input, init = {}) => {
      const url = String(input || "");
      if (url.includes("solicitacoes-api")) init = { ...init, headers:{ ...(init.headers || {}), ...authHeaders() } };
      return originalFetch(input, init);
    };
    try { return await fn(); }
    finally { window.fetch = originalFetch; }
  }
  function patchSaveFunction(){
    const original = window.salvarSolicitacaoSupabase;
    if (typeof original !== "function" || original.__smcSavesPatched) return;
    async function patched(registro){
      const responsible = selectedResponsiblePayload();
      if (!responsible.responsible_id) throw new Error("Direcionar para responsável é obrigatório.");
      if (!validateResponsible()) throw new Error("Este colaborador não possui permissão para executar este tipo de tarefa.");
      const enriched = { ...registro, ...responsible, local_id:registro.local_id || `sol-${Date.now()}-${Math.random().toString(16).slice(2)}`, sync_status:"pending" };
      const local = window.SmcSaves?.saveLocal?.("solicitacoes", enriched, { action:"createSolicitacao", details:"salvo local antes do Supabase" });
      try {
        const saved = await withSolicitacoesAuth(() => original(enriched));
        if (local) window.SmcSaves?.markSynced?.("solicitacoes", local.local_id, saved);
        window.SmcSaves?.saveLocal?.("plannerTasks", { solicitation_id:saved.id, local_id:`${local?.local_id || enriched.local_id}-task`, title:saved.titulo || enriched.titulo, description:saved.problema || enriched.problema, status:"Não iniciada", priority:saved.prioridade || enriched.prioridade, task_type:saved.tipo || enriched.tipo, responsible_id:responsible.responsible_id, responsible_email:responsible.responsible_email, responsible_user_code:responsible.responsible_user_code, sync_status:"synced" }, { action:"linkedPlannerTask", status:"synced" });
        return { ...saved, ...responsible, local_id:local?.local_id || enriched.local_id, sync_status:"synced" };
      } catch(error) {
        if (local) window.SmcSaves?.markError?.("solicitacoes", local.local_id, error);
        throw error;
      }
    }
    patched.__smcSavesPatched = true;
    window.salvarSolicitacaoSupabase = patched;
  }
  function buildPanelTabs(){
    const panelCard = document.querySelector("#painel > .card");
    if (!panelCard || panelCard.dataset.tabsReady === "1") return;
    panelCard.dataset.tabsReady = "1";
    const stats = panelCard.querySelector(".stats");
    const toolbar = panelCard.querySelector(".toolbar");
    const actions = panelCard.querySelector(".panel-actions");
    const table = panelCard.querySelector("#tableArea");
    const footer = panelCard.querySelector(".footer-note");
    const tabs = document.createElement("div");
    tabs.className = "smc-panel-tabs";
    tabs.innerHTML = `<button class="smc-panel-tab active" data-smc-panel-tab="solicitacoes">Solicitações</button><button class="smc-panel-tab" data-smc-panel-tab="planner">Tarefas / Planner</button><button class="smc-panel-tab" data-smc-panel-tab="dashboard">Dashboard</button>${isManager()?'<button class="smc-panel-tab" data-smc-panel-tab="permissoes">Permissões</button><button class="smc-panel-tab" data-smc-panel-tab="backup">Backup / Sincronização</button>':''}`;
    panelCard.querySelector(".card-header")?.after(tabs);
    const sol = document.createElement("div"); sol.className = "smc-panel-view active"; sol.dataset.smcPanelView = "solicitacoes";
    [stats, toolbar, actions, table, footer].forEach(el => el && sol.appendChild(el));
    tabs.after(sol);
    sol.after(panelView("planner", `<iframe class="smc-panel-iframe" src="planner.html?embedded=1&tab=board" title="Tarefas / Planner"></iframe>`), panelView("dashboard", `<iframe class="smc-panel-iframe" src="planner.html?embedded=1&tab=dashboard" title="Dashboard"></iframe>`), panelView("permissoes", `<iframe class="smc-panel-iframe" src="planner.html?embedded=1&tab=permissions" title="Permissões"></iframe>`), panelView("backup", backupHtml()));
    tabs.querySelectorAll("[data-smc-panel-tab]").forEach(btn => btn.addEventListener("click", () => switchPanelTab(btn.dataset.smcPanelTab)));
    bindBackupButtons();
  }
  function panelView(name, html){ const div=document.createElement("div"); div.className="smc-panel-view"; div.dataset.smcPanelView=name; div.innerHTML=html; return div; }
  function switchPanelTab(name){
    document.querySelectorAll("[data-smc-panel-tab]").forEach(b => b.classList.toggle("active", b.dataset.smcPanelTab === name));
    document.querySelectorAll("[data-smc-panel-view]").forEach(v => v.classList.toggle("active", v.dataset.smcPanelView === name));
    updateBackupStatus();
  }
  function backupHtml(){
    return `<div class="backup-box"><div class="backup-grid"><div class="backup-card"><strong id="savePending">0</strong><span>Pendentes</span></div><div class="backup-card"><strong id="saveErrors">0</strong><span>Erros</span></div><div class="backup-card"><strong id="saveUpdated">-</strong><span>Última atualização</span></div><div class="backup-card"><strong id="saveDevice">-</strong><span>Dispositivo</span></div></div><div class="actions"><button id="exportSaves" type="button">Exportar SAVES.json</button><label class="planner-import"><input id="importSaves" type="file" accept="application/json"> Importar SAVES.json</label><button id="syncSaves" type="button">Sincronizar agora</button></div><div class="notice">No GitHub Pages, o SAVES.json é uma camada lógica no navegador. Para arquivo físico, use Exportar SAVES.json. Senhas, JWT, refresh token, service_role e token GitHub não são salvos.</div></div>`;
  }
  function bindBackupButtons(){
    document.getElementById("exportSaves")?.addEventListener("click", () => window.SmcSaves?.exportSavesJson?.());
    document.getElementById("importSaves")?.addEventListener("change", async e => { if(e.target.files?.[0]) { await window.SmcSaves?.importSavesJson?.(e.target.files[0]); alert("SAVES.json importado com merge por local_id."); updateBackupStatus(); } });
    document.getElementById("syncSaves")?.addEventListener("click", () => { window.loadSolicitacoes?.(); updateBackupStatus(); const pending = window.SmcSaves?.pendingCount?.() || 0; alert(pending ? `Painel atualizado. Ainda existem ${pending} item(ns) pendente(s) no SAVES.json para sincronização com Supabase.` : "Painel atualizado. Não há pendências locais no SAVES.json."); });
    updateBackupStatus();
  }
  function updateBackupStatus(){
    const s = window.SmcSaves?.statusSummary?.();
    if (!s) return;
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set("savePending", s.pending); set("saveErrors", s.errors); set("saveUpdated", s.lastUpdatedAt ? new Date(s.lastUpdatedAt).toLocaleString("pt-BR") : "-"); set("saveDevice", String(s.deviceId||"-").slice(0,18));
  }
  function init(){
    addResponsibleField();
    patchSaveFunction();
    plannerBootstrap();
    if (location.hash === "#painel") setTimeout(() => window.showScreen?.("painel"), 300);
    setTimeout(() => { buildPanelTabs(); addResponsibleField(); window.loadSolicitacoes?.(); }, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
