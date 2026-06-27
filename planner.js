(() => {
  const PLANNER_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/planner-api";
  const STATUSES = ["Não iniciada", "Em andamento", "Atrasado", "Concluído"];
  const TASK_TYPES = ["Melhoria de processo", "Correção de processo", "Ajuste / edição", "Solicitação de alteração", "Apoio técnico", "Padronização", "Documentação", "Melhoria em sistema interno", "Firmware / arquivo técnico", "Outro assunto da Engenharia de Processo"];
  const PRIORITIES = ["Baixa", "Média", "Alta"];
  const state = { currentUser:null, users:[], tasks:[], members:[], sessions:[], observations:[], notifications:[], permissions:[], config:{ open_overload_limit:30, in_progress_attention_limit:20 }, activeTab:"form", period:"mensal", customStart:"", customEnd:"", loading:false, lastToken:"" };

  function esc(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function code(email){ return String(email || "").toLowerCase().split("@")[0] || "-"; }
  function role(){ return state.currentUser?.perfil || "publico"; }
  function isManager(){ return ["master", "admin"].includes(role()); }
  function fmtDate(v){ return v ? new Date(v).toLocaleString("pt-BR") : "-"; }
  function fmtDay(v){ return v ? new Date(v).toLocaleDateString("pt-BR") : "-"; }
  function priorityClass(v){ return String(v || "media").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function taskMinutes(t){
    const base = Number(t.total_tracked_minutes || 0);
    const active = state.sessions.find(s => s.task_id === t.id && !s.ended_at);
    if (!active) return base;
    return base + Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 60000));
  }
  function fmtMinutes(min){ const h = Math.floor(Number(min || 0) / 60); const m = Number(min || 0) % 60; return h ? `${h}h ${String(m).padStart(2,"0")}min` : `${m}min`; }
  function activeSession(t){ return state.sessions.find(s => s.task_id === t.id && !s.ended_at); }
  function taskMembers(id){ return state.members.filter(m => m.task_id === id); }
  function taskObservations(id){ return state.observations.filter(o => o.task_id === id).slice(0,3); }
  function userName(id){ const u = state.users.find(x => x.id === id); return u ? (u.user_code || code(u.email)) : "-"; }
  function permissionFor(userId, taskType){ return state.permissions.find(p => p.user_id === userId && p.task_type === taskType); }
  function userCanExecute(userId, taskType){ const p = permissionFor(userId, taskType); return Boolean(p?.can_execute); }
  function headers(){ return { "Content-Type":"application/json", ...(typeof smcAuthHeader === "function" ? smcAuthHeader() : {}) }; }

  async function api(action, method = "GET", body){
    const res = await fetch(`${PLANNER_API}?action=${encodeURIComponent(action)}`, { method, headers:headers(), body:body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Falha HTTP ${res.status}`);
    return json;
  }
  async function loadPlanner(silent = false){
    if (state.loading) return;
    const token = typeof smcSession !== "undefined" ? (smcSession?.access_token || "") : "";
    if (!token) { renderLocked("Faça login com e-mail corporativo aprovado para acessar o Planner."); return; }
    state.loading = true;
    try {
      const data = await api("bootstrap");
      state.currentUser = data.current_user;
      state.users = data.users || [];
      state.tasks = data.tasks || [];
      state.members = data.members || [];
      state.sessions = data.sessions || [];
      state.observations = data.observations || [];
      state.notifications = data.notifications || [];
      state.permissions = data.permissions || [];
      state.config = data.config || state.config;
      state.lastToken = token;
      renderPlanner();
    } catch (error) {
      if (!silent) renderLocked(error.message || "Falha ao carregar Planner.");
    } finally { state.loading = false; }
  }

  function mount(){
    const main = document.querySelector("main.wrap");
    if (!main) return;
    main.innerHTML = `<div id="plannerRoot" class="planner-app"></div>`;
    renderLocked("Validando login e permissões...");
    window.loadSolicitacoes = () => loadPlanner(true);
    setTimeout(() => loadPlanner(true), 900);
    setInterval(() => loadPlanner(true), 15000);
    setInterval(() => { if (state.currentUser) renderNotifications(); renderTimers(); }, 30000);
  }

  function renderLocked(message){
    const root = document.getElementById("plannerRoot");
    if (!root) return;
    root.innerHTML = `<section class="planner-panel planner-locked"><h3>Planner da Engenharia de Processo</h3><p>${esc(message)}</p><div class="planner-note" style="margin-top:14px">O login, solicitação de acesso e aprovação por ADM/Master continuam usando o fluxo já existente do SMC.</div></section>`;
    document.getElementById("plannerNotifications")?.remove();
  }

  function renderPlanner(){
    const root = document.getElementById("plannerRoot");
    if (!root) return;
    const userCode = state.currentUser?.user_code || code(state.currentUser?.email);
    root.innerHTML = `
      <div id="plannerNotifications" class="planner-notifications"></div>
      <section class="planner-top">
        <div><div class="planner-kicker">Planner interno • Engenharia de Processo</div><h2>Gestão de Solicitações e Tarefas</h2><p>Solicitação aberta pelo usuário vira tarefa gerenciável para a Engenharia de Processo, com responsável, prazo, status, tempo e rastreabilidade.</p></div>
        <div class="planner-user"><strong>${esc(userCode)}</strong><span>${esc(state.currentUser?.email || "")} • ${esc(role())}</span></div>
      </section>
      <nav class="planner-tabs">
        ${tabButton("form", "Abrir solicitação")}
        ${tabButton("board", "Painel de tarefas")}
        ${tabButton("dashboard", "Dashboard")}
        ${isManager() ? tabButton("permissions", "Permissões") : ""}
      </nav>
      <div id="plannerView"></div>`;
    renderNotifications();
    renderView();
  }
  function tabButton(id, label){ return `<button type="button" class="planner-tab ${state.activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`; }
  function bindTabs(){ document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => { state.activeTab = btn.dataset.tab; renderPlanner(); })); }
  function renderView(){
    bindTabs();
    if (state.activeTab === "form") return renderForm();
    if (state.activeTab === "board") return renderBoard();
    if (state.activeTab === "dashboard") return renderDashboard();
    if (state.activeTab === "permissions") return renderPermissions();
  }

  function options(list, selected = ""){ return list.map(v => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join(""); }
  function userOptions(selected = ""){ return state.users.map(u => `<option value="${esc(u.id)}" ${u.id === selected ? "selected" : ""}>${esc(u.user_code || code(u.email))} • ${esc(u.nome || "")}</option>`).join(""); }
  function renderForm(){
    const view = document.getElementById("plannerView");
    view.innerHTML = `<div class="planner-grid">
      <section class="planner-panel"><div class="planner-panel-head"><h3>Nova solicitação</h3><small>O responsável inicial é obrigatório e só pode ser colaborador autorizado da Engenharia de Processo.</small></div><div class="planner-panel-body">
        <form id="plannerTaskForm" class="planner-form">
          <div class="planner-two"><div class="planner-field"><label>Título da solicitação *</label><input id="plTitle" required placeholder="Descreva de forma objetiva"></div><div class="planner-field"><label>Data prevista de conclusão</label><input id="plDue" type="date"></div></div>
          <div class="planner-three"><div class="planner-field"><label>Prioridade</label><select id="plPriority">${options(PRIORITIES, "Média")}</select></div><div class="planner-field"><label>Categoria / tipo *</label><select id="plType" required>${options(TASK_TYPES)}</select></div><div class="planner-field"><label>Status inicial</label><select id="plStatus">${options(["Não iniciada", "Em andamento"], "Não iniciada")}</select></div></div>
          <div class="planner-field"><label>Descrição da solicitação *</label><textarea id="plDescription" required placeholder="Informe necessidade, contexto, impacto e dados suficientes para análise."></textarea></div>
          <section class="planner-note"><strong>Direcionamento</strong><br>Selecione o responsável principal e, se necessário, os membros envolvidos. A lista mostra apenas colaboradores da Engenharia de Processo.</section>
          <div class="planner-two"><div class="planner-field"><label>Responsável inicial *</label><select id="plResponsible" required><option value="">Selecione...</option>${userOptions()}</select><small id="plResponsibleHint">O sistema valida permissão de execução antes de registrar.</small></div><div class="planner-field"><label>Membros envolvidos</label><select id="plMembers" multiple>${userOptions()}</select><small>Use Ctrl para selecionar mais de um membro.</small></div></div>
          <div class="planner-actions"><button type="submit">Registrar solicitação/tarefa</button><button type="reset" class="planner-secondary">Limpar</button></div><div id="plannerFormMsg" class="planner-msg"></div>
        </form>
      </div></section>
      <aside class="planner-panel"><div class="planner-panel-head"><h3>Regras aplicadas</h3><small>Validação no frontend e na Edge Function.</small></div><div class="planner-panel-body"><div class="planner-note">Este sistema é destinado exclusivamente a solicitações relacionadas à Engenharia de Processo. Solicitações fora deste escopo devem ser direcionadas à área responsável.</div><br><div class="planner-note">ID visível do usuário: texto antes do @ do e-mail corporativo. Criado por: <strong>${esc(state.currentUser?.user_code || "-")}</strong>.</div></div></aside>
    </div>`;
    document.getElementById("plResponsible")?.addEventListener("change", validateResponsible);
    document.getElementById("plType")?.addEventListener("change", validateResponsible);
    document.getElementById("plannerTaskForm")?.addEventListener("submit", submitTask);
  }
  function selectedMembers(){ return Array.from(document.getElementById("plMembers")?.selectedOptions || []).map(o => o.value); }
  function validateResponsible(){
    const responsible = document.getElementById("plResponsible")?.value;
    const type = document.getElementById("plType")?.value;
    const hint = document.getElementById("plResponsibleHint");
    if (!hint || !responsible || !type) return true;
    if (!userCanExecute(responsible, type)) { hint.textContent = "Este colaborador não possui permissão para executar este tipo de tarefa."; hint.style.color = "#ffd0d0"; return false; }
    hint.textContent = "Responsável autorizado para este tipo de tarefa."; hint.style.color = "#b7ffd0"; return true;
  }
  async function submitTask(event){
    event.preventDefault();
    const msg = document.getElementById("plannerFormMsg");
    msg.className = "planner-msg";
    const responsible = document.getElementById("plResponsible").value;
    const type = document.getElementById("plType").value;
    if (!responsible) { msg.textContent = "Toda solicitação precisa ter responsável inicial."; msg.classList.add("err"); return; }
    if (!validateResponsible()) { msg.textContent = "Este colaborador não possui permissão para executar este tipo de tarefa."; msg.classList.add("err"); return; }
    const body = { title:document.getElementById("plTitle").value.trim(), description:document.getElementById("plDescription").value.trim(), priority:document.getElementById("plPriority").value, task_type:type, status:document.getElementById("plStatus").value, responsible_id:responsible, member_ids:selectedMembers(), due_date:document.getElementById("plDue").value || null };
    try { msg.textContent = "Registrando..."; await api("task", "POST", body); msg.textContent = "Solicitação registrada e tarefa criada no Planner."; msg.classList.add("ok"); event.target.reset(); await loadPlanner(true); state.activeTab = "board"; renderPlanner(); }
    catch(error){ msg.textContent = error.message; msg.classList.add("err"); }
  }

  function renderBoard(){
    const view = document.getElementById("plannerView");
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, state.tasks.filter(t => normalizeStatus(t) === s)]));
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Painel de tarefas</h3><small>Solicitações abertas convertidas em tarefas para acompanhamento operacional.</small></div><div class="planner-panel-body"><div class="planner-board">${STATUSES.map(s => `<div class="planner-col"><h4>${esc(s)} (${byStatus[s].length})</h4>${byStatus[s].map(taskCard).join("") || '<div class="planner-empty">Sem tarefas</div>'}</div>`).join("")}</div></div></section>`;
    bindTaskActions();
  }
  function normalizeStatus(t){ if (t.status === "Pausado") return "Não iniciada"; return STATUSES.includes(t.status) ? t.status : "Não iniciada"; }
  function taskCard(t){
    const active = activeSession(t);
    const obs = taskObservations(t.id).map(o => `<span class="mini">${esc(o.user_code)}: ${esc(o.observation)}</span>`).join("");
    const canEdit = isManager() || t.responsible_id === state.currentUser?.id;
    return `<article class="task-card ${active ? "timer-active" : ""}"><h5>${esc(t.title)}</h5><p>${esc(t.description).slice(0,180)}</p><div class="task-meta"><span class="planner-tag tag-${priorityClass(t.priority)}">${esc(t.priority)}</span><span class="planner-tag tag-time">${fmtMinutes(taskMinutes(t))}</span>${active ? '<span class="planner-tag tag-baixa">Cronômetro ativo</span>' : ""}</div><p><strong>Resp.:</strong> ${esc(t.responsible_user_code || userName(t.responsible_id))}<br><strong>Criado por:</strong> ${esc(t.created_by_user_code || "-")}<br><strong>Prazo:</strong> ${fmtDay(t.due_date)}</p>${obs}<div class="task-actions"><select data-status-task="${esc(t.id)}" ${canEdit ? "" : "disabled"}>${options(STATUSES, normalizeStatus(t))}</select>${isManager() ? `<select data-resp-task="${esc(t.id)}">${userOptions(t.responsible_id)}</select>` : ""}<textarea data-obs-task="${esc(t.id)}" placeholder="Adicionar observação"></textarea><button type="button" data-add-obs="${esc(t.id)}">Adicionar observação</button></div></article>`;
  }
  function bindTaskActions(){
    document.querySelectorAll("[data-status-task]").forEach(el => el.addEventListener("change", async () => updateStatus(el.dataset.statusTask, el.value)));
    document.querySelectorAll("[data-resp-task]").forEach(el => el.addEventListener("change", async () => updateResponsible(el.dataset.respTask, el.value)));
    document.querySelectorAll("[data-add-obs]").forEach(btn => btn.addEventListener("click", async () => addObservation(btn.dataset.addObs)));
  }
  async function updateStatus(id, status){
    const task = state.tasks.find(t => t.id === id);
    let pause_reason = null;
    if (task?.status === "Em andamento" && status !== "Em andamento" && status !== "Concluído") {
      pause_reason = prompt("Informe o motivo da pausa:");
      if (!pause_reason) { renderBoard(); return; }
    }
    try { await api("task", "PATCH", { id, status, pause_reason }); await loadPlanner(true); }
    catch(error){ alert(error.message); await loadPlanner(true); }
  }
  async function updateResponsible(id, responsible_id){
    const task = state.tasks.find(t => t.id === id);
    if (task && !userCanExecute(responsible_id, task.task_type)) { alert("Este colaborador não possui permissão para executar este tipo de tarefa."); renderBoard(); return; }
    try { await api("task", "PATCH", { id, responsible_id }); await loadPlanner(true); }
    catch(error){ alert(error.message); await loadPlanner(true); }
  }
  async function addObservation(id){
    const el = document.querySelector(`[data-obs-task="${CSS.escape(id)}"]`);
    const observation = el?.value.trim();
    if (!observation) return alert("Digite a observação.");
    try { await api("observation", "POST", { task_id:id, observation }); await loadPlanner(true); }
    catch(error){ alert(error.message); }
  }

  function periodTasks(){
    const now = new Date();
    let start, end = new Date(now);
    if (state.period === "diario") { start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
    else if (state.period === "anual") { start = new Date(now.getFullYear(), 0, 1); }
    else if (state.period === "custom") { start = state.customStart ? new Date(state.customStart + "T00:00:00") : new Date(0); end = state.customEnd ? new Date(state.customEnd + "T23:59:59") : end; }
    else { start = new Date(now.getFullYear(), now.getMonth(), 1); }
    return state.tasks.filter(t => { const d = new Date(t.created_at); return d >= start && d <= end; });
  }
  function renderDashboard(){
    const view = document.getElementById("plannerView");
    const list = periodTasks();
    const counts = Object.fromEntries(STATUSES.map(s => [s, list.filter(t => normalizeStatus(t) === s).length]));
    const total = list.length || 1;
    const p1 = counts["Não iniciada"] / total * 100;
    const p2 = p1 + counts["Em andamento"] / total * 100;
    const p3 = p2 + counts["Atrasado"] / total * 100;
    const totalMinutes = list.reduce((sum, t) => sum + taskMinutes(t), 0);
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Dashboard</h3><small>Indicadores temporais, status, horas acumuladas e carga por colaborador.</small></div><div class="planner-panel-body"><div class="planner-filters"><select id="dashPeriod"><option value="diario">Diário</option><option value="mensal">Mensal</option><option value="anual">Anual</option><option value="custom">Período personalizado</option></select><input id="dashStart" type="date" value="${esc(state.customStart)}"><input id="dashEnd" type="date" value="${esc(state.customEnd)}"><button id="dashApply">Aplicar</button></div><div class="planner-stats"><div class="planner-stat"><strong>${list.length}</strong><span>Criadas</span></div><div class="planner-stat"><strong>${counts["Concluído"]}</strong><span>Concluídas</span></div><div class="planner-stat"><strong>${counts["Em andamento"]}</strong><span>Em andamento</span></div><div class="planner-stat"><strong>${counts["Atrasado"]}</strong><span>Atrasadas</span></div><div class="planner-stat"><strong>${counts["Não iniciada"]}</strong><span>Não iniciadas</span></div><div class="planner-stat"><strong>${fmtMinutes(totalMinutes)}</strong><span>Tempo total</span></div></div><br><div class="planner-dashboard"><div><div class="planner-donut" style="--p-nao:${p1}%;--p-and:${p2}%;--p-atraso:${p3}%"><div class="planner-donut-center"><div><strong>${list.length}</strong><span>Total</span></div></div></div><div class="planner-legend">${STATUSES.map(s => `<div><span><i class="planner-dot ${dotClass(s)}"></i>${esc(s)}</span><strong>${counts[s]}</strong></div>`).join("")}</div></div><div><h3>Quem está fazendo o quê</h3><div class="planner-workload">${workloadRows(list)}</div></div></div></div></section>`;
    document.getElementById("dashPeriod").value = state.period;
    document.getElementById("dashApply").addEventListener("click", () => { state.period = document.getElementById("dashPeriod").value; state.customStart = document.getElementById("dashStart").value; state.customEnd = document.getElementById("dashEnd").value; renderDashboard(); });
  }
  function dotClass(s){ return s === "Não iniciada" ? "dot-nao" : s === "Em andamento" ? "dot-and" : s === "Atrasado" ? "dot-atraso" : "dot-ok"; }
  function workloadRows(list){
    return state.users.map(u => {
      const tasks = list.filter(t => t.responsible_id === u.id);
      const c = Object.fromEntries(STATUSES.map(s => [s, tasks.filter(t => normalizeStatus(t) === s).length]));
      const open = c["Não iniciada"] + c["Em andamento"] + c["Atrasado"];
      const total = Math.max(tasks.length, 1);
      const min = tasks.reduce((sum,t) => sum + taskMinutes(t), 0);
      const alert = open >= state.config.open_overload_limit ? '<span class="work-alert">Alerta: colaborador com 30 ou mais tarefas em aberto.</span>' : "";
      const att = c["Em andamento"] >= state.config.in_progress_attention_limit ? '<span class="work-att">Atenção: colaborador com alto volume de tarefas em andamento.</span>' : "";
      return `<div class="work-row"><div class="work-name"><strong>${esc(u.user_code || code(u.email))}</strong><span>${tasks.length} tarefas • ${fmtMinutes(min)}</span>${alert}${att}</div><div class="work-bar"><i class="work-nao" style="width:${c["Não iniciada"] / total * 100}%"></i><i class="work-and" style="width:${c["Em andamento"] / total * 100}%"></i><i class="work-atraso" style="width:${c["Atrasado"] / total * 100}%"></i><i class="work-ok" style="width:${c["Concluído"] / total * 100}%"></i></div><div><span class="mini">Abertas: ${open}</span><span class="mini">Concluídas: ${c["Concluído"]}</span></div></div>`;
    }).join("") || '<div class="planner-empty">Sem colaboradores autorizados.</div>';
  }

  function renderPermissions(){
    if (!isManager()) { state.activeTab = "board"; renderPlanner(); return; }
    const view = document.getElementById("plannerView");
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Permissões de execução</h3><small>ADM e Master definem quais colaboradores podem executar cada tipo de tarefa. ADM não altera permissões críticas do Master.</small></div><div class="planner-panel-body planner-permissions"><table><thead><tr><th>Usuário</th><th>Tipo</th><th>Criar</th><th>Executar</th><th>Editar</th><th>Concluir</th><th>Alterar resp.</th><th>Membros</th><th>Ação</th></tr></thead><tbody>${state.users.flatMap(u => TASK_TYPES.map(t => permRow(u,t))).join("")}</tbody></table></div></section>`;
    document.querySelectorAll("[data-save-perm]").forEach(btn => btn.addEventListener("click", () => savePermission(btn.dataset.savePerm, btn.dataset.taskType)));
  }
  function permRow(u, type){
    const p = permissionFor(u.id, type) || {};
    const key = `${u.id}|${type}`;
    const masterLocked = role() !== "master" && (u.perfil === "master" || u.role === "master");
    return `<tr><td>${esc(u.user_code || code(u.email))}<span class="mini">${esc(u.perfil || u.role || "usuario")}</span></td><td>${esc(type)}</td>${["can_create","can_execute","can_edit","can_complete","can_change_responsible","can_add_members"].map(f => `<td><input type="checkbox" data-perm="${esc(key)}" data-field="${f}" ${p[f] ? "checked" : ""} ${masterLocked ? "disabled" : ""}></td>`).join("")}<td><button type="button" data-save-perm="${esc(u.id)}" data-task-type="${esc(type)}" ${masterLocked ? "disabled" : ""}>Salvar</button></td></tr>`;
  }
  async function savePermission(userId, type){
    const body = { user_id:userId, task_type:type };
    document.querySelectorAll(`[data-perm="${CSS.escape(userId + "|" + type)}"]`).forEach(cb => body[cb.dataset.field] = cb.checked);
    try { await api("permission", "PATCH", body); await loadPlanner(true); alert("Permissão atualizada."); }
    catch(error){ alert(error.message); }
  }

  function renderNotifications(){
    const box = document.getElementById("plannerNotifications");
    if (!box || !state.currentUser) return;
    const visible = state.notifications.filter(n => n.recipient_user_id === state.currentUser.id && !n.viewed && !n.removed_at).slice(0,7);
    box.innerHTML = visible.map(n => `<div class="planner-notification ${priorityClass(n.priority)}"><strong>${esc(n.message)}</strong><span>${esc(n.priority)} • ${fmtDate(n.created_at)}</span><button type="button" data-view-notification="${esc(n.id)}">Marcar vista</button></div>`).join("");
    document.querySelectorAll("[data-view-notification]").forEach(btn => btn.addEventListener("click", async () => { try { await api("notification", "PATCH", { id:btn.dataset.viewNotification }); await loadPlanner(true); } catch(error){ alert(error.message); } }));
  }
  function renderTimers(){ document.querySelectorAll(".tag-time").forEach(() => {}); if (state.activeTab === "board") renderBoard(); if (state.activeTab === "dashboard") renderDashboard(); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
