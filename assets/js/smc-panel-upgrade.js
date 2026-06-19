// Hotfix temporario: mantem o site carregando sem travar a inicializacao.
// O backend solicitacoes-api ja aceita responsavel opcional e status novo.
(function(){
  const API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/solicitacoes-api";
  const STATUS = ["Aberta", "Em andamento", "Finalizado"];

  function auth(){
    return typeof window.smcAuthHeader === "function" ? window.smcAuthHeader() : {};
  }

  function codeFromEmail(email){
    return String(email || "").toLowerCase().trim().split("@")[0] || "";
  }

  async function api(action){
    const url = action ? `${API}?action=${encodeURIComponent(action)}` : API;
    const res = await fetch(url, { headers: { "Content-Type":"application/json", ...auth() } });
    return await res.json().catch(() => ({}));
  }

  function addOptionalResponsibleField(users){
    const prioridade = document.getElementById("prioridade");
    if (!prioridade || document.getElementById("responsavelInicial")) return;

    const wrap = document.createElement("div");
    wrap.className = "field smc-responsible-field";
    wrap.innerHTML = '<label>Responsável inicial <span class="mini">(opcional)</span></label><select id="responsavelInicial"><option value="">Sem responsável definido</option></select><span class="mini">A solicitação pode ser aberta sem responsável e atribuída depois.</span>';
    prioridade.closest(".field")?.after(wrap);

    const select = document.getElementById("responsavelInicial");
    if (!select) return;
    select.innerHTML = '<option value="">Sem responsável definido</option>' + (users || []).map(function(u){
      const userCode = u.user_code || codeFromEmail(u.email);
      return '<option value="' + String(u.id || '') + '" data-email="' + String(u.email || '') + '" data-code="' + userCode + '">' + userCode + (u.nome ? ' - ' + u.nome : '') + '</option>';
    }).join('');
  }

  function selectedResponsible(){
    const select = document.getElementById("responsavelInicial");
    const opt = select?.selectedOptions?.[0];
    const email = opt?.dataset?.email || "";
    const id = select?.value || "";
    return {
      responsible_id: id || null,
      responsible_email: id ? email : null,
      responsible_user_code: id ? (opt?.dataset?.code || codeFromEmail(email)) : null
    };
  }

  function patchSave(){
    const original = window.salvarSolicitacaoSupabase;
    if (typeof original !== "function" || original.__smcOptionalResponsible) return;
    window.salvarSolicitacaoSupabase = async function(registro){
      return original(Object.assign({}, registro, selectedResponsible(), { status: "Aberta" }));
    };
    window.salvarSolicitacaoSupabase.__smcOptionalResponsible = true;
  }

  function patchStatusOptions(){
    document.querySelectorAll('select.status-select').forEach(function(select){
      const current = select.value;
      select.innerHTML = STATUS.map(function(s){ return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    });
  }

  async function init(){
    patchSave();
    patchStatusOptions();
    let users = [];
    try {
      const json = await api("engineering-users");
      users = json.users || [];
    } catch (error) {
      console.warn("SMC users:", error.message);
    }
    addOptionalResponsibleField(users);
    patchSave();
    patchStatusOptions();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  setTimeout(init, 800);
  setTimeout(init, 2000);
})();