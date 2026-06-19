// SMC SAVES.json logical storage layer for browser/GitHub Pages.
// It uses localStorage now and keeps the contract ready for a future physical SAVES.json backend.
(function(){
  const KEY = "SMC_SAVES_JSON_V1";
  const APP = "SMC-System-of-Improvement-and-Correction";
  const COLLECTIONS = [
    "solicitacoes",
    "solicitacaoComplementos",
    "solicitacaoStatusHistory",
    "plannerTasks",
    "taskMembers",
    "taskObservations",
    "taskTimeSessions",
    "taskNotifications",
    "taskPermissions"
  ];
  const ALLOWED_STATUS = new Set(["pending", "synced", "error", "conflict", "deleted_pending"]);

  function now(){ return new Date().toISOString(); }
  function uuid(){
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "local-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  function userCode(){
    try {
      const email = window.smcUser?.email || window.smcUserRecord?.email || "";
      return String(email || "").toLowerCase().split("@")[0] || "publico";
    } catch(_) { return "publico"; }
  }
  function deviceId(){
    let id = localStorage.getItem("SMC_DEVICE_ID");
    if (!id) { id = "device-" + uuid(); localStorage.setItem("SMC_DEVICE_ID", id); }
    return id;
  }
  function empty(){
    const data = {};
    COLLECTIONS.forEach(c => data[c] = []);
    return { version:1, app:APP, lastUpdatedAt:"", lastSyncedAt:"", deviceId:deviceId(), currentUser:userCode(), data, syncQueue:[], deletedItems:[], logs:[] };
  }
  function normalize(saves){
    const base = empty();
    const merged = Object.assign(base, saves || {});
    merged.data = Object.assign(base.data, saves?.data || {});
    COLLECTIONS.forEach(c => { if (!Array.isArray(merged.data[c])) merged.data[c] = []; });
    if (!Array.isArray(merged.syncQueue)) merged.syncQueue = [];
    if (!Array.isArray(merged.deletedItems)) merged.deletedItems = [];
    if (!Array.isArray(merged.logs)) merged.logs = [];
    merged.deviceId = merged.deviceId || deviceId();
    merged.currentUser = userCode();
    return merged;
  }
  function loadLocalSaves(){
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); }
    catch(_) { return empty(); }
  }
  function persist(saves){
    saves.lastUpdatedAt = now();
    saves.currentUser = userCode();
    localStorage.setItem(KEY, JSON.stringify(saves));
    window.dispatchEvent(new CustomEvent("smc:saves-updated", { detail:{ saves } }));
    return saves;
  }
  function baseMeta(item, status){
    const at = now();
    const localId = item.local_id || item.localId || uuid();
    return Object.assign({}, item, {
      id: item.id || item.supabase_id || localId,
      local_id: localId,
      supabase_id: item.supabase_id || (String(item.id || "").length === 36 ? item.id : ""),
      created_at: item.created_at || item.criado_em || at,
      updated_at: at,
      created_by: item.created_by || userCode(),
      updated_by: userCode(),
      sync_status: ALLOWED_STATUS.has(status) ? status : "pending",
      last_sync_at: item.last_sync_at || "",
      deleted_at: item.deleted_at || null,
      deleted_by: item.deleted_by || null,
      delete_reason: item.delete_reason || null
    });
  }
  function addLog(saves, action, collection, item, details){
    saves.logs.unshift({ id:uuid(), action, collection, item_id:item?.id || item?.local_id || "", local_id:item?.local_id || "", user:userCode(), created_at:now(), details:details || "" });
    saves.logs = saves.logs.slice(0, 1000);
  }
  function queue(saves, action, collection, item){
    saves.syncQueue.push({ id:uuid(), action, collection, item_id:item.id || item.local_id, local_id:item.local_id || "", supabase_id:item.supabase_id || "", status:item.sync_status || "pending", created_at:now(), attempts:0, last_error:"" });
  }
  function findIndex(list, id){ return list.findIndex(x => String(x.local_id || x.id || x.supabase_id) === String(id) || String(x.id) === String(id) || String(x.supabase_id || "") === String(id)); }
  function saveLocal(collection, item, options){
    const saves = loadLocalSaves();
    if (!saves.data[collection]) saves.data[collection] = [];
    const record = baseMeta(item || {}, options?.status || "pending");
    const idx = findIndex(saves.data[collection], record.local_id || record.id);
    if (idx >= 0) saves.data[collection][idx] = Object.assign({}, saves.data[collection][idx], record);
    else saves.data[collection].unshift(record);
    if (options?.queue !== false) queue(saves, options?.action || "upsert", collection, record);
    addLog(saves, options?.action || "saveLocal", collection, record, options?.details || "salvo localmente antes do Supabase");
    persist(saves);
    return record;
  }
  function updateLocal(collection, id, changes, options){
    const saves = loadLocalSaves();
    const list = saves.data[collection] || [];
    const idx = findIndex(list, id);
    if (idx < 0) return null;
    const record = baseMeta(Object.assign({}, list[idx], changes || {}), options?.status || "pending");
    list[idx] = record;
    if (options?.queue !== false) queue(saves, options?.action || "update", collection, record);
    addLog(saves, options?.action || "updateLocal", collection, record, options?.details || "atualizacao local antes do Supabase");
    persist(saves);
    return record;
  }
  function deleteLocal(collection, id, reason){
    const saves = loadLocalSaves();
    const list = saves.data[collection] || [];
    const idx = findIndex(list, id);
    if (idx < 0) return null;
    const record = baseMeta(Object.assign({}, list[idx], { deleted_at:now(), deleted_by:userCode(), delete_reason:reason || "Exclusao logica", sync_status:"deleted_pending" }), "deleted_pending");
    list[idx] = record;
    saves.deletedItems.unshift({ collection, id:record.id, local_id:record.local_id, supabase_id:record.supabase_id || "", deleted_at:record.deleted_at, deleted_by:record.deleted_by, reason:record.delete_reason });
    queue(saves, "delete", collection, record);
    addLog(saves, "deleteLocal", collection, record, reason || "exclusao logica");
    persist(saves);
    return record;
  }
  function markSynced(collection, localId, supabaseItem){
    const saves = loadLocalSaves();
    const list = saves.data[collection] || [];
    const idx = findIndex(list, localId);
    if (idx < 0) return null;
    const record = Object.assign({}, list[idx], supabaseItem || {}, { supabase_id:(supabaseItem?.id || supabaseItem?.supabase_id || list[idx].supabase_id || ""), sync_status:"synced", last_sync_at:now(), updated_at:now() });
    list[idx] = record;
    saves.syncQueue = saves.syncQueue.filter(q => !(q.collection === collection && (q.local_id === localId || q.item_id === localId)));
    saves.lastSyncedAt = now();
    addLog(saves, "markSynced", collection, record, "confirmado pelo Supabase");
    persist(saves);
    return record;
  }
  function markError(collection, localId, error){
    const msg = String(error?.message || error || "Erro de sincronizacao");
    const record = updateLocal(collection, localId, { sync_status:"error", last_error:msg }, { queue:false, status:"error", action:"syncError", details:msg });
    const saves = loadLocalSaves();
    saves.syncQueue.forEach(q => { if (q.collection === collection && (q.local_id === localId || q.item_id === localId)) { q.status = "error"; q.last_error = msg; q.attempts = Number(q.attempts || 0) + 1; } });
    persist(saves);
    return record;
  }
  function exportSavesJson(){
    const saves = loadLocalSaves();
    const blob = new Blob([JSON.stringify(saves, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SAVES.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function importSavesJson(file){
    const incoming = normalize(JSON.parse(await file.text()));
    const current = loadLocalSaves();
    COLLECTIONS.forEach(collection => {
      const map = new Map((current.data[collection] || []).map(item => [item.local_id || item.id || item.supabase_id, item]));
      (incoming.data[collection] || []).forEach(item => {
        const key = item.local_id || item.id || item.supabase_id;
        const old = map.get(key);
        if (!old || new Date(item.updated_at || item.criado_em || 0) >= new Date(old.updated_at || old.criado_em || 0)) map.set(key, item);
      });
      current.data[collection] = Array.from(map.values());
    });
    current.logs = [...incoming.logs, ...current.logs].slice(0, 1000);
    current.syncQueue = [...current.syncQueue, ...incoming.syncQueue].slice(0, 1000);
    addLog(current, "importSavesJson", "SAVES.json", { id:"SAVES.json" }, "importacao com merge por local_id");
    persist(current);
    return current;
  }
  function pendingCount(){ return loadLocalSaves().syncQueue.filter(q => q.status !== "synced").length; }
  function statusSummary(){
    const saves = loadLocalSaves();
    return { lastUpdatedAt:saves.lastUpdatedAt, lastSyncedAt:saves.lastSyncedAt, pending:pendingCount(), errors:saves.syncQueue.filter(q => q.status === "error").length, deviceId:saves.deviceId };
  }

  function installNotificationViewGuard(){
    if (window.__smcNotificationViewGuard) return;
    window.__smcNotificationViewGuard = true;
    const VIEWED_KEY = "SMC_VIEWED_NOTIFICATIONS";
    const OLD_HIDDEN_KEY = "SMC_HIDDEN_NOTIFICATIONS";

    function viewedSet(){
      try { return new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]").map(String)); }
      catch(_) { return new Set(); }
    }
    function saveViewed(set){
      localStorage.setItem(VIEWED_KEY, JSON.stringify(Array.from(set).slice(-300)));
    }
    function clearOldHidden(){
      try { localStorage.removeItem(OLD_HIDDEN_KEY); } catch(_) {}
    }
    function applyViewedState(){
      clearOldHidden();
      const viewed = viewedSet();
      document.querySelectorAll("[data-smc-hide-notification]").forEach(btn => {
        const id = String(btn.dataset.smcHideNotification || "");
        const card = btn.closest(".planner-notification");
        const isViewed = viewed.has(id);
        if (card) card.classList.toggle("viewed", isViewed);
        btn.textContent = isViewed ? "Visualizada" : "Visualizar";
        btn.disabled = isViewed;
        btn.setAttribute("aria-disabled", isViewed ? "true" : "false");
      });
    }

    document.addEventListener("click", event => {
      const btn = event.target?.closest?.("[data-smc-hide-notification]");
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const id = String(btn.dataset.smcHideNotification || "");
      if (id) {
        const viewed = viewedSet();
        viewed.add(id);
        saveViewed(viewed);
      }
      applyViewedState();
    }, true);

    const observer = new MutationObserver(applyViewedState);
    if (document.documentElement) observer.observe(document.documentElement, { childList:true, subtree:true });
    document.addEventListener("DOMContentLoaded", applyViewedState);
    window.addEventListener("smc:saves-updated", applyViewedState);
    setInterval(applyViewedState, 3000);
    applyViewedState();
  }

  function installSimpleStatusAndResponsibleGuard(){
    if (window.__smcSimpleStatusGuard) return;
    window.__smcSimpleStatusGuard = true;
    const API_URL = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/solicitacoes-api";
    const UI_STATUSES = ["Aberta", "Em andamento", "Finalizado"];
    const API_STATUS = { "Aberta":"Recebido", "Em andamento":"Em execução", "Finalizado":"Concluído" };
    const nativeFetch = window.fetch.bind(window);

    function toUiStatus(status){
      const raw = String(status || "").trim();
      if (UI_STATUSES.includes(raw)) return raw;
      if (["Recebido", "Em análise", "Aguardando informação", "Encaminhado"].includes(raw)) return "Aberta";
      if (raw === "Em execução") return "Em andamento";
      if (["Concluído", "Reprovado", "Cancelado"].includes(raw)) return "Finalizado";
      return "Aberta";
    }
    function toApiStatus(status){
      return API_STATUS[toUiStatus(status)] || "Recebido";
    }
    function statusOptions(current, all){
      const normalized = toUiStatus(current);
      const first = all ? '<option value="">Todos status</option>' : "";
      return first + UI_STATUSES.map(s => `<option value="${s}" ${normalized === s ? "selected" : ""}>${s}</option>`).join("");
    }
    function patchStatusControls(){
      const filter = document.getElementById("f_status");
      if (filter) {
        const current = filter.value ? toUiStatus(filter.value) : "";
        if (filter.dataset.smcSimpleStatus !== "1") {
          filter.innerHTML = statusOptions("", true);
          filter.dataset.smcSimpleStatus = "1";
        }
        filter.value = UI_STATUSES.includes(current) ? current : "";
      }
      document.querySelectorAll("select.status-select").forEach(select => {
        const current = toUiStatus(select.value);
        if (select.dataset.smcSimpleStatusValue !== current) {
          select.innerHTML = statusOptions(current, false);
          select.value = current;
          select.dataset.smcSimpleStatusValue = current;
        }
      });
      const aberto = document.querySelector("#st_aberto")?.nextElementSibling;
      const concluido = document.querySelector("#st_concluido")?.nextElementSibling;
      if (aberto) aberto.textContent = "Abertas";
      if (concluido) concluido.textContent = "Finalizadas";
    }
    function patchResponsibleOptional(){
      const field = document.querySelector(".smc-responsible-field");
      const select = document.getElementById("responsavelInicial");
      if (!select) return;
      select.required = false;
      select.removeAttribute("required");
      field?.querySelector(".required")?.remove();
      const label = field?.querySelector("label");
      if (label && !/opcional/i.test(label.textContent || "")) label.insertAdjacentHTML("beforeend", ' <span class="mini">(opcional)</span>');
      const hint = document.getElementById("responsavelHint");
      if (hint && !hint.dataset.smcOptionalHint) {
        hint.textContent = "Opcional. Se não selecionar, o sistema mantém a demanda aberta para atribuição posterior.";
        hint.dataset.smcOptionalHint = "1";
      }
      if (!select.querySelector('option[value=""]')) select.insertAdjacentHTML("afterbegin", '<option value="">Sem responsável definido</option>');
      if (!select.value) select.selectedIndex = 0;
      select.setCustomValidity("");
    }
    function ensureResponsibleForLegacyApi(){
      const select = document.getElementById("responsavelInicial");
      if (!select || select.value) return;
      const fallback = Array.from(select.options).find(option => option.value);
      if (!fallback) return;
      select.dataset.smcAutoResponsible = "1";
      select.value = fallback.value;
      select.setCustomValidity("");
    }
    document.addEventListener("submit", event => {
      if (event.target?.id !== "formSolicitacao") return;
      ensureResponsibleForLegacyApi();
    }, true);

    window.fetch = async function(input, init = {}){
      const url = typeof input === "string" ? input : String(input?.url || "");
      if (!url.includes("solicitacoes-api")) return nativeFetch(input, init);
      const method = String(init?.method || "GET").toUpperCase();
      if ((method === "POST" || method === "PATCH") && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body.status) body.status = toApiStatus(body.status);
          init = { ...init, body: JSON.stringify(body) };
        } catch(_) {}
      }
      return nativeFetch(input, init);
    };

    const observer = new MutationObserver(() => { patchStatusControls(); patchResponsibleOptional(); });
    if (document.documentElement) observer.observe(document.documentElement, { childList:true, subtree:true });
    document.addEventListener("DOMContentLoaded", () => { patchStatusControls(); patchResponsibleOptional(); });
    setInterval(() => { patchStatusControls(); patchResponsibleOptional(); }, 700);
    patchStatusControls();
    patchResponsibleOptional();
  }

  installNotificationViewGuard();
  installSimpleStatusAndResponsibleGuard();
  window.SmcSaves = { loadLocalSaves, saveLocal, updateLocal, deleteLocal, markSynced, markError, exportSavesJson, importSavesJson, pendingCount, statusSummary, collections:COLLECTIONS };
})();
