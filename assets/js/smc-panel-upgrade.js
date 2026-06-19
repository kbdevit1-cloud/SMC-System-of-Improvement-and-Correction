// Incremental SMC panel upgrade: responsible routing, dashboard, notifications and assignment.
(function(){
  const SOLICITACOES_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/solicitacoes-api";
  const HIDDEN_NOTIFICATIONS_KEY = "SMC_HIDDEN_NOTIFICATIONS";
  const ENGINEERING_DEPARTMENT = "Engenharia de Processo";
  const OPEN_STATUSES = ["Recebido", "Em análise", "Aguardando informação", "Encaminhado"];
  const RUNNING_STATUS = "Em execução";
  const DONE_STATUSES = ["Concluído", "Reprovado", "Cancelado"];
  const NOTIFICATION_STATUSES = OPEN_STATUSES.concat([RUNNING_STATUS]);
  const state = {
    users: [],
    permissions: [],
    currentUser: null,
    requests: [],
    loaded: false,
    dashPeriod: "mensal",
    refreshing: false
  };

  function esc(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function codeFromEmail(email){ return String(email || "").toLowerCase().trim().split("@")[0] || ""; }
  function normalizeText(v){ return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function authHeaders(){ return typeof smcAuthHeader === "function" ? smcAuthHeader() : {}; }
  function headers(){ return { "Content-Type":"application/json", ...authHeaders() }; }
  function isManager(){ const p = window.smcPerfil || state.currentUser?.perfil || "publico"; return ["master", "admin", "adm"].includes(String(p).toLowerCase()); }
  function fmtDate(v){ return v ? new Date(v).toLocaleDateString("pt-BR") : "-"; }
  function fmtDateTime(v){ return v ? new Date(v).toLocaleString("pt-BR") : "-"; }
  function fmtMinutes(value){
    const min = Math.max(0, Math.floor(Number(value || 0)));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min`;
  }
  function createdAt(row){ return row.criado_em || row.created_at || row.dataHoraIso || row.data_abertura || ""; }
  function priorityClass(v){
    const p = normalizeText(v || "media");
    if (p.includes("baixa")) return "baixa";
    if (p.includes("alta")) return "alta";
    return "media";
  }
  function hiddenNotifications(){
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_NOTIFICATIONS_KEY) || "[]")); }
    catch (_) { return new Set(); }
  }
  function saveHiddenNotifications(set){ localStorage.setItem(HIDDEN_NOTIFICATIONS_KEY, JSON.stringify(Array.from(set).slice(-300))); }
  function timeMinutes(row){
    const base = Number(row.total_tracked_minutes || row.task_total_tracked_minutes || 0);
    if (!row.time_running || !row.active_timer_started_at) return base;
    return base + Math.max(0, Math.floor((Date.now() - new Date(row.active_timer_started_at).getTime()) / 60000));
  }

  async function api(action, method = "GET", body){
    const suffix = action ? `?action=${encodeURIComponent(action)}` : "";
    const res = await fetch(`${SOLICITACOES_API}${suffix}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Falha HTTP ${res.status}`);
    return json;
  }

  function normalizeRequest(r){
    return {
      id: r.id,
      local_id: r.local_id || "",
      titulo: r.titulo || "",
      problema: r.problema || "",
      destino: r.destino || "",
      area: r.area || "",
      tipo: r.tipo_solicitacao || r.tipo || "",
      prioridade: r.prioridade || "Média",
      status: r.status || "Recebido",
      nome: r.nome || "",
      responsible_id: r.responsible_id || "",
      responsible_email: r.responsible_email || "",
      responsible_user_code: r.responsible_user_code || codeFromEmail(r.responsible_email),
      due_date: r.due_date || "",
      task_id: r.task_id || "",
      sync_status: r.sync_status || "synced",
      criado_em: r.criado_em || r.created_at || r.dataHoraIso || "",
      data_abertura: r.data_abertura || "",
      hora_abertura: r.hora_abertura || "",
      total_tracked_minutes: Number(r.total_tracked_minutes || 0),
      time_running: Boolean(r.time_running),
      active_timer_started_at: r.active_timer_started_at || null
    };
  }

  async function loadEngineeringContext(){
    try {
      const json = await api("engineering-users");
      state.currentUser = json.current_user || null;
      state.users = (json.users || []).map(u => ({ ...u, user_code: u.user_code || codeFromEmail(u.email) }));
      state.permissions = json.permissions || [];
      state.loaded = true;
      fillResponsibleOptions();
    } catch(error) {
      console.warn("SMC engineering users:", error.message);
      state.loaded = false;
      fillResponsibleOptions();
    }
  }

  async function refreshRequests(silent = true){
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const json = await api("");
      state.requests = (json.data || []).map(normalizeRequest);
      enhanceCurrentTable();
      renderFloatingNotifications();
      renderDashboard();
    } catch(error) {
      if (!silent) console.warn("SMC solicitações:", error.message);
    } finally {
      state.refreshing = false;
    }
  }

  function permissionsForType(taskType){
    return state.permissions.filter(p => p.category === ENGINEERING_DEPARTMENT && p.task_type === taskType);
  }
  function canExecute(userId, taskType){
    if (!userId || !taskType) return false;
    const typed = permissionsForType(taskType);
    if (!typed.length) return true;
    return typed.some(p => p.user_id === userId && p.can_execute === true);
  }

  function fillResponsibleOptions(){
    const select = document.getElementById("responsavelInicial");
    if (!select) return;
    const current = select.value;
    const options = state.users.length
      ? state.users.map(u => `<option value="${esc(u.id)}" data-email="${esc(u.email)}" data-code="${esc(u.user_code || codeFromEmail(u.email))}">${esc(u.user_code || codeFromEmail(u.email))}${u.nome ? ` - ${esc(u.nome)}` : ""}</option>`).join("")
      : "";
    select.innerHTML = `<option value="">${state.loaded ? "Selecione o responsável..." : "Carregando responsáveis..."}</option>${options}`;
    if (current) select.value = current;
  }

  function addResponsibleField(){
    const tipo = document.getElementById("tipo");
    const prioridade = document.getElementById("prioridade");
    if (!tipo || !prioridade || document.getElementById("responsavelInicial")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "field smc-responsible-field";
    wrapper.innerHTML = `
      <label>Direcionar para responsável <span class="required">*</span></label>
      <select id="responsavelInicial" required>
        <option value="">Carregando responsáveis...</option>
      </select>
      <span id="responsavelHint" class="mini">Lista restrita a colaboradores da Engenharia de Processo.</span>
    `;
    prioridade.closest(".field")?.after(wrapper);
    fillResponsibleOptions();
    document.getElementById("responsavelInicial")?.addEventListener("change", validateResponsible);
    tipo.addEventListener("change", validateResponsible);
  }

  function selectedResponsiblePayload(){
    const select = document.getElementById("responsavelInicial");
    const opt = select?.selectedOptions?.[0];
    const email = opt?.dataset.email || "";
    return {
      responsible_id: select?.value || "",
      responsible_email: email,
      responsible_user_code: opt?.dataset.code || codeFromEmail(email)
    };
  }

  function validateResponsible(showMessage = false){
    const type = document.getElementById("tipo")?.value || "";
    const payload = selectedResponsiblePayload();
    const hint = document.getElementById("responsavelHint");
    const select = document.getElementById("responsavelInicial");
    let message = "";
    if (!payload.responsible_id) message = "Selecione o responsável inicial da solicitação.";
    else if (!type) message = "Selecione o tipo da solicitação.";
    else if (state.loaded && !canExecute(payload.responsible_id, type)) message = "Este colaborador não possui permissão para executar este tipo de tarefa.";
    if (select) select.setCustomValidity(message);
    if (hint) {
      hint.textContent = message || "Responsável autorizado para este tipo de solicitação.";
      hint.classList.toggle("smc-hint-error", Boolean(message));
      hint.classList.toggle("smc-hint-ok", !message);
    }
    if (message && showMessage) alert(message);
    return !message;
  }

  function bindFormValidation(){
    const form = document.getElementById("formSolicitacao");
    if (!form || form.dataset.smcResponsibleGuard === "1") return;
    form.dataset.smcResponsibleGuard = "1";
    form.addEventListener("submit", event => {
      if (!validateResponsible(true)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function installAuthFetchPatch(){
    if (window.fetch?.__smcSolicitacoesAuthPatch) return;
    const originalFetch = window.fetch.bind(window);
    const patched = (input, init = {}) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      if (url.includes("solicitacoes-api")) {
        init = { ...init, headers: { ...(init.headers || {}), ...authHeaders() } };
      }
      return originalFetch(input, init);
    };
    patched.__smcSolicitacoesAuthPatch = true;
    window.fetch = patched;
  }

  function patchSaveFunction(){
    const original = window.salvarSolicitacaoSupabase;
    if (typeof original !== "function" || original.__smcResponsiblePatched) return;
    async function patched(registro){
      if (!validateResponsible(true)) throw new Error(document.getElementById("responsavelInicial")?.validationMessage || "Selecione o responsável inicial da solicitação.");
      const responsible = selectedResponsiblePayload();
      const enriched = {
        ...registro,
        ...responsible,
        local_id: registro.local_id || `sol-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sync_status: "pending"
      };
      return original(enriched);
    }
    patched.__smcResponsiblePatched = true;
    window.salvarSolicitacaoSupabase = patched;
  }

  function patchLoadAndRender(){
    if (typeof window.loadSolicitacoes === "function" && !window.loadSolicitacoes.__smcPanelPatched) {
      const originalLoad = window.loadSolicitacoes;
      window.loadSolicitacoes = async function(){
        const result = await originalLoad.apply(this, arguments);
        await refreshRequests(true);
        return result;
      };
      window.loadSolicitacoes.__smcPanelPatched = true;
    }
    if (typeof window.renderTable === "function" && !window.renderTable.__smcPanelPatched) {
      const originalRender = window.renderTable;
      window.renderTable = function(){
        const result = originalRender.apply(this, arguments);
        enhanceCurrentTable();
        return result;
      };
      window.renderTable.__smcPanelPatched = true;
    }
  }

  function currentFilters(){
    const val = id => document.getElementById(id)?.value || "";
    return {
      busca: val("busca").toLowerCase(),
      destino: val("f_destino"),
      area: val("f_area"),
      tipo: val("f_tipo"),
      status: val("f_status")
    };
  }
  function filteredRequests(){
    const f = currentFilters();
    return state.requests.filter(r => {
      const text = Object.values(r).join(" ").toLowerCase();
      return (!f.busca || text.includes(f.busca)) &&
        (!f.destino || r.destino === f.destino) &&
        (!f.area || r.area === f.area) &&
        (!f.tipo || r.tipo === f.tipo) &&
        (!f.status || r.status === f.status);
    });
  }

  function enhanceCurrentTable(){
    const table = document.querySelector("#tableArea table");
    if (!table || !state.requests.length) return;
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const list = filteredRequests();
    rows.forEach((tr, idx) => {
      const item = list[idx];
      if (!item) return;
      tr.dataset.smcRequestId = item.id;
      const responsibleCell = tr.children[2];
      if (responsibleCell) {
        responsibleCell.innerHTML = `
          <strong>${esc(item.responsible_user_code || "Sem responsável")}</strong>
          <span class="mini">${item.due_date ? fmtDate(item.due_date) : "Sem prazo"}</span>
          <span class="mini">Tempo: ${fmtMinutes(timeMinutes(item))}${item.time_running ? " • rodando" : ""}</span>
          <span class="sync-pill ${esc(item.sync_status || "synced")}">${esc(item.sync_status || "synced")}</span>
        `;
      }
      const actionsCell = tr.lastElementChild;
      if (actionsCell && !actionsCell.querySelector("[data-smc-assign]")) {
        actionsCell.insertAdjacentHTML("afterbegin", `<button type="button" class="btn-secondary smc-assign-btn" data-smc-assign="${esc(item.id)}">Atribuição</button>`);
      }
    });
    table.querySelectorAll("[data-smc-assign]").forEach(btn => {
      btn.onclick = () => openAssignmentModal(btn.dataset.smcAssign);
    });
  }

  function openAssignmentModal(id){
    const item = state.requests.find(r => String(r.id) === String(id));
    if (!item) return alert("Solicitação não encontrada no cache do painel. Atualize o painel e tente novamente.");
    document.getElementById("smcAssignOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "smcAssignOverlay";
    overlay.className = "smc-assign-overlay";
    overlay.innerHTML = `
      <section class="smc-assign-modal" role="dialog" aria-modal="true" aria-label="Atribuição">
        <div class="smc-assign-head">
          <div><h3>Atribuição</h3><small>${esc(item.titulo || "-")}</small></div>
          <button type="button" class="btn-secondary" id="smcAssignClose">Fechar</button>
        </div>
        <label>Responsável</label>
        <select id="smcAssignResponsible">${state.users.map(u => `<option value="${esc(u.id)}" ${u.id === item.responsible_id ? "selected" : ""}>${esc(u.user_code || codeFromEmail(u.email))}${u.nome ? ` - ${esc(u.nome)}` : ""}</option>`).join("")}</select>
        <span id="smcAssignHint" class="mini">Selecione um colaborador autorizado para ${esc(item.tipo || "este tipo")}.</span>
        <div class="actions"><button type="button" id="smcAssignSave">Salvar responsável</button></div>
      </section>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const validate = () => {
      const userId = document.getElementById("smcAssignResponsible")?.value || "";
      const ok = canExecute(userId, item.tipo);
      const hint = document.getElementById("smcAssignHint");
      if (hint) {
        hint.textContent = ok ? "Responsável autorizado para este tipo de tarefa." : "Este colaborador não possui permissão para executar este tipo de tarefa.";
        hint.classList.toggle("smc-hint-error", !ok);
        hint.classList.toggle("smc-hint-ok", ok);
      }
      return ok;
    };
    document.getElementById("smcAssignClose").onclick = close;
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    document.getElementById("smcAssignResponsible").onchange = validate;
    document.getElementById("smcAssignSave").onclick = async () => {
      const responsible_id = document.getElementById("smcAssignResponsible")?.value || "";
      if (!responsible_id) return alert("Selecione o responsável inicial da solicitação.");
      if (!validate()) return alert("Este colaborador não possui permissão para executar este tipo de tarefa.");
      try {
        await api("", "PATCH", { id: item.id, responsible_id });
        close();
        await loadEngineeringContext();
        await window.loadSolicitacoes?.();
      } catch(error) {
        alert(error.message || "Falha ao alterar responsável.");
      }
    };
    validate();
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
    tabs.innerHTML = `
      <button class="smc-panel-tab active" data-smc-panel-tab="solicitacoes">Solicitações</button>
      <button class="smc-panel-tab" data-smc-panel-tab="dashboard">Dashboard</button>
      <button class="smc-panel-tab" data-smc-panel-tab="backup">Backup / Sincronização</button>
    `;
    panelCard.querySelector(".card-header")?.after(tabs);
    const sol = document.createElement("div");
    sol.className = "smc-panel-view active";
    sol.dataset.smcPanelView = "solicitacoes";
    [stats, toolbar, actions, table, footer].forEach(el => el && sol.appendChild(el));
    tabs.after(sol);
    sol.after(panelView("dashboard", '<div id="smcDashboardView" class="smc-dashboard-view"></div>'), panelView("backup", backupHtml()));
    tabs.querySelectorAll("[data-smc-panel-tab]").forEach(btn => btn.addEventListener("click", () => switchPanelTab(btn.dataset.smcPanelTab)));
    bindBackupButtons();
    renderDashboard();
  }
  function panelView(name, html){
    const div = document.createElement("div");
    div.className = "smc-panel-view";
    div.dataset.smcPanelView = name;
    div.innerHTML = html;
    return div;
  }
  function switchPanelTab(name){
    document.querySelectorAll("[data-smc-panel-tab]").forEach(b => b.classList.toggle("active", b.dataset.smcPanelTab === name));
    document.querySelectorAll("[data-smc-panel-view]").forEach(v => v.classList.toggle("active", v.dataset.smcPanelView === name));
    if (name === "dashboard") renderDashboard();
    if (name === "backup") updateBackupStatus();
  }

  function backupHtml(){
    return `<div class="backup-box"><div class="backup-grid"><div class="backup-card"><strong id="savePending">0</strong><span>Pendentes</span></div><div class="backup-card"><strong id="saveErrors">0</strong><span>Erros</span></div><div class="backup-card"><strong id="saveUpdated">-</strong><span>Ultima atualização</span></div><div class="backup-card"><strong id="saveDevice">-</strong><span>Dispositivo</span></div></div><div class="actions"><button id="exportSaves" type="button">Exportar SAVES.json</button><label class="planner-import"><input id="importSaves" type="file" accept="application/json"> Importar SAVES.json</label><button id="syncSaves" type="button">Sincronizar agora</button></div><div class="notice">No GitHub Pages, o SAVES.json é uma camada lógica no navegador. Para arquivo físico, use Exportar SAVES.json. Senhas, JWT, refresh token, service_role e token GitHub não são salvos.</div></div>`;
  }
  function bindBackupButtons(){
    document.getElementById("exportSaves")?.addEventListener("click", () => window.SmcSaves?.exportSavesJson?.());
    document.getElementById("importSaves")?.addEventListener("change", async e => {
      if(e.target.files?.[0]) {
        await window.SmcSaves?.importSavesJson?.(e.target.files[0]);
        alert("SAVES.json importado com merge por local_id.");
        updateBackupStatus();
      }
    });
    document.getElementById("syncSaves")?.addEventListener("click", async () => {
      await window.loadSolicitacoes?.();
      updateBackupStatus();
      const pending = window.SmcSaves?.pendingCount?.() || 0;
      alert(pending ? `Painel atualizado. Ainda existem ${pending} item(ns) pendente(s) no SAVES.json para sincronização com Supabase.` : "Painel atualizado. Não há pendências locais no SAVES.json.");
    });
    updateBackupStatus();
  }
  function updateBackupStatus(){
    const s = window.SmcSaves?.statusSummary?.();
    if (!s) return;
    const set = (id,v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("savePending", s.pending);
    set("saveErrors", s.errors);
    set("saveUpdated", s.lastUpdatedAt ? new Date(s.lastUpdatedAt).toLocaleString("pt-BR") : "-");
    set("saveDevice", String(s.deviceId || "-").slice(0,18));
  }

  function requestsInPeriod(){
    const list = state.requests;
    return list.filter(r => {
      const raw = createdAt(r);
      if (!raw) return true;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return true;
      const now = new Date();
      if (state.dashPeriod === "diario") return d.toDateString() === now.toDateString();
      if (state.dashPeriod === "anual") return d.getFullYear() === now.getFullYear();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }
  function isLate(r){
    if (!r.due_date || DONE_STATUSES.includes(r.status)) return false;
    const due = new Date(r.due_date);
    const today = new Date();
    today.setHours(0,0,0,0);
    return due < today;
  }
  function countRows(list){
    return {
      total: list.length,
      open: list.filter(r => OPEN_STATUSES.includes(r.status)).length,
      progress: list.filter(r => r.status === RUNNING_STATUS).length,
      done: list.filter(r => r.status === "Concluído").length,
      late: list.filter(isLate).length,
      minutes: list.reduce((sum, r) => sum + timeMinutes(r), 0)
    };
  }
  function periodKey(row){
    const d = new Date(createdAt(row) || Date.now());
    if (state.dashPeriod === "diario") return d.toLocaleDateString("pt-BR");
    if (state.dashPeriod === "anual") return String(d.getFullYear());
    return `${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }
  function groupRows(list, fn){
    const map = new Map();
    list.forEach(row => {
      const key = fn(row) || "-";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a,b) => b[1] - a[1]).slice(0, 12);
  }
  function barRows(rows){
    const max = Math.max(1, ...rows.map(r => r[1]));
    return rows.length ? rows.map(([label, value]) => `<div class="smc-dash-bar"><span>${esc(label)}</span><i style="width:${Math.max(4, value / max * 100)}%"></i><strong>${value}</strong></div>`).join("") : '<div class="empty">Sem dados.</div>';
  }
  function chart(title, rows){
    return `<section class="smc-dash-chart"><h3>${esc(title)}</h3>${barRows(rows)}</section>`;
  }
  function workloadRows(list){
    const byUser = new Map();
    list.forEach(r => {
      const key = r.responsible_user_code || codeFromEmail(r.responsible_email) || "sem-responsavel";
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(r);
    });
    return Array.from(byUser.entries()).sort((a,b) => b[1].length - a[1].length).map(([user, rows]) => {
      const c = countRows(rows);
      const alertOpen = c.open >= 10 ? '<span class="smc-work-alert red">Alerta: 10+ abertas</span>' : "";
      const alertProgress = c.progress >= 10 ? '<span class="smc-work-alert yellow">Atenção: 10+ em andamento</span>' : "";
      return `<div class="smc-work-row"><strong>${esc(user)}</strong><span>${c.open} abertas - ${c.progress} em andamento - ${c.done} concluídas</span>${alertOpen}${alertProgress}</div>`;
    }).join("") || '<div class="empty">Sem responsável no período.</div>';
  }
  function renderDashboard(){
    const root = document.getElementById("smcDashboardView");
    if (!root) return;
    const list = requestsInPeriod();
    const c = countRows(list);
    const statusRows = [["Abertas", c.open], ["Em andamento", c.progress], ["Concluídas", c.done], ["Atrasadas", c.late]];
    root.innerHTML = `
      <div class="smc-dashboard-head">
        <div><h3>Dashboard</h3><span>Indicadores das solicitações da Engenharia de Processo.</span></div>
        <select id="smcDashPeriod">
          <option value="diario">Diário</option>
          <option value="mensal">Mensal</option>
          <option value="anual">Anual</option>
        </select>
      </div>
      <div class="smc-dash-cards">
        <div><strong>${c.total}</strong><span>Total de solicitações</span></div>
        <div><strong>${c.open}</strong><span>Abertas</span></div>
        <div><strong>${c.progress}</strong><span>Em andamento</span></div>
        <div><strong>${c.done}</strong><span>Concluídas</span></div>
        <div><strong>${c.late}</strong><span>Atrasadas</span></div>
        <div><strong>${fmtMinutes(c.minutes)}</strong><span>Tempo total registrado</span></div>
      </div>
      <div class="smc-dash-grid">
        ${chart("Volume por período", groupRows(list, periodKey))}
        ${chart("Status das tarefas", statusRows)}
        <section class="smc-dash-chart smc-workload"><h3>Carga por colaborador</h3>${workloadRows(list)}</section>
      </div>
    `;
    const period = document.getElementById("smcDashPeriod");
    if (period) {
      period.value = state.dashPeriod;
      period.onchange = event => { state.dashPeriod = event.target.value; renderDashboard(); };
    }
  }

  function renderFloatingNotifications(){
    let box = document.getElementById("smcFloatingNotifications");
    if (!box) {
      box = document.createElement("div");
      box.id = "smcFloatingNotifications";
      box.className = "planner-notifications";
      document.body.appendChild(box);
    }
    const hidden = hiddenNotifications();
    const list = state.requests
      .filter(r => NOTIFICATION_STATUSES.includes(r.status) && !hidden.has(String(r.id)))
      .sort((a,b) => new Date(createdAt(b) || 0) - new Date(createdAt(a) || 0))
      .slice(0, 7);
    box.innerHTML = list.map(r => `
      <article class="planner-notification ${priorityClass(r.prioridade)}">
        <strong>Nova demanda: ${esc(r.titulo || "-")}</strong>
        <span>Para: ${esc(r.responsible_user_code || "sem-responsavel")}</span>
        <span>Prioridade: ${esc(r.prioridade || "-")}</span>
        <span>Status: ${esc(r.status || "-")} - ${fmtDateTime(createdAt(r))}</span>
        <button type="button" data-smc-hide-notification="${esc(r.id)}">Visualizada</button>
      </article>
    `).join("");
    box.querySelectorAll("[data-smc-hide-notification]").forEach(btn => {
      btn.onclick = () => {
        const current = hiddenNotifications();
        current.add(String(btn.dataset.smcHideNotification));
        saveHiddenNotifications(current);
        renderFloatingNotifications();
      };
    });
  }

  function init(){
    installAuthFetchPatch();
    addResponsibleField();
    bindFormValidation();
    patchSaveFunction();
    patchLoadAndRender();
    buildPanelTabs();
    loadEngineeringContext().then(() => validateResponsible(false));
    refreshRequests(true);
    if (location.hash === "#painel") setTimeout(() => window.showScreen?.("painel"), 300);
    setTimeout(() => {
      addResponsibleField();
      bindFormValidation();
      patchSaveFunction();
      patchLoadAndRender();
      buildPanelTabs();
      window.loadSolicitacoes?.();
    }, 800);
    setInterval(() => {
      enhanceCurrentTable();
      renderDashboard();
      renderFloatingNotifications();
    }, 30000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
