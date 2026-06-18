// Planner view without duplicated request-opening form.
(function(){
  const PLANNER_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/planner-api";
  const STATUSES = ["Não iniciada", "Em andamento", "Atrasado", "Concluído"];
  const PRIORITIES = ["Baixa", "Média", "Alta"];
  const TASK_TYPES = ["Melhoria de processo", "Correção de processo", "Ajuste / edição", "Solicitação de alteração", "Apoio técnico", "Padronização", "Documentação", "Melhoria em sistema interno", "Firmware / arquivo técnico", "Outro assunto da Engenharia de Processo"];
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embedded") === "1";
  const state = { tab:params.get("tab") || "board", users:[], tasks:[], members:[], sessions:[], observations:[], notifications:[], permissions:[], currentUser:null, query:"", status:"", priority:"", responsible:"", creator:"", type:"", onlyLate:false, mine:false, noResponsible:false };
  function esc(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function code(email){ return String(email || "").toLowerCase().split("@")[0] || "-"; }
  function role(){ return state.currentUser?.perfil || "publico"; }
  function isManager(){ return ["master", "admin"].includes(role()); }
  function headers(){ return { "Content-Type":"application/json", ...(typeof smcAuthHeader === "function" ? smcAuthHeader() : {}) }; }
  function fmtDate(v){ return v ? new Date(v).toLocaleDateString("pt-BR") : "-"; }
  function fmtMinutes(min){ const n=Number(min||0), h=Math.floor(n/60), m=n%60; return h ? `${h}h ${String(m).padStart(2,"0")}min` : `${m}min`; }
  function taskMinutes(t){
    const base = Number(t.total_tracked_minutes || 0);
    const active = state.sessions.find(s => s.task_id === t.id && !s.ended_at);
    if (!active) return base;
    return base + Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 60000));
  }
  function userLabel(id){ const u = state.users.find(x => x.id === id); return u ? (u.user_code || code(u.email)) : "Sem responsável"; }
  async function api(action, method="GET", body){
    const res = await fetch(`${PLANNER_API}?action=${encodeURIComponent(action)}`, { method, headers:headers(), body:body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Falha HTTP ${res.status}`);
    return json;
  }
  async function load(){
    const token = typeof smcSession !== "undefined" ? (smcSession?.access_token || "") : "";
    if (!token) return renderLocked("Faça login com e-mail corporativo aprovado para acessar o Planner.");
    try {
      const data = await api("bootstrap");
      Object.assign(state, { currentUser:data.current_user, users:data.users||[], tasks:data.tasks||[], members:data.members||[], sessions:data.sessions||[], observations:data.observations||[], notifications:data.notifications||[], permissions:data.permissions||[] });
      render();
    } catch(error) { renderLocked(error.message || "Falha ao carregar Planner."); }
  }
  function mount(){
    if (embedded) document.body.classList.add("planner-embedded");
    const main = document.querySelector("main.wrap");
    if (!main) return;
    main.innerHTML = `<div id="plannerRoot" class="planner-app"></div>`;
    renderLocked("Validando login e permissões...");
    setTimeout(load, 700);
    setInterval(load, 20000);
  }
  function renderLocked(message){
    const root = document.getElementById("plannerRoot");
    if (!root) return;
    root.innerHTML = `<section class="planner-panel planner-locked"><h3>Planner da Engenharia de Processo</h3><p>${esc(message)}</p><div class="planner-actions" style="justify-content:center;margin-top:14px"><button type="button" onclick="location.href='index.html'">Voltar ao menu</button></div></section>`;
  }
  function nav(){
    if (embedded) return "";
    return `<nav class="planner-tabs">${tabBtn("board","Tarefas / Planner")}${tabBtn("dashboard","Dashboard")}${isManager()?tabBtn("permissions","Permissões"):""}${isManager()?tabBtn("backup","Backup / Sincronização"):""}</nav>`;
  }
  function tabBtn(id,label){ return `<button type="button" class="planner-tab ${state.tab===id?"active":""}" data-tab="${id}">${label}</button>`; }
  function render(){
    const root = document.getElementById("plannerRoot");
    if (!root) return;
    root.innerHTML = `${embedded?"":`<section class="planner-top"><div><div class="planner-kicker">Menu principal / Painel de solicitações / ${state.tab === "dashboard" ? "Dashboard" : "Planner de tarefas"}</div><h2>${state.tab === "dashboard" ? "Dashboard" : "Tarefas / Planner"}</h2><p>O formulário principal “Abrir solicitação” é a única entrada de novas solicitações. Aqui ficam execução, acompanhamento, indicadores e permissões.</p></div><div class="planner-user"><strong>${esc(state.currentUser?.user_code || code(state.currentUser?.email))}</strong><span>${esc(state.currentUser?.email || "")} • ${esc(role())}</span></div></section>`}${nav()}<div class="planner-actions planner-return-actions"><button type="button" onclick="location.href='index.html'">Voltar ao menu</button><button type="button" onclick="location.href='index.html#painel'">Voltar ao painel de solicitações</button><button type="button" id="plannerRefresh">Atualizar</button></div><div id="plannerView"></div>`;
    document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); });
    document.getElementById("plannerRefresh").onclick = load;
    if (state.tab === "dashboard") renderDashboard();
    else if (state.tab === "permissions") renderPermissions();
    else if (state.tab === "backup") renderBackup();
    else renderBoard();
  }
  function taskStatus(t){ return STATUSES.includes(t.status) ? t.status : "Não iniciada"; }
  function activeSession(t){ return state.sessions.find(s => s.task_id === t.id && !s.ended_at); }
  function filteredTasks(){
    const q = state.query.toLowerCase();
    const now = new Date();
    return state.tasks.filter(t => {
      const text = [t.title,t.description,t.task_type,t.priority,t.status,t.responsible_user_code,t.created_by_user_code].join(" ").toLowerCase();
      const due = t.due_date ? new Date(t.due_date) : null;
      return (!q || text.includes(q)) && (!state.status || taskStatus(t)===state.status) && (!state.priority || t.priority===state.priority) && (!state.responsible || t.responsible_id===state.responsible) && (!state.creator || t.created_by===state.creator || t.created_by_user_code===state.creator) && (!state.type || t.task_type===state.type) && (!state.onlyLate || taskStatus(t)==="Atrasado" || (due && due < now && taskStatus(t)!=="Concluído")) && (!state.mine || t.responsible_id===state.currentUser?.id) && (!state.noResponsible || !t.responsible_id);
    });
  }
  function selectOptions(list, selected){ return `<option value="">Todos</option>` + list.map(v => `<option value="${esc(v)}" ${v===selected?"selected":""}>${esc(v)}</option>`).join(""); }
  function userOptions(selected){ return `<option value="">Todos</option>` + state.users.map(u => `<option value="${esc(u.id)}" ${u.id===selected?"selected":""}>${esc(u.user_code || code(u.email))}</option>`).join(""); }
  function renderBoard(){
    const view = document.getElementById("plannerView");
    const list = filteredTasks();
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Painel de tarefas</h3><small>Gestão operacional das solicitações como tarefas. Sem formulário duplicado de abertura.</small></div><div class="planner-panel-body"><div class="planner-task-filters"><input id="tfQuery" placeholder="Buscar por texto..." value="${esc(state.query)}"><select id="tfStatus">${selectOptions(STATUSES,state.status)}</select><select id="tfPriority">${selectOptions(PRIORITIES,state.priority)}</select><select id="tfResponsible">${userOptions(state.responsible)}</select><select id="tfType">${selectOptions(TASK_TYPES,state.type)}</select><label class="planner-check"><input id="tfMine" type="checkbox" ${state.mine?"checked":""}> Minhas tarefas</label><label class="planner-check"><input id="tfLate" type="checkbox" ${state.onlyLate?"checked":""}> Atrasadas</label><label class="planner-check"><input id="tfNoResp" type="checkbox" ${state.noResponsible?"checked":""}> Sem responsável</label><button id="tfClear" type="button">Limpar filtros</button><button id="tfRefresh" type="button">Atualizar tarefas</button></div><div class="planner-board">${STATUSES.map(s => `<div class="planner-col"><h4>${esc(s)} (${list.filter(t=>taskStatus(t)===s).length})</h4>${list.filter(t=>taskStatus(t)===s).map(taskCard).join("") || '<div class="planner-empty">Sem tarefas</div>'}</div>`).join("")}</div></div></section>`;
    bindFilters(); bindTaskActions();
  }
  function taskCard(t){
    const obs = state.observations.filter(o => o.task_id === t.id).slice(0,2).map(o => `<span class="mini">${esc(o.user_code)}: ${esc(o.observation)}</span>`).join("");
    const timer = activeSession(t);
    const canChange = isManager() || t.responsible_id === state.currentUser?.id;
    return `<article class="task-card ${timer?"timer-active":""}"><div class="task-card-main"><h5>${esc(t.title)}</h5><p>${esc(t.description || "").slice(0,180)}</p></div><div class="task-meta"><span class="planner-tag tag-${priorityClass(t.priority)}">${esc(t.priority)}</span><span class="planner-tag tag-time">${fmtMinutes(taskMinutes(t))}</span>${timer?'<span class="planner-tag tag-baixa">Cronômetro ativo</span>':""}</div><div class="task-info-grid"><span><strong>Status</strong>${esc(taskStatus(t))}</span><span><strong>Resp.</strong>${esc(t.responsible_user_code || userLabel(t.responsible_id))}</span><span><strong>Prazo</strong>${fmtDate(t.due_date)}</span><span><strong>Criado por</strong>${esc(t.created_by_user_code || "-")}</span></div>${obs}<div class="task-actions"><select data-status-task="${esc(t.id)}" ${canChange?"":"disabled"}>${STATUSES.map(s=>`<option ${taskStatus(t)===s?"selected":""}>${esc(s)}</option>`).join("")}</select><textarea data-obs-task="${esc(t.id)}" placeholder="Observação"></textarea><button type="button" data-add-obs="${esc(t.id)}">Adicionar observação</button></div></article>`;
  }
  function priorityClass(v){ return String(v || "media").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function bindFilters(){
    const map = { tfQuery:"query", tfStatus:"status", tfPriority:"priority", tfResponsible:"responsible", tfType:"type" };
    Object.entries(map).forEach(([id,key]) => document.getElementById(id).oninput = e => { state[key] = e.target.value; renderBoard(); });
    document.getElementById("tfMine").onchange = e => { state.mine = e.target.checked; renderBoard(); };
    document.getElementById("tfLate").onchange = e => { state.onlyLate = e.target.checked; renderBoard(); };
    document.getElementById("tfNoResp").onchange = e => { state.noResponsible = e.target.checked; renderBoard(); };
    document.getElementById("tfClear").onclick = () => { Object.assign(state,{query:"",status:"",priority:"",responsible:"",creator:"",type:"",onlyLate:false,mine:false,noResponsible:false}); renderBoard(); };
    document.getElementById("tfRefresh").onclick = load;
  }
  function bindTaskActions(){
    document.querySelectorAll("[data-status-task]").forEach(el => el.onchange = () => updateStatus(el.dataset.statusTask, el.value));
    document.querySelectorAll("[data-add-obs]").forEach(btn => btn.onclick = () => addObservation(btn.dataset.addObs));
  }
  async function updateStatus(id,status){
    let pause_reason = null;
    const task = state.tasks.find(t => t.id === id);
    if (task?.status === "Em andamento" && status !== "Em andamento" && status !== "Concluído") {
      pause_reason = prompt("Informe o motivo da pausa:");
      if (!pause_reason) return renderBoard();
    }
    if (window.SmcSaves) window.SmcSaves.updateLocal("plannerTasks", id, { status, pause_reason }, { action:"taskStatus" });
    try { await api("task", "PATCH", { id, status, pause_reason }); await load(); }
    catch(error){ if (window.SmcSaves) window.SmcSaves.markError("plannerTasks", id, error); alert("Salvo localmente, aguardando sincronização com Supabase. " + error.message); }
  }
  async function addObservation(id){
    const el = document.querySelector(`[data-obs-task="${CSS.escape(id)}"]`);
    const observation = el?.value.trim();
    if (!observation) return alert("Digite a observação.");
    const local = window.SmcSaves?.saveLocal("taskObservations", { task_id:id, observation }, { action:"taskObservation" });
    try { const result = await api("observation", "POST", { task_id:id, observation }); if (local) window.SmcSaves.markSynced("taskObservations", local.local_id, result.data); await load(); }
    catch(error){ if (local) window.SmcSaves.markError("taskObservations", local.local_id, error); alert("Observação salva localmente, aguardando sincronização."); }
  }
  function counts(list){ return Object.fromEntries(STATUSES.map(s => [s, list.filter(t => taskStatus(t)===s).length])); }
  function renderDashboard(){
    const view = document.getElementById("plannerView");
    const list = state.tasks;
    const c = counts(list);
    const totalMinutes = list.reduce((s,t)=>s+taskMinutes(t),0);
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Dashboard</h3><small>Somente indicadores e gráficos, sem abertura ou edição principal.</small></div><div class="planner-panel-body"><div class="planner-stats"><div class="planner-stat"><strong>${list.length}</strong><span>Total tarefas</span></div><div class="planner-stat"><strong>${c["Não iniciada"]}</strong><span>Em aberto</span></div><div class="planner-stat"><strong>${c["Em andamento"]}</strong><span>Em andamento</span></div><div class="planner-stat"><strong>${c["Atrasado"]}</strong><span>Atrasadas</span></div><div class="planner-stat"><strong>${c["Concluído"]}</strong><span>Concluídas</span></div><div class="planner-stat"><strong>${fmtMinutes(totalMinutes)}</strong><span>Tempo total</span></div></div><div class="planner-chart-grid"><div>${barChart("Solicitações por status", Object.entries(c))}</div><div>${barChart("Tarefas por responsável", group(list, t=>t.responsible_user_code || userLabel(t.responsible_id)))}</div><div>${barChart("Tarefas por prioridade", group(list, t=>t.priority || "Sem prioridade"))}</div><div>${barChart("Tarefas por tipo", group(list, t=>t.task_type || "Sem tipo"))}</div></div><h3>Carga por colaborador</h3><div class="planner-workload">${workloadRows(list)}</div></div></section>`;
  }
  function group(list, fn){ const map = new Map(); list.forEach(item => { const k = fn(item); map.set(k, (map.get(k)||0)+1); }); return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10); }
  function barChart(title, rows){ const max = Math.max(1,...rows.map(r=>r[1])); return `<div class="planner-mini-chart"><h4>${esc(title)}</h4>${rows.map(([k,v])=>`<div class="mini-bar"><span>${esc(k)}</span><i style="width:${v/max*100}%"></i><strong>${v}</strong></div>`).join("") || '<div class="planner-empty">Sem dados</div>'}</div>`; }
  function workloadRows(list){ return state.users.map(u => { const ts=list.filter(t=>t.responsible_id===u.id); const open=ts.filter(t=>taskStatus(t)!=="Concluído").length; return `<div class="work-row"><div class="work-name"><strong>${esc(u.user_code || code(u.email))}</strong><span>${ts.length} tarefas • ${fmtMinutes(ts.reduce((s,t)=>s+taskMinutes(t),0))}</span>${open>=30?'<span class="work-alert">Alerta: colaborador com 30 ou mais tarefas em aberto.</span>':""}${ts.filter(t=>taskStatus(t)==="Em andamento").length>=20?'<span class="work-att">Atenção: alto volume em andamento.</span>':""}</div><div class="work-bar"><i class="work-nao" style="width:${ts.filter(t=>taskStatus(t)==="Não iniciada").length/Math.max(ts.length,1)*100}%"></i><i class="work-and" style="width:${ts.filter(t=>taskStatus(t)==="Em andamento").length/Math.max(ts.length,1)*100}%"></i><i class="work-atraso" style="width:${ts.filter(t=>taskStatus(t)==="Atrasado").length/Math.max(ts.length,1)*100}%"></i><i class="work-ok" style="width:${ts.filter(t=>taskStatus(t)==="Concluído").length/Math.max(ts.length,1)*100}%"></i></div><div><span class="mini">Abertas: ${open}</span><span class="mini">Concluídas: ${ts.filter(t=>taskStatus(t)==="Concluído").length}</span></div></div>`; }).join("") || '<div class="planner-empty">Sem colaboradores</div>'; }
  function renderPermissions(){
    const view = document.getElementById("plannerView");
    if (!isManager()) { view.innerHTML = '<section class="planner-panel planner-locked"><h3>Acesso restrito</h3><p>Apenas ADM/Master visualizam permissões.</p></section>'; return; }
    const userId = state.permUser || state.users[0]?.id || "";
    const type = state.permType || TASK_TYPES[0];
    const user = state.users.find(u=>u.id===userId);
    const p = state.permissions.find(x => x.user_id===userId && x.task_type===type) || {};
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Permissões</h3><small>Organizado por usuário e tipo de tarefa.</small></div><div class="planner-panel-body"><div class="planner-two"><div class="planner-field"><label>Usuário</label><select id="permUser">${state.users.map(u=>`<option value="${esc(u.id)}" ${u.id===userId?"selected":""}>${esc(u.user_code || code(u.email))}</option>`).join("")}</select></div><div class="planner-field"><label>Tipo</label><select id="permType">${TASK_TYPES.map(t=>`<option ${t===type?"selected":""}>${esc(t)}</option>`).join("")}</select></div></div><div class="permission-card"><h4>${esc(user?.user_code || "-")} • ${esc(type)}</h4>${permCheck("can_create","Criar",p)}${permCheck("can_execute","Executar",p)}${permCheck("can_edit","Editar",p)}${permCheck("can_complete","Concluir",p)}${permCheck("can_change_responsible","Alterar responsável",p)}${permCheck("can_add_members","Adicionar membros",p)}<button id="savePerm" type="button">Salvar permissões</button></div></div></section>`;
    document.getElementById("permUser").onchange = e => { state.permUser=e.target.value; renderPermissions(); };
    document.getElementById("permType").onchange = e => { state.permType=e.target.value; renderPermissions(); };
    document.getElementById("savePerm").onclick = async () => { const body={user_id:userId,task_type:type}; document.querySelectorAll('[data-perm-field]').forEach(cb => body[cb.dataset.permField]=cb.checked); const local=window.SmcSaves?.saveLocal("taskPermissions", body, {action:"permission"}); try { const r=await api("permission","PATCH",body); if(local) window.SmcSaves.markSynced("taskPermissions", local.local_id, r.data); await load(); alert("Permissões salvas."); } catch(error){ if(local) window.SmcSaves.markError("taskPermissions", local.local_id, error); alert(error.message); } };
  }
  function permCheck(field,label,p){ return `<label class="permission-switch"><input type="checkbox" data-perm-field="${field}" ${p[field]?"checked":""}> <span>${label}</span></label>`; }
  function renderBackup(){
    const view = document.getElementById("plannerView");
    const s = window.SmcSaves?.statusSummary?.() || {pending:0,errors:0,lastSyncedAt:""};
    view.innerHTML = `<section class="planner-panel"><div class="planner-panel-head"><h3>Backup / Sincronização</h3><small>SAVES.json lógico em localStorage com exportação/importação.</small></div><div class="planner-panel-body"><div class="planner-stats"><div class="planner-stat"><strong>${s.pending}</strong><span>Pendentes</span></div><div class="planner-stat"><strong>${s.errors}</strong><span>Erros</span></div><div class="planner-stat"><strong>${esc(s.lastSyncedAt || "-")}</strong><span>Última sync</span></div></div><div class="planner-actions"><button id="exportSaves">Exportar SAVES.json</button><label class="planner-import"><input id="importSaves" type="file" accept="application/json"> Importar SAVES.json</label><button id="syncNow">Sincronizar agora</button></div><div class="planner-note">Não são salvos senha, JWT, refresh token, service_role ou token do GitHub.</div></div></section>`;
    document.getElementById("exportSaves").onclick = () => window.SmcSaves?.exportSavesJson();
    document.getElementById("importSaves").onchange = async e => { if(e.target.files[0]) { await window.SmcSaves.importSavesJson(e.target.files[0]); alert("SAVES.json importado com merge por local_id."); renderBackup(); } };
    document.getElementById("syncNow").onclick = () => alert("Sincronização automática do painel principal executa ao salvar. Pendências permanecem no SAVES.json para nova tentativa.");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
