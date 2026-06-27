// Planner view without duplicated request-opening form.
(function(){
  const PLANNER_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/planner-api";
  const STATUSES = ["Não iniciada", "Em andamento", "Atrasado", "Concluído"];
  const PRIORITIES = ["Baixa", "Média", "Alta"];
  const TASK_TYPES = [
    "Melhoria de processo",
    "Correção de processo",
    "Ajuste / edição",
    "Solicitação de alteração",
    "Apoio técnico",
    "Padronização",
    "Documentação",
    "Melhoria em sistema interno",
    "Firmware / arquivo técnico",
    "Outro assunto da Engenharia de Processo"
  ];
  const DEFAULT_CONFIG = { open_overload_limit:30, in_progress_attention_limit:20, notification_limit:7 };
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embedded") === "1";
  const state = {
    tab: params.get("tab") || "board",
    users: [], tasks: [], members: [], sessions: [], observations: [], notifications: [], permissions: [],
    currentUser: null,
    query: "", status: "", priority: "", responsible: "", creator: "", type: "", onlyLate: false, mine: false, noResponsible: false,
    period: "mensal", customStart: "", customEnd: "",
    permUser: "", permType: "",
    config: DEFAULT_CONFIG,
    loading: false
  };

  function esc(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function code(email){ return String(email || "").toLowerCase().trim().split("@")[0] || "-"; }
  function semAcento(v){ return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function role(){ return state.currentUser?.perfil || state.currentUser?.role || "publico"; }
  function isManager(){ return ["master", "admin", "adm"].includes(role()); }
  function headers(){ return { "Content-Type":"application/json", ...(typeof smcAuthHeader === "function" ? smcAuthHeader() : {}) }; }
  function fmtDate(v){ return v ? new Date(v).toLocaleDateString("pt-BR") : "-"; }
  function fmtDateTime(v){ return v ? new Date(v).toLocaleString("pt-BR") : "-"; }
  function fmtMinutes(min){ const n=Number(min||0), h=Math.floor(n/60), m=n%60; return h ? `${h}h ${String(m).padStart(2,"0")}min` : `${m}min`; }
  function priorityClass(v){ return semAcento(v || "media").toLowerCase(); }
  function taskStatus(t){ if(t?.status === "Pausado") return "Não iniciada"; return STATUSES.includes(t?.status) ? t.status : "Não iniciada"; }
  function activeSession(t){ return state.sessions.find(s => s.task_id === t.id && !s.ended_at); }
  function taskMinutes(t){ const base=Number(t.total_tracked_minutes||0); const active=activeSession(t); return active ? base + Math.max(0,Math.floor((Date.now()-new Date(active.started_at).getTime())/60000)) : base; }
  function userLabel(id){ const u=state.users.find(x=>x.id===id); return u ? (u.user_code || code(u.email)) : "Sem responsável"; }
  function userEmail(id){ const u=state.users.find(x=>x.id===id); return u?.email || ""; }
  function permissionFor(userId, taskType){ return state.permissions.find(p => p.user_id===userId && p.task_type===taskType); }
  function currentPermission(t){ return permissionFor(state.currentUser?.id, t?.task_type); }
  function userCanExecute(userId, taskType){ const p=permissionFor(userId, taskType); return Boolean(p?.can_execute); }
  function canChangeStatus(t, nextStatus){ if(isManager() || t.responsible_id===state.currentUser?.id) return true; const p=currentPermission(t); if(nextStatus==="Concluído") return Boolean(p?.can_complete); return Boolean(p?.can_execute || p?.can_edit); }
  function canChangeResponsible(t){ if(isManager()) return true; return Boolean(currentPermission(t)?.can_change_responsible); }
  function canAddMembers(t){ if(isManager()) return true; return Boolean(currentPermission(t)?.can_add_members); }
  function selectOptions(list,selected){ return `<option value="">Todos</option>`+list.map(v=>`<option value="${esc(v)}" ${v===selected?"selected":""}>${esc(v)}</option>`).join(""); }
  function userOptions(selected="", includeEmpty=true){ return (includeEmpty?`<option value="">Todos</option>`:"")+state.users.map(u=>`<option value="${esc(u.id)}" ${u.id===selected?"selected":""} data-email="${esc(u.email||"")}" data-code="${esc(u.user_code||code(u.email))}">${esc(u.user_code||code(u.email))}${u.nome?` • ${esc(u.nome)}`:""}</option>`).join(""); }
  function userMultiOptions(selectedIds=[]){ const set=new Set(selectedIds); return state.users.map(u=>`<option value="${esc(u.id)}" ${set.has(u.id)?"selected":""}>${esc(u.user_code||code(u.email))}${u.nome?` • ${esc(u.nome)}`:""}</option>`).join(""); }
  async function api(action, method="GET", body){ const res=await fetch(`${PLANNER_API}?action=${encodeURIComponent(action)}`,{method,headers:headers(),body:body?JSON.stringify(body):undefined}); const json=await res.json().catch(()=>({})); if(!res.ok) throw new Error(json.error||`Falha HTTP ${res.status}`); return json; }

  async function load(silent=false){
    if(state.loading) return;
    const token=typeof smcSession!=="undefined" ? (smcSession?.access_token||"") : "";
    if(!token) return renderLocked("Faça login com e-mail corporativo aprovado para acessar o Planner.");
    state.loading=true;
    try{
      const data=await api("bootstrap");
      Object.assign(state,{
        currentUser:data.current_user,
        users:data.users||[],
        tasks:data.tasks||[],
        members:data.members||[],
        sessions:data.sessions||[],
        observations:data.observations||[],
        notifications:data.notifications||[],
        permissions:data.permissions||[],
        config:Object.assign({}, DEFAULT_CONFIG, data.config||{})
      });
      render();
    } catch(error){ if(!silent) renderLocked(error.message||"Falha ao carregar Planner."); }
    finally{ state.loading=false; }
  }

  function mount(){
    if(embedded) document.body.classList.add("planner-embedded");
    const main=document.querySelector("main.wrap");
    if(!main) return;
    main.innerHTML='<div id="plannerRoot" class="planner-app"></div>';
    renderLocked("Validando login e permissões...");
    setTimeout(()=>load(false),700);
    setInterval(()=>load(true),20000);
    setInterval(()=>{ if(state.currentUser){ renderNotificationTray(); renderLiveTimers(); } },30000);
  }
  function renderLocked(message){ const root=document.getElementById("plannerRoot"); if(root) root.innerHTML=`<section class="planner-panel planner-locked"><h3>Planner da Engenharia de Processo</h3><p>${esc(message)}</p><div class="planner-actions" style="justify-content:center;margin-top:14px"><button type="button" onclick="location.href='index.html'">Voltar ao menu</button></div></section>`; document.getElementById("plannerNotifications")?.remove(); }
  function nav(){ if(embedded) return ""; return `<nav class="planner-tabs">${tabBtn("board","Tarefas / Planner")}${tabBtn("dashboard","Dashboard")}${tabBtn("notifications","Notificações")}${isManager()?tabBtn("people","Pessoas / Direcionamento"):""}${isManager()?tabBtn("permissions","Permissões"):""}${isManager()?tabBtn("backup","Backup / Sincronização"):""}</nav>`; }
  function tabBtn(id,label){ return `<button type="button" class="planner-tab ${state.tab===id?"active":""}" data-tab="${id}">${label}</button>`; }
  function tabTitle(){ return ({board:"Tarefas / Planner",dashboard:"Dashboard",notifications:"Notificações",people:"Pessoas / Direcionamento",permissions:"Permissões",backup:"Backup / Sincronização"})[state.tab] || "Planner"; }

  function render(){
    const root=document.getElementById("plannerRoot"); if(!root) return;
    const userCode=state.currentUser?.user_code||code(state.currentUser?.email);
    root.innerHTML=`<div id="plannerNotifications" class="planner-notifications"></div>${embedded?"":`<section class="planner-top"><div><div class="planner-kicker">Menu principal / Painel de solicitações / ${esc(tabTitle())}</div><h2>${esc(tabTitle())}</h2><p>As solicitações da Engenharia de Processo são tratadas como tarefas com responsável, membros, prioridade, status, tempo e rastreabilidade.</p></div><div class="planner-user"><strong>${esc(userCode)}</strong><span>${esc(state.currentUser?.email||"")} • ${esc(role())}</span></div></section>`}${nav()}<div class="planner-actions planner-return-actions"><button type="button" onclick="location.href='index.html'">Voltar ao menu</button><button type="button" onclick="location.href='index.html#painel'">Voltar ao painel de solicitações</button><button type="button" id="plannerRefresh">Atualizar</button></div><div id="plannerView"></div>`;
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;render();});
    document.getElementById("plannerRefresh").onclick=()=>load(false);
    renderNotificationTray();
    if(state.tab==="dashboard") renderDashboard();
    else if(state.tab==="notifications") renderNotifications();
    else if(state.tab==="people") renderPeople();
    else if(state.tab==="permissions") renderPermissions();
    else if(state.tab==="backup") renderBackup();
    else renderBoard();
  }

  function filteredTasks(){
    const q=state.query.toLowerCase(); const now=new Date();
    return state.tasks.filter(t=>{
      const text=[t.title,t.description,t.task_type,t.priority,t.status,t.responsible_user_code,t.created_by_user_code,userEmail(t.responsible_id)].join(" ").toLowerCase();
      const due=t.due_date?new Date(t.due_date):null;
      return(!q||text.includes(q))&&(!state.status||taskStatus(t)===state.status)&&(!state.priority||t.priority===state.priority)&&(!state.responsible||t.responsible_id===state.responsible)&&(!state.type||t.task_type===state.type)&&(!state.onlyLate||taskStatus(t)==="Atrasado"||(due&&due<now&&taskStatus(t)!=="Concluído"))&&(!state.mine||t.responsible_id===state.currentUser?.id)&&(!state.noResponsible||!t.responsible_id);
    });
  }
  function renderBoard(){
    const view=document.getElementById("plannerView"); const list=filteredTasks();
    view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Painel de solicitações/tarefas</h3><small>Gestão operacional: responsável, membros envolvidos, status, cronômetro, prazo e observações.</small></div><div class="planner-panel-body"><div class="planner-task-filters"><input id="tfQuery" placeholder="Buscar por texto, responsável, e-mail..." value="${esc(state.query)}"><select id="tfStatus">${selectOptions(STATUSES,state.status)}</select><select id="tfPriority">${selectOptions(PRIORITIES,state.priority)}</select><select id="tfResponsible">${userOptions(state.responsible,true)}</select><select id="tfType">${selectOptions(TASK_TYPES,state.type)}</select><label class="planner-check"><input id="tfMine" type="checkbox" ${state.mine?"checked":""}> Minhas tarefas</label><label class="planner-check"><input id="tfLate" type="checkbox" ${state.onlyLate?"checked":""}> Atrasadas</label><label class="planner-check"><input id="tfNoResp" type="checkbox" ${state.noResponsible?"checked":""}> Sem responsável</label><button id="tfClear" type="button">Limpar filtros</button><button id="tfRefresh" type="button">Atualizar tarefas</button></div><div class="planner-board">${STATUSES.map(s=>`<div class="planner-col"><h4>${esc(s)} (${list.filter(t=>taskStatus(t)===s).length})</h4>${list.filter(t=>taskStatus(t)===s).map(taskCard).join("")||'<div class="planner-empty">Sem tarefas</div>'}</div>`).join("")}</div></div></section>`;
    bindFilters(); bindTaskActions();
  }
  function taskCard(t){
    const obs=state.observations.filter(o=>o.task_id===t.id).slice(0,2).map(o=>`<span class="mini">${esc(o.user_code)}: ${esc(o.observation)}</span>`).join("");
    const timer=activeSession(t);
    const members=state.members.filter(m=>m.task_id===t.id);
    const memberIds=members.map(m=>m.user_id).filter(Boolean);
    const membersText=members.map(m=>m.user_code||userLabel(m.user_id)).filter(Boolean).join(", ") || "Sem membros adicionais";
    const responsibleCanExecute=!t.responsible_id || userCanExecute(t.responsible_id,t.task_type) || isManager();
    return `<article class="task-card ${timer?"timer-active":""}"><div class="task-card-main"><h5>${esc(t.title)}</h5><p>${esc(t.description||"").slice(0,180)}</p></div><div class="task-meta"><span class="planner-tag tag-${priorityClass(t.priority)}">${esc(t.priority)}</span><span class="planner-tag tag-time" data-live-task="${esc(t.id)}">${fmtMinutes(taskMinutes(t))}</span>${timer?'<span class="planner-tag tag-baixa">Cronômetro ativo</span>':""}${!responsibleCanExecute?'<span class="planner-tag tag-alta">Resp. sem permissão</span>':""}</div><div class="task-info-grid"><span><strong>Status</strong>${esc(taskStatus(t))}</span><span><strong>Resp.</strong>${esc(t.responsible_user_code||userLabel(t.responsible_id))}</span><span><strong>Prazo</strong>${fmtDate(t.due_date)}</span><span><strong>Criado por</strong>${esc(t.created_by_user_code||"-")}</span><span><strong>Tipo</strong>${esc(t.task_type||"-")}</span><span><strong>Membros</strong>${esc(membersText)}</span></div>${obs}<div class="task-actions"><select data-status-task="${esc(t.id)}">${STATUSES.map(s=>`<option ${taskStatus(t)===s?"selected":""}>${esc(s)}</option>`).join("")}</select>${canChangeResponsible(t)?`<select data-resp-task="${esc(t.id)}">${userOptions(t.responsible_id,false)}</select>`:""}${canAddMembers(t)?`<select data-members-task="${esc(t.id)}" multiple>${userMultiOptions(memberIds)}</select><button type="button" data-save-members="${esc(t.id)}">Salvar membros</button>`:""}<textarea data-obs-task="${esc(t.id)}" placeholder="Observação"></textarea><button type="button" data-add-obs="${esc(t.id)}">Adicionar observação</button></div></article>`;
  }
  function bindFilters(){ const map={tfQuery:"query",tfStatus:"status",tfPriority:"priority",tfResponsible:"responsible",tfType:"type"}; Object.entries(map).forEach(([id,key])=>document.getElementById(id).oninput=e=>{state[key]=e.target.value;renderBoard();}); document.getElementById("tfMine").onchange=e=>{state.mine=e.target.checked;renderBoard();}; document.getElementById("tfLate").onchange=e=>{state.onlyLate=e.target.checked;renderBoard();}; document.getElementById("tfNoResp").onchange=e=>{state.noResponsible=e.target.checked;renderBoard();}; document.getElementById("tfClear").onclick=()=>{Object.assign(state,{query:"",status:"",priority:"",responsible:"",creator:"",type:"",onlyLate:false,mine:false,noResponsible:false});renderBoard();}; document.getElementById("tfRefresh").onclick=()=>load(false); }
  function bindTaskActions(){ document.querySelectorAll("[data-status-task]").forEach(el=>el.onchange=()=>updateStatus(el.dataset.statusTask,el.value)); document.querySelectorAll("[data-resp-task]").forEach(el=>el.onchange=()=>updateResponsible(el.dataset.respTask,el.value)); document.querySelectorAll("[data-save-members]").forEach(btn=>btn.onclick=()=>updateMembers(btn.dataset.saveMembers)); document.querySelectorAll("[data-add-obs]").forEach(btn=>btn.onclick=()=>addObservation(btn.dataset.addObs)); }
  async function updateStatus(id,status){
    const task=state.tasks.find(t=>t.id===id);
    if(task && !canChangeStatus(task,status)){ alert("Você não possui permissão para executar/concluir este tipo de tarefa."); return renderBoard(); }
    let pause_reason=null;
    if(task?.status==="Em andamento"&&status!=="Em andamento"&&status!=="Concluído"){ pause_reason=prompt("Informe o motivo da pausa:"); if(!pause_reason)return renderBoard(); }
    if(window.SmcSaves)window.SmcSaves.updateLocal("plannerTasks",id,{status,pause_reason},{action:"taskStatus"});
    try{ await api("task","PATCH",{id,status,pause_reason}); await load(true); }
    catch(error){ if(window.SmcSaves)window.SmcSaves.markError("plannerTasks",id,error); alert("Salvo localmente, aguardando sincronização com Supabase. "+error.message); renderBoard(); }
  }
  async function updateResponsible(id,responsible_id){
    const task=state.tasks.find(t=>t.id===id);
    if(task && !canChangeResponsible(task)){ alert("Você não possui permissão para alterar o responsável desta tarefa."); return renderBoard(); }
    if(task && responsible_id && !userCanExecute(responsible_id,task.task_type)){ alert("Este colaborador não possui permissão para executar este tipo de tarefa."); return renderBoard(); }
    if(window.SmcSaves)window.SmcSaves.updateLocal("plannerTasks",id,{responsible_id},{action:"taskResponsible"});
    try{ await api("task","PATCH",{id,responsible_id}); await load(true); }
    catch(error){ if(window.SmcSaves)window.SmcSaves.markError("plannerTasks",id,error); alert(error.message); renderBoard(); }
  }
  async function updateMembers(id){
    const task=state.tasks.find(t=>t.id===id);
    if(task && !canAddMembers(task)){ alert("Você não possui permissão para alterar membros desta tarefa."); return renderBoard(); }
    const el=document.querySelector(`[data-members-task="${CSS.escape(id)}"]`);
    const member_ids=Array.from(el?.selectedOptions||[]).map(o=>o.value);
    if(window.SmcSaves)window.SmcSaves.updateLocal("plannerTasks",id,{member_ids},{action:"taskMembers"});
    try{ await api("task","PATCH",{id,member_ids}); await load(true); }
    catch(error){ if(window.SmcSaves)window.SmcSaves.markError("plannerTasks",id,error); alert(error.message); renderBoard(); }
  }
  async function addObservation(id){ const el=document.querySelector(`[data-obs-task="${CSS.escape(id)}"]`); const observation=el?.value.trim(); if(!observation)return alert("Digite a observação."); const local=window.SmcSaves?.saveLocal("taskObservations",{task_id:id,observation},{action:"taskObservation"}); try{const result=await api("observation","POST",{task_id:id,observation}); if(local)window.SmcSaves.markSynced("taskObservations",local.local_id,result.data); await load(true);}catch(error){if(local)window.SmcSaves.markError("taskObservations",local.local_id,error); alert("Observação salva localmente, aguardando sincronização.");} }

  function periodTasks(){
    const now=new Date(); let start; let end=new Date(now);
    if(state.period==="diario") start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    else if(state.period==="anual") start=new Date(now.getFullYear(),0,1);
    else if(state.period==="custom"){ start=state.customStart?new Date(state.customStart+"T00:00:00"):new Date(0); end=state.customEnd?new Date(state.customEnd+"T23:59:59"):end; }
    else start=new Date(now.getFullYear(),now.getMonth(),1);
    return state.tasks.filter(t=>{ const raw=t.created_at||t.createdAt||t.dataHoraIso||t.created_at_iso; const d=raw?new Date(raw):new Date(); return d>=start && d<=end; });
  }
  function counts(list){ return Object.fromEntries(STATUSES.map(s=>[s,list.filter(t=>taskStatus(t)===s).length])); }
  function group(list,fn){ const map=new Map(); list.forEach(item=>{ const key=fn(item)||"-"; map.set(key,(map.get(key)||0)+1); }); return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10); }
  function barChart(title,rows){ const max=Math.max(...rows.map(r=>r[1]),1); return `<div class="planner-mini-chart"><h4>${esc(title)}</h4>${rows.length?rows.map(([label,value])=>`<div class="mini-bar"><span>${esc(label)}</span><i style="width:${Math.max(5,value/max*100)}%"></i><strong>${value}</strong></div>`).join(""):'<div class="planner-empty">Sem dados no período</div>'}</div>`; }
  function renderDashboard(){
    const view=document.getElementById("plannerView"); const list=periodTasks(); const c=counts(list); const total=list.length||1; const totalMinutes=list.reduce((s,t)=>s+taskMinutes(t),0);
    view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Dashboard</h3><small>Indicadores temporais, volume de demandas, desempenho e carga por colaborador.</small></div><div class="planner-panel-body"><div class="planner-filters"><select id="dashPeriod"><option value="diario">Diário</option><option value="mensal">Mensal</option><option value="anual">Anual</option><option value="custom">Período personalizado</option></select><input id="dashStart" type="date" value="${esc(state.customStart)}"><input id="dashEnd" type="date" value="${esc(state.customEnd)}"><button id="dashApply" type="button">Aplicar</button></div><div class="planner-stats"><div class="planner-stat"><strong>${list.length}</strong><span>Criadas no período</span></div><div class="planner-stat"><strong>${c["Não iniciada"]}</strong><span>Em aberto</span></div><div class="planner-stat"><strong>${c["Em andamento"]}</strong><span>Em andamento</span></div><div class="planner-stat"><strong>${c["Atrasado"]}</strong><span>Atrasadas</span></div><div class="planner-stat"><strong>${c["Concluído"]}</strong><span>Concluídas</span></div><div class="planner-stat"><strong>${fmtMinutes(totalMinutes)}</strong><span>Tempo total</span></div></div><div class="planner-dashboard"><div><div class="planner-donut" style="--p-nao:${c["Não iniciada"]/total*100}%;--p-and:${(c["Não iniciada"]+c["Em andamento"])/total*100}%;--p-atraso:${(c["Não iniciada"]+c["Em andamento"]+c["Atrasado"])/total*100}%"><div class="planner-donut-center"><div><strong>${list.length}</strong><span>Total</span></div></div></div><div class="planner-legend">${STATUSES.map(s=>`<div><span><i class="planner-dot ${dotClass(s)}"></i>${esc(s)}</span><strong>${c[s]}</strong></div>`).join("")}</div></div><div><h3>Quem está fazendo o quê</h3><div class="planner-workload">${workloadRows(list)}</div></div></div><div class="planner-chart-grid"><div>${barChart("Solicitações por prioridade",group(list,t=>t.priority||"Sem prioridade"))}</div><div>${barChart("Solicitações por tipo",group(list,t=>t.task_type||"Sem tipo"))}</div><div>${barChart("Solicitações por responsável",group(list,t=>t.responsible_user_code||userLabel(t.responsible_id)))}</div><div>${barChart("Solicitações por status",Object.entries(c))}</div></div></div></section>`;
    document.getElementById("dashPeriod").value=state.period;
    document.getElementById("dashApply").onclick=()=>{ state.period=document.getElementById("dashPeriod").value; state.customStart=document.getElementById("dashStart").value; state.customEnd=document.getElementById("dashEnd").value; renderDashboard(); };
  }
  function dotClass(s){ return s==="Não iniciada"?"dot-nao":s==="Em andamento"?"dot-and":s==="Atrasado"?"dot-atraso":"dot-ok"; }
  function workloadRows(list){ return state.users.map(u=>{ const ts=list.filter(t=>t.responsible_id===u.id); const c=counts(ts); const open=c["Não iniciada"]+c["Em andamento"]+c["Atrasado"]; const total=Math.max(ts.length,1); const minutes=ts.reduce((s,t)=>s+taskMinutes(t),0); const openLimit=Number(state.config.open_overload_limit||30); const progressLimit=Number(state.config.in_progress_attention_limit||20); return `<div class="work-row"><div class="work-name"><strong>${esc(u.user_code||code(u.email))}</strong><span>${ts.length} tarefas • ${fmtMinutes(minutes)}</span>${open>=openLimit?`<span class="work-alert">Alerta: ${openLimit} ou mais tarefas em aberto.</span>`:""}${c["Em andamento"]>=progressLimit?`<span class="work-att">Atenção: ${progressLimit} ou mais tarefas em andamento.</span>`:""}</div><div class="work-bar"><i class="work-nao" style="width:${c["Não iniciada"]/total*100}%"></i><i class="work-and" style="width:${c["Em andamento"]/total*100}%"></i><i class="work-atraso" style="width:${c["Atrasado"]/total*100}%"></i><i class="work-ok" style="width:${c["Concluído"]/total*100}%"></i></div><div><span class="mini">Abertas: ${open}</span><span class="mini">Concluídas: ${c["Concluído"]}</span></div></div>`; }).join("")||'<div class="planner-empty">Sem colaboradores</div>'; }

  function visibleNotifications(){ return [...state.notifications].filter(n=>!n.removed_at && !n.viewed).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,Number(state.config.notification_limit||7)); }
  function notificationRecipient(n){ const task=state.tasks.find(t=>t.id===n.task_id)||{}; return n.recipient_user_code || task.responsible_user_code || userLabel(n.recipient_user_id||task.responsible_id); }
  function renderNotificationTray(){ const box=document.getElementById("plannerNotifications"); if(!box||!state.currentUser) return; const list=visibleNotifications(); box.innerHTML=list.map(n=>`<div class="planner-notification ${priorityClass(n.priority)}"><strong>${esc(n.message||"Nova solicitação")}</strong><span>Para: ${esc(notificationRecipient(n))} • ${esc(n.priority||"-")} • ${fmtDateTime(n.created_at)}</span><button type="button" data-view-notification="${esc(n.id)}">Marcar vista</button></div>`).join(""); bindNotificationButtons(box); }
  function renderNotifications(){ const view=document.getElementById("plannerView"); const list=visibleNotifications().concat([...state.notifications].filter(n=>n.viewed).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10)); view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Notificações dinâmicas</h3><small>Fila visual das novas solicitações. As cores seguem a prioridade e o destinatário aparece junto da demanda.</small></div><div class="planner-panel-body"><div class="notification-list">${list.map(notificationRow).join("")||'<div class="planner-empty">Sem notificações pendentes</div>'}</div></div></section>`; bindNotificationButtons(view); }
  function notificationRow(n){ const task=state.tasks.find(t=>t.id===n.task_id)||{}; return `<article class="notification-row priority-${priorityClass(n.priority||task.priority)} ${n.viewed?"viewed":""}"><div><strong>${esc(n.message||task.title||"Nova solicitação")}</strong><span>Para: ${esc(notificationRecipient(n))} • ${esc(n.priority||task.priority||"-")} • ${fmtDateTime(n.created_at)}${n.viewed?" • vista":""}</span></div>${n.viewed?"":`<button type="button" data-view-notification="${esc(n.id)}">Marcar como vista</button>`}</article>`; }
  function bindNotificationButtons(scope){ scope.querySelectorAll?.("[data-view-notification]").forEach(btn=>btn.onclick=()=>markNotification(btn.dataset.viewNotification)); }
  async function markNotification(id){ try{await api("notification","PATCH",{id}); await load(true);}catch(error){alert(error.message);} }

  function renderPeople(){ const view=document.getElementById("plannerView"); if(!isManager()){view.innerHTML='<section class="planner-panel planner-locked"><h3>Acesso restrito</h3><p>Apenas ADM/Master visualizam pessoas de direcionamento.</p></section>';return;} const eligible=state.users.map(u=>{const exec=TASK_TYPES.filter(t=>state.permissions.some(p=>p.user_id===u.id&&p.task_type===t&&p.can_execute)); return {...u,exec};}); view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Pessoas / Direcionamento</h3><small>Usuários ativos da Engenharia de Processo que podem receber solicitações como responsáveis.</small></div><div class="planner-panel-body"><div class="planner-actions"><button type="button" id="openAccessManager">Adicionar / aprovar pessoa</button><button type="button" id="refreshPeople">Atualizar</button></div><div class="people-grid">${eligible.map(peopleCard).join("")||'<div class="planner-empty">Nenhum usuário autorizado da Engenharia.</div>'}</div></div></section>`; document.getElementById("refreshPeople").onclick=()=>load(false); document.getElementById("openAccessManager").onclick=()=>{ if(parent&&typeof parent.smcAbrirGerenciarAcessos==="function") parent.smcAbrirGerenciarAcessos(); else alert("Abra Gerenciar Acessos no painel principal para aprovar novas pessoas.");}; document.querySelectorAll("[data-enable-routing]").forEach(btn=>btn.onclick=()=>enableRouting(btn.dataset.enableRouting)); }
  function peopleCard(u){ return `<article class="people-card"><div><strong>${esc(u.user_code||code(u.email))}</strong><span>${esc(u.nome||"")} • ${esc(u.email)}</span></div><div class="people-perms"><span>${u.exec.length} tipo(s) liberado(s)</span>${u.exec.slice(0,3).map(t=>`<small>${esc(t)}</small>`).join("")}${u.exec.length>3?`<small>+${u.exec.length-3} outros</small>`:""}</div><button type="button" data-enable-routing="${esc(u.id)}">Liberar direcionamento</button></article>`; }
  async function enableRouting(userId){ if(!confirm("Liberar esta pessoa para receber todos os tipos de solicitação da Engenharia?"))return; try{ for(const task_type of TASK_TYPES){ await api("permission","PATCH",{user_id:userId,task_type,can_create:false,can_execute:true,can_edit:false,can_complete:false,can_change_responsible:false,can_add_members:false}); } await load(true); alert("Pessoa liberada para direcionamento."); }catch(error){alert(error.message);} }
  function renderPermissions(){ const view=document.getElementById("plannerView"); if(!isManager()){view.innerHTML='<section class="planner-panel planner-locked"><h3>Acesso restrito</h3><p>Apenas ADM/Master visualizam permissões.</p></section>';return;} const userId=state.permUser||state.users[0]?.id||""; const type=state.permType||TASK_TYPES[0]; const user=state.users.find(u=>u.id===userId); const p=state.permissions.find(x=>x.user_id===userId&&x.task_type===type)||{}; view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Permissões</h3><small>Organizado por usuário e tipo de tarefa.</small></div><div class="planner-panel-body"><div class="planner-two"><div class="planner-field"><label>Usuário</label><select id="permUser">${state.users.map(u=>`<option value="${esc(u.id)}" ${u.id===userId?"selected":""}>${esc(u.user_code||code(u.email))}</option>`).join("")}</select></div><div class="planner-field"><label>Tipo</label><select id="permType">${TASK_TYPES.map(t=>`<option ${t===type?"selected":""}>${esc(t)}</option>`).join("")}</select></div></div><div class="permission-card"><h4>${esc(user?.user_code||"-")} • ${esc(type)}</h4>${permCheck("can_create","Criar",p)}${permCheck("can_execute","Executar / receber direcionamento",p)}${permCheck("can_edit","Editar",p)}${permCheck("can_complete","Concluir",p)}${permCheck("can_change_responsible","Alterar responsável",p)}${permCheck("can_add_members","Adicionar membros",p)}<button id="savePerm" type="button">Salvar permissões</button></div></div></section>`; document.getElementById("permUser").onchange=e=>{state.permUser=e.target.value;renderPermissions();}; document.getElementById("permType").onchange=e=>{state.permType=e.target.value;renderPermissions();}; document.getElementById("savePerm").onclick=async()=>{const body={user_id:userId,task_type:type}; document.querySelectorAll('[data-perm-field]').forEach(cb=>body[cb.dataset.permField]=cb.checked); const local=window.SmcSaves?.saveLocal("taskPermissions",body,{action:"permission"}); try{const r=await api("permission","PATCH",body); if(local)window.SmcSaves.markSynced("taskPermissions",local.local_id,r.data); await load(true); alert("Permissões salvas.");}catch(error){if(local)window.SmcSaves.markError("taskPermissions",local.local_id,error); alert(error.message);} }; }
  function permCheck(field,label,p){ return `<label class="permission-switch"><input type="checkbox" data-perm-field="${field}" ${p[field]?"checked":""}> <span>${label}</span></label>`; }
  function renderBackup(){ const view=document.getElementById("plannerView"); const s=window.SmcSaves?.statusSummary?.()||{pending:0,errors:0,lastSyncedAt:""}; view.innerHTML=`<section class="planner-panel"><div class="planner-panel-head"><h3>Backup / Sincronização</h3><small>SAVES.json lógico em localStorage com exportação/importação.</small></div><div class="planner-panel-body"><div class="planner-stats"><div class="planner-stat"><strong>${s.pending}</strong><span>Pendentes</span></div><div class="planner-stat"><strong>${s.errors}</strong><span>Erros</span></div><div class="planner-stat"><strong>${esc(s.lastSyncedAt||"-")}</strong><span>Última sync</span></div></div><div class="planner-actions"><button id="exportSaves">Exportar SAVES.json</button><label class="planner-import"><input id="importSaves" type="file" accept="application/json"> Importar SAVES.json</label><button id="syncNow">Sincronizar agora</button></div><div class="planner-note">Não são salvos senha, JWT, refresh token, service_role ou token do GitHub.</div></div></section>`; document.getElementById("exportSaves").onclick=()=>window.SmcSaves?.exportSavesJson(); document.getElementById("importSaves").onchange=async e=>{if(e.target.files[0]){await window.SmcSaves.importSavesJson(e.target.files[0]);alert("SAVES.json importado com merge por local_id.");renderBackup();}}; document.getElementById("syncNow").onclick=()=>load(false); }
  function renderLiveTimers(){ document.querySelectorAll("[data-live-task]").forEach(el=>{ const task=state.tasks.find(t=>t.id===el.dataset.liveTask); if(task) el.textContent=fmtMinutes(taskMinutes(task)); }); if(state.tab==="dashboard") renderDashboard(); }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",mount); else mount();
})();
