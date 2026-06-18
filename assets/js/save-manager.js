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
  window.SmcSaves = { loadLocalSaves, saveLocal, updateLocal, deleteLocal, markSynced, markError, exportSavesJson, importSavesJson, pendingCount, statusSummary, collections:COLLECTIONS };
})();
