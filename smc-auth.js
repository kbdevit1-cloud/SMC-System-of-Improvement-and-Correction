// SMC – System of Improvement and Correction
// Login corporativo com solicitação de acesso e aprovação por admin/master.

const SMC_SUPABASE_URL = "https://quqqcudiyhajbmtrebvr.supabase.co";
const SMC_SUPABASE_KEY = "sb_publishable_X3m3BdRtfzaH4c12ehjkMw_VsqiZGJG";
const SMC_DOMAIN = "@globaleletronics.ind.br";
const SMC_MASTER_EMAIL = "trainee.processo@globaleletronics.ind.br";

let smcAuthClient = null;
let smcSession = null;
let smcUser = null;
let smcPerfil = "publico";
let smcAccessStatus = "publico";
let smcUserRecord = null;
let smcUsuariosRows = [];
let smcAccessRequestsRows = [];
let smcInternalCleanupFns = [];

function smcEsc(v){
  return String(v || "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}

function smcJs(v){ return String(v || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }
function smcNowIso(){ return new Date().toISOString(); }
function smcIsMaster(){ return smcPerfil === "master"; }
function smcPodeAdministrar(){ return smcPerfil === "master" || smcPerfil === "admin"; }
function smcPodeGerenciarUsuarios(){ return smcPerfil === "master"; }

function smcNormalizarUsuario(raw){
  let value = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!value) return { ok:false, message:"Informe seu e-mail corporativo." };
  if (!value.includes("@")) {
    return { ok:false, message:"Informe o e-mail corporativo completo, incluindo @globaleletronics.ind.br." };
  }
  const parts = value.split("@");
  if (parts.length !== 2) {
    return { ok:false, message:"E-mail corporativo inválido." };
  }
  const [local, domain] = parts;
  if ("@" + domain !== SMC_DOMAIN) {
    return { ok:false, message:"Acesso permitido apenas para e-mails corporativos da Global Eletronics." };
  }
  if (!/^[a-z0-9._-]{2,80}$/.test(local)) return { ok:false, message:"E-mail corporativo inválido." };
  return { ok:true, usuario:local, email:local + SMC_DOMAIN };
}

function smcMensagemAuth(error){
  const msg = String(error?.message || error || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "Usuário não cadastrado ou senha incorreta. Se for seu primeiro acesso, clique em Solicitar acesso.";
  if (msg.includes("email not confirmed")) return "Conta criada, mas o e-mail ainda precisa ser confirmado.";
  if (msg.includes("already") || msg.includes("registered")) return "Este usuário já possui conta de autenticação. Aguarde aprovação ou entre com sua senha.";
  if (msg.includes("password")) return "Senha inválida. Use uma senha mais forte.";
  if (msg.includes("signup") || msg.includes("disabled") || msg.includes("not allowed")) return "Cadastro de novos usuários está desativado no Supabase Auth. A solicitação pode ser enviada, mas o administrador precisará ajustar o Auth.";
  if (msg.includes("email")) return "E-mail inválido ou não aceito pelo sistema.";
  return error?.message || "Falha na autenticação.";
}

function smcLoadSupabaseClient(){
  return new Promise((resolve, reject) => {
    if (window.supabase) return resolve(window.supabase);
    const existing = document.querySelector('script[data-smc-supabase="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.supabase), { once:true });
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar Supabase Auth.")), { once:true });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.dataset.smcSupabase = "true";
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error("Falha ao carregar Supabase Auth."));
    document.head.appendChild(s);
  });
}

function smcSetBodyLock(){
  const authOpen = !!document.getElementById("smcAuthOverlay");
  const internalOpen = !!document.getElementById("smcInternalOverlay");
  document.body.classList.toggle("smc-auth-locked", authOpen || internalOpen);
}

function smcAddCleanup(fn){ if (typeof fn === "function") smcInternalCleanupFns.push(fn); }
function smcRunInternalCleanup(){ while (smcInternalCleanupFns.length) { try { smcInternalCleanupFns.pop()(); } catch (_) {} } }
function smcBind(id, eventName, handler){
  const el = document.getElementById(id);
  if (!el) return null;
  el.addEventListener(eventName, handler);
  smcAddCleanup(() => el.removeEventListener(eventName, handler));
  return el;
}

function smcInstallStyle(){
  const old = document.getElementById("smcAuthStyle");
  if (old) old.remove();
  const st = document.createElement("style");
  st.id = "smcAuthStyle";
  st.textContent = `
    body.smc-auth-locked{overflow:hidden}
    .smc-auth-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at 18% 18%,rgba(47,128,237,.18),transparent 32%),rgba(3,8,17,.92);backdrop-filter:blur(10px)}
    .smc-auth-shell{width:min(1040px,100%);min-height:560px;display:grid;grid-template-columns:1.05fr .95fr;border:1px solid rgba(120,170,220,.24);border-radius:24px;overflow:hidden;background:linear-gradient(135deg,rgba(9,24,43,.98),rgba(12,31,54,.96));box-shadow:0 28px 90px rgba(0,0,0,.55);position:relative;color:#f4f8ff;font-family:Arial,Helvetica,sans-serif}
    .smc-auth-brand{padding:38px;display:flex;flex-direction:column;justify-content:space-between;border-right:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(16,37,64,.90),rgba(7,17,31,.95))}
    .smc-auth-kicker{display:inline-flex;width:max-content;border:1px solid rgba(112,168,240,.38);background:rgba(47,128,237,.12);border-radius:999px;padding:8px 12px;color:#d9ecff;font:800 12px Arial}
    .smc-auth-brand h2{margin:22px 0 12px;color:#fff;font:900 34px/1.05 Arial}.smc-auth-brand p{margin:0;color:#c7d7ea;font:400 14px/1.65 Arial}.smc-auth-flow{display:grid;gap:12px;margin-top:28px}.smc-auth-flow div{padding:13px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(3,9,18,.36)}.smc-auth-flow strong{display:block;color:#fff;font:800 13px Arial;margin-bottom:3px}.smc-auth-flow span{display:block;color:#aebfd3;font:400 11px/1.4 Arial}.smc-auth-foot{color:#aebfd3;font:700 11px Arial;margin-top:20px}
    .smc-auth-panel{padding:38px;display:flex;flex-direction:column;justify-content:center;background:rgba(7,17,31,.72)}.smc-auth-panel h3{margin:0 0 7px;color:#fff;font:900 25px Arial}.smc-auth-panel p{margin:0 0 22px;color:#b8c9de;font:400 13px/1.55 Arial}.smc-auth-form{display:grid;gap:13px}.smc-auth-field label{display:block;margin:0 0 7px;color:#dce8f7;font:800 12px Arial}
    .smc-auth-field input,.smc-spa-field input,.smc-spa-field select,.smc-spa-field textarea,.smc-users-toolbar input,.smc-users-toolbar select,.smc-access-action select{width:100%;border-radius:12px;border:1px solid rgba(113,154,204,.28);background:none!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;-webkit-box-shadow:none!important;color:#fff!important;-webkit-text-fill-color:#fff!important;padding:0 14px;outline:none;font:500 14px Arial;appearance:none!important;-webkit-appearance:none!important;caret-color:#fff!important}
    .smc-auth-field input,.smc-spa-field input,.smc-spa-field select,.smc-users-toolbar input,.smc-users-toolbar select,.smc-access-action select{height:46px}.smc-spa-field textarea{min-height:92px;padding-top:12px;resize:vertical}
    .smc-auth-field input:-webkit-autofill,.smc-auth-field input:-webkit-autofill:hover,.smc-auth-field input:-webkit-autofill:focus,.smc-spa-field input:-webkit-autofill,.smc-spa-field input:-webkit-autofill:hover,.smc-spa-field input:-webkit-autofill:focus{background:none!important;background-color:transparent!important;background-image:none!important;-webkit-text-fill-color:#fff!important;box-shadow:none!important;-webkit-box-shadow:0 0 0 1000px rgba(7,17,31,.01) inset!important;transition:background-color 999999s ease-out 0s!important}
    .smc-auth-field input::placeholder,.smc-spa-field input::placeholder,.smc-spa-field textarea::placeholder{color:#8fa6c2!important;-webkit-text-fill-color:#8fa6c2!important}.smc-auth-field small,.smc-spa-field small{display:block;margin-top:6px;color:#91a6bc;font:700 11px Arial}.smc-auth-field input:focus,.smc-spa-field input:focus,.smc-spa-field select:focus,.smc-spa-field textarea:focus{border-color:#2f80ed!important}
    .smc-auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}.smc-auth-actions button,.smc-public-btn{height:44px;border:0;border-radius:12px;font:900 13px Arial;cursor:pointer}.smc-login-btn{background:#2f80ed;color:#fff}.smc-create-btn{background:transparent;color:#edf6ff;border:1px solid rgba(255,255,255,.13)!important}.smc-public-btn{width:100%;margin-top:10px;background:transparent;color:#bcd0e7;border:1px solid rgba(188,208,231,.24)!important}.smc-auth-msg{min-height:18px;margin-top:12px;color:#d8e8fa;font:700 12px Arial}.smc-auth-msg.ok{color:#b7ffd0}.smc-auth-msg.err{color:#ffd0d0}.smc-auth-note{margin-top:18px;padding:12px;border-radius:12px;background:rgba(47,128,237,.10);border:1px solid rgba(47,128,237,.24);color:#bfd4ec;font:400 12px/1.45 Arial}.smc-auth-note strong{color:#fff}
    .smc-auth-close,.smc-internal-close{display:flex!important;align-items:center;justify-content:center;position:absolute;right:18px;top:18px;z-index:5;width:38px;height:38px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font:900 22px Arial}.smc-internal-close{position:static;flex:0 0 auto}
    .smc-session-pill{position:fixed;right:18px;bottom:18px;z-index:99998;display:flex;align-items:center;gap:10px;max-width:min(650px,calc(100vw - 36px));padding:10px 12px;border-radius:16px;border:1px solid rgba(120,170,220,.28);background:rgba(9,24,43,.96);box-shadow:0 18px 50px rgba(0,0,0,.35);color:#fff;font-family:Arial}.smc-session-pill small{display:block;color:#aebfd3;font-size:11px}.smc-session-pill strong{font-size:13px}.smc-session-pill button{border:0;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;padding:8px 10px;font-weight:800;cursor:pointer}.smc-users-btn{background:#2f80ed!important}
    .smc-internal-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,0,0,.78);backdrop-filter:blur(8px)}.smc-internal-shell{width:min(1180px,100%);max-height:calc(100vh - 44px);display:flex;flex-direction:column;border:1px solid rgba(120,170,220,.28);border-radius:20px;overflow:hidden;background:linear-gradient(135deg,rgba(9,24,43,.99),rgba(12,31,54,.98));box-shadow:0 28px 90px rgba(0,0,0,.58);color:#f4f8ff;font-family:Arial,Helvetica,sans-serif}.smc-internal-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(7,17,31,.86)}.smc-internal-top h2{margin:0 0 5px;color:#fff;font:900 22px/1.2 Arial}.smc-internal-top p{margin:0;color:#b8c9de;font:400 12px/1.5 Arial}.smc-internal-body{overflow:auto;padding:20px}.smc-spa-grid{display:grid;grid-template-columns:1fr .95fr;gap:18px}.smc-spa-card{background:linear-gradient(180deg,rgba(16,37,64,.96),rgba(11,27,48,.96));border:1px solid rgba(80,130,180,.28);border-radius:16px;padding:18px;margin-bottom:16px}.smc-spa-card h3{margin:0 0 8px;color:#fff;font:900 20px Arial}.smc-spa-card p{margin:0 0 14px;color:#c7d7ea;font:400 13px/1.6 Arial}.smc-spa-field{margin-bottom:13px}.smc-spa-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.smc-spa-actions button,.smc-mini-btn{border:0;border-radius:11px;padding:11px 14px;background:#2f80ed;color:#fff;font:900 13px Arial;cursor:pointer}.smc-spa-actions .secondary,.smc-mini-btn.secondary{background:transparent;border:1px solid rgba(255,255,255,.13)}.smc-mini-btn.danger{background:#ef4444}.smc-mini-btn.ok{background:#22c55e}.smc-spa-msg{min-height:20px;margin-top:13px;color:#d8e8fa;font:800 12px Arial}.smc-spa-msg.ok{color:#b7ffd0}.smc-spa-msg.err{color:#ffd0d0}.smc-spa-note{padding:12px;border-radius:12px;background:rgba(47,128,237,.10);border:1px solid rgba(47,128,237,.24);color:#bfd4ec;font:400 12px/1.45 Arial}.smc-spa-note strong{color:#fff}
    .smc-users-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.smc-users-stat{padding:13px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(5,13,25,.45)}.smc-users-stat strong{display:block;font-size:24px;color:#fff}.smc-users-stat span{color:#91a6bc;font-size:11px}.smc-users-toolbar{display:grid;grid-template-columns:1fr 160px 140px auto;gap:10px;margin-bottom:14px}.smc-users-toolbar button{border:0;border-radius:10px;background:#2f80ed;color:#fff;font-weight:900;padding:11px 14px;cursor:pointer}.smc-users-tablewrap{overflow-x:auto}.smc-users-table{width:100%;border-collapse:collapse;min-width:880px}.smc-users-table th,.smc-users-table td{border-bottom:1px solid rgba(255,255,255,.08);padding:11px;text-align:left;vertical-align:top;font-size:13px}.smc-users-table th{color:#cfe2fa;text-transform:uppercase;font-size:11px;background:rgba(255,255,255,.04)}.smc-user-tag{display:inline-block;border-radius:999px;padding:5px 8px;font-weight:900;font-size:11px}.smc-user-master{background:rgba(47,128,237,.2);color:#cfe2fa}.smc-user-admin{background:rgba(34,197,94,.18);color:#d4ffe2}.smc-user-usuario{background:rgba(245,158,11,.18);color:#fff0cf}.smc-user-inativo,.smc-user-pending{background:rgba(239,68,68,.16);color:#ffd3d3}.smc-users-empty{padding:22px;text-align:center;color:#91a6bc}.smc-muted{color:#91a6bc;font-size:11px;display:block;margin-top:4px}.smc-access-action{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.smc-access-action select{width:130px;height:38px;padding:0 8px}
    @media(max-width:820px){.smc-auth-overlay{align-items:flex-start;overflow:auto}.smc-auth-shell{grid-template-columns:1fr;min-height:auto}.smc-auth-brand{padding:26px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08)}.smc-auth-brand h2{font-size:28px}.smc-auth-panel{padding:26px}.smc-auth-actions{grid-template-columns:1fr}.smc-session-pill{left:12px;right:12px;bottom:12px;flex-wrap:wrap}.smc-internal-overlay{align-items:flex-start;overflow:auto}.smc-spa-grid{grid-template-columns:1fr}.smc-users-stats{grid-template-columns:1fr 1fr}.smc-users-toolbar{grid-template-columns:1fr}.smc-internal-body{padding:14px}.smc-auth-close{right:12px;top:12px}.smc-internal-close{width:38px;height:38px}}
  `;
  document.head.appendChild(st);
}

async function smcInitAuth(){
  smcInstallStyle();
  const lib = await smcLoadSupabaseClient();
  smcAuthClient = lib.createClient(SMC_SUPABASE_URL, SMC_SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true } });
  const { data } = await smcAuthClient.auth.getSession();
  smcSession = data.session || null;
  smcUser = smcSession?.user || null;
  await smcAtualizarPerfil();
  smcRenderAcesso();
  smcAplicarPermissoesVisuais();
  smcAuthClient.auth.onAuthStateChange(async (_event, session) => {
    smcSession = session || null;
    smcUser = smcSession?.user || null;
    await smcAtualizarPerfil();
    smcRenderAcesso();
    smcAplicarPermissoesVisuais();
    if (typeof loadSolicitacoes === "function" && smcAccessStatus === "active") loadSolicitacoes();
  });
}

async function smcAtualizarPerfil(){
  smcPerfil = "publico";
  smcAccessStatus = "publico";
  smcUserRecord = null;
  if (!smcUser?.email) return;
  const email = smcUser.email.trim().toLowerCase();
  if (!email.endsWith(SMC_DOMAIN)) {
    smcAccessStatus = "blocked";
    smcPerfil = "bloqueado";
    await smcLogAudit("login_blocked_invalid_domain", email, "Domínio inválido");
    return;
  }
  try {
    const { data, error } = await smcAuthClient.from("usuarios_smc").select("nome,email,perfil,ativo,criado_em,atualizado_em").eq("email", email).maybeSingle();
    if (error) throw error;
    if (data) {
      smcUserRecord = data;
      if (data.ativo === false) {
        smcAccessStatus = "blocked";
        smcPerfil = data.perfil || "usuario";
        await smcLogAudit("login_blocked_user_blocked", email, "Usuário bloqueado");
        return;
      }
      smcAccessStatus = "active";
      smcPerfil = email === SMC_MASTER_EMAIL.toLowerCase() ? "master" : (data.perfil || "usuario");
      await smcLogAudit("login_authorized", email, `Perfil: ${smcPerfil}`);
      return;
    }
    if (email === SMC_MASTER_EMAIL.toLowerCase()) {
      smcAccessStatus = "active";
      smcPerfil = "master";
      await smcGarantirMasterInicial(email);
      return;
    }
    smcAccessStatus = "pending";
    smcPerfil = "pendente";
    await smcLogAudit("login_blocked_user_pending", email, "Sem perfil ativo em usuarios_smc");
  } catch (error) {
    console.error(error);
    smcAccessStatus = email === SMC_MASTER_EMAIL.toLowerCase() ? "active" : "pending";
    smcPerfil = email === SMC_MASTER_EMAIL.toLowerCase() ? "master" : "pendente";
  }
}

async function smcGarantirMasterInicial(email){
  try {
    await smcAuthClient.from("usuarios_smc").upsert({ nome:"Master SMC", email, perfil:"master", ativo:true }, { onConflict:"email" });
  } catch (_) {}
}

async function smcLogAudit(action, targetEmail, details){
  if (!smcAuthClient) return;
  try {
    await smcAuthClient.from("access_audit_logs").insert({
      action,
      target_email: String(targetEmail || "").toLowerCase(),
      performed_by: smcUser?.email || null,
      performed_at: smcNowIso(),
      details: String(details || "")
    });
  } catch (_) {}
}

function smcAplicarPermissoesVisuais(){
  document.querySelectorAll("[data-smc-admin]").forEach(el => el.style.display = smcPodeAdministrar() ? "" : "none");
  document.querySelectorAll("[data-smc-master]").forEach(el => el.style.display = smcPodeGerenciarUsuarios() ? "" : "none");
  document.querySelectorAll(".adminOnly").forEach(el => el.classList.toggle("hidden", !smcPodeAdministrar()));
  document.querySelectorAll(".masterOnly").forEach(el => el.classList.toggle("hidden", !smcPodeGerenciarUsuarios()));
}

function smcRenderAcesso(){
  document.getElementById("smcAuthBox")?.remove();
  document.getElementById("smcAuthOverlay")?.remove();
  document.getElementById("smcSessionPill")?.remove();
  smcSetBodyLock();
  if (!smcUser) return smcRenderLoginProfissional();
  if (smcAccessStatus === "active") return smcRenderSessao();
  return smcRenderAcessoPendente();
}

function smcRenderLoginProfissional(){
  const overlay = document.createElement("div");
  overlay.id = "smcAuthOverlay";
  overlay.className = "smc-auth-overlay";
  overlay.innerHTML = `
    <section class="smc-auth-shell" role="dialog" aria-modal="true" aria-label="Acesso ao SMC">
      <button type="button" id="smcAuthCloseBtn" class="smc-auth-close" aria-label="Continuar sem login" title="Continuar sem login">×</button>
      <div class="smc-auth-brand">
        <div><div class="smc-auth-kicker">SMC • Acesso seguro</div><h2>System of Improvement and Correction</h2><p>Canal de registro, acompanhamento e controle de melhorias, correções e ações internas.</p><div class="smc-auth-flow"><div><strong>Abrir chamado</strong><span>Registro rápido para fábrica, ADM ou outro setor.</span></div><div><strong>Solicitar acesso</strong><span>E-mail corporativo ainda não aprovado gera uma solicitação pendente.</span></div><div><strong>Gestão ADM</strong><span>Admins e masters aprovam tudo dentro da mesma janela.</span></div></div></div>
        <div class="smc-auth-foot">Domínio permitido: ${SMC_DOMAIN}</div>
      </div>
      <div class="smc-auth-panel"><h3>Entrar no SMC</h3><p>Digite seu e-mail corporativo completo. O sistema bloqueia domínio pessoal.</p><div class="smc-auth-form"><div class="smc-auth-field"><label for="smcLoginUsuario">E-mail corporativo</label><input id="smcLoginUsuario" type="email" autocomplete="email" autocapitalize="none" spellcheck="false"><small>Use o e-mail corporativo completo.</small></div><div class="smc-auth-field"><label for="smcLoginSenha">Senha</label><input id="smcLoginSenha" type="password" placeholder="Digite sua senha" autocomplete="current-password"></div><div class="smc-auth-actions"><button type="button" id="smcLoginBtn" class="smc-login-btn">Entrar</button><button type="button" id="smcCreateBtn" class="smc-create-btn">Solicitar acesso</button></div><button type="button" id="smcPublicBtn" class="smc-public-btn">Continuar sem login</button><div class="smc-auth-msg" id="smcLoginMsg"></div><div class="smc-auth-note"><strong>Segurança:</strong> e-mail corporativo não aprovado não entra direto. Ele fica aguardando aprovação de admin/master.</div></div></div>
    </section>`;
  document.body.appendChild(overlay);
  document.getElementById("smcAuthCloseBtn")?.addEventListener("click", smcContinuarPublico);
  document.getElementById("smcPublicBtn")?.addEventListener("click", smcContinuarPublico);
  document.getElementById("smcLoginBtn")?.addEventListener("click", smcLogin);
  document.getElementById("smcCreateBtn")?.addEventListener("click", smcAbrirSolicitacaoAcesso);
  document.getElementById("smcLoginSenha")?.addEventListener("keydown", event => { if (event.key === "Enter") smcLogin(); });
  smcSetBodyLock();
}

function smcRenderAcessoPendente(){
  const overlay = document.createElement("div");
  overlay.id = "smcAuthOverlay";
  overlay.className = "smc-auth-overlay";
  const title = smcAccessStatus === "blocked" ? "Acesso bloqueado" : "Acesso aguardando aprovação";
  const message = smcAccessStatus === "blocked" ? "Seu acesso está bloqueado. Entre em contato com um administrador." : "Seu acesso ainda está aguardando aprovação.";
  overlay.innerHTML = `
    <section class="smc-auth-shell" role="dialog" aria-modal="true" aria-label="${smcEsc(title)}">
      <div class="smc-auth-brand"><div><div class="smc-auth-kicker">SMC • Controle de acesso</div><h2>${smcEsc(title)}</h2><p>${smcEsc(message)}</p><div class="smc-auth-flow"><div><strong>E-mail</strong><span>${smcEsc(smcUser?.email || "-")}</span></div><div><strong>Status</strong><span>${smcEsc(smcAccessStatus)}</span></div><div><strong>Próximo passo</strong><span>Solicite acesso ou aguarde aprovação de ADM/Master.</span></div></div></div><div class="smc-auth-foot">Nenhuma página externa foi aberta.</div></div>
      <div class="smc-auth-panel"><h3>${smcEsc(message)}</h3><p>Se ainda não enviou a solicitação, clique abaixo. Se já enviou, aguarde a aprovação.</p><div class="smc-auth-actions"><button type="button" id="smcPendingRequestBtn" class="smc-login-btn">Solicitar acesso</button><button type="button" id="smcPendingLogoutBtn" class="smc-create-btn">Sair</button></div><button type="button" id="smcPendingPublicBtn" class="smc-public-btn">Continuar sem login</button><div class="smc-auth-msg" id="smcLoginMsg"></div></div>
    </section>`;
  document.body.appendChild(overlay);
  document.getElementById("smcPendingRequestBtn")?.addEventListener("click", smcAbrirSolicitacaoAcesso);
  document.getElementById("smcPendingLogoutBtn")?.addEventListener("click", smcLogout);
  document.getElementById("smcPendingPublicBtn")?.addEventListener("click", smcContinuarPublico);
  smcSetBodyLock();
}

function smcRenderSessao(){
  const pill = document.createElement("div");
  pill.id = "smcSessionPill";
  pill.className = "smc-session-pill";
  const adminButton = smcPodeAdministrar() ? `<button type="button" id="smcUsersBtn" class="smc-users-btn">Gerenciar Acessos</button>` : "";
  pill.innerHTML = `<div><strong>SMC conectado</strong><small>${smcEsc(smcUser.email)} • Perfil: ${smcEsc(smcPerfil)}</small></div>${adminButton}<button type="button" id="smcLogoutBtn">Sair</button>`;
  document.body.appendChild(pill);
  document.getElementById("smcUsersBtn")?.addEventListener("click", smcAbrirGerenciarAcessos);
  document.getElementById("smcLogoutBtn")?.addEventListener("click", smcLogout);
}

function smcAbrirTelaInterna(titulo, subtitulo, conteudo){
  smcFecharTelaInterna();
  const overlay = document.createElement("div");
  overlay.id = "smcInternalOverlay";
  overlay.className = "smc-internal-overlay";
  overlay.innerHTML = `<section class="smc-internal-shell" role="dialog" aria-modal="true" aria-label="${smcEsc(titulo)}"><div class="smc-internal-top"><div><h2>${smcEsc(titulo)}</h2><p>${smcEsc(subtitulo)}</p></div><button type="button" id="smcInternalCloseBtn" class="smc-internal-close" aria-label="Fechar" title="Fechar">×</button></div><div class="smc-internal-body">${conteudo}</div></section>`;
  const onBackdropClick = event => { if (event.target === overlay) smcFecharTelaInterna(); };
  const onKeydown = event => { if (event.key === "Escape") smcFecharTelaInterna(); };
  overlay.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(overlay);
  document.getElementById("smcInternalCloseBtn")?.addEventListener("click", smcFecharTelaInterna);
  smcAddCleanup(() => overlay.removeEventListener("click", onBackdropClick));
  smcAddCleanup(() => document.removeEventListener("keydown", onKeydown));
  smcSetBodyLock();
}

function smcFecharTelaInterna(){
  smcRunInternalCleanup();
  document.getElementById("smcInternalOverlay")?.remove();
  smcUsuariosRows = [];
  smcAccessRequestsRows = [];
  smcSetBodyLock();
}

function smcAbrirSolicitacaoAcesso(){
  const baseUser = document.getElementById("smcLoginUsuario")?.value.trim() || smcUser?.email || "";
  const normalized = smcNormalizarUsuario(baseUser);
  const usuario = normalized.ok ? normalized.email : "";
  smcAbrirTelaInterna("Solicitar acesso", "Solicitação interna, sem abrir nova página ou WebView.", `
    <div class="smc-spa-grid">
      <section class="smc-spa-card"><h3>Fluxo correto</h3><p>O usuário corporativo solicita acesso e aguarda aprovação. Admins e masters aprovam pela aba Gerenciar Acessos.</p><div class="smc-spa-note"><strong>Importante:</strong> e-mails pessoais são bloqueados e não geram solicitação.</div></section>
      <section class="smc-spa-card"><h3>Dados da solicitação</h3>
        <div class="smc-spa-field"><label for="smcCadastroUsuario">E-mail corporativo</label><input id="smcCadastroUsuario" type="email" value="${smcEsc(usuario)}" autocomplete="email" autocapitalize="none" spellcheck="false"><small>Digite o e-mail corporativo completo. Não use apenas o usuário.</small></div>
        <div class="smc-spa-field"><label for="smcCadastroNome">Nome</label><input id="smcCadastroNome" type="text" placeholder="Seu nome completo"></div>
        <div class="smc-spa-field"><label for="smcCadastroSetor">Setor</label><input id="smcCadastroSetor" type="text" placeholder="Ex.: Engenharia, Produção, SGQ..."></div>
        <div class="smc-spa-field"><label for="smcCadastroMotivo">Motivo</label><textarea id="smcCadastroMotivo" placeholder="Explique por que precisa acessar o SMC."></textarea></div>
        <div class="smc-spa-field"><label for="smcCadastroSenha">Senha para criar login</label><input id="smcCadastroSenha" type="password" placeholder="Crie uma senha" autocomplete="new-password"><small>A senha é enviada somente ao Supabase Auth. Ela não é salva na tabela de solicitação.</small></div>
        <div class="smc-spa-actions"><button type="button" id="smcCadastroBtn">Enviar solicitação</button><button type="button" id="smcCadastroVoltarBtn" class="secondary">Voltar</button></div><div id="smcCadastroMsg" class="smc-spa-msg"></div>
      </section>
    </div>`);
  smcBind("smcCadastroBtn", "click", smcEnviarSolicitacaoAcesso);
  smcBind("smcCadastroVoltarBtn", "click", smcFecharTelaInterna);
  smcBind("smcCadastroSenha", "keydown", event => { if (event.key === "Enter") smcEnviarSolicitacaoAcesso(); });
}

async function smcEnviarSolicitacaoAcesso(){
  const normalized = smcNormalizarUsuario(document.getElementById("smcCadastroUsuario")?.value || "");
  const nome = String(document.getElementById("smcCadastroNome")?.value || "").trim();
  const setor = String(document.getElementById("smcCadastroSetor")?.value || "").trim();
  const motivo = String(document.getElementById("smcCadastroMotivo")?.value || "").trim();
  const passwordInput = document.getElementById("smcCadastroSenha");
  const password = passwordInput?.value || "";
  const msg = document.getElementById("smcCadastroMsg");
  const btn = document.getElementById("smcCadastroBtn");
  if (!msg || !btn) return;
  msg.className = "smc-spa-msg";
  if (!normalized.ok) { msg.textContent = normalized.message; msg.classList.add("err"); await smcLogAudit("request_blocked_invalid_domain", normalized.email || "", normalized.message); return; }
  if (!nome) { msg.textContent = "Informe seu nome."; msg.classList.add("err"); return; }
  if (!setor) { msg.textContent = "Informe seu setor."; msg.classList.add("err"); return; }
  if (!motivo) { msg.textContent = "Informe o motivo da solicitação."; msg.classList.add("err"); return; }
  if (!password || password.length < 6) { msg.textContent = "Informe uma senha com pelo menos 6 caracteres para criar o login."; msg.classList.add("err"); return; }
  btn.disabled = true;
  msg.textContent = "Enviando solicitação...";
  try {
    const { data: existingProfile } = await smcAuthClient.from("usuarios_smc").select("email,ativo").eq("email", normalized.email).maybeSingle();
    if (existingProfile?.ativo === true) { msg.textContent = "Este e-mail já está aprovado. Faça login normalmente."; msg.classList.add("ok"); return; }
    const { error: signUpError } = await smcAuthClient.auth.signUp({ email: normalized.email, password });
    if (signUpError && !String(signUpError.message || "").toLowerCase().includes("already")) console.warn(signUpError);
    const payload = { email: normalized.email, nome, setor, motivo, status:"pending", requested_at: smcNowIso(), rejection_reason:null };
    const { error: requestError } = await smcAuthClient.from("access_requests").insert(payload);
    if (requestError) throw requestError;
    if (passwordInput) passwordInput.value = "";
    await smcLogAudit("access_request_created", normalized.email, `Setor: ${setor}`);
    msg.textContent = "Solicitação enviada com sucesso. Aguarde aprovação de um administrador.";
    msg.classList.add("ok");
  } catch (error) {
    msg.textContent = error?.code === "23505" ? "Sua solicitação de acesso já foi enviada e está aguardando aprovação." : "Falha ao enviar solicitação: " + (error?.message || error);
    msg.classList.add("err");
  } finally { btn.disabled = false; }
}

function smcTagPerfil(p){
  if (p === "master") return '<span class="smc-user-tag smc-user-master">Master</span>';
  if (p === "admin") return '<span class="smc-user-tag smc-user-admin">Admin</span>';
  return '<span class="smc-user-tag smc-user-usuario">Usuário comum</span>';
}
function smcTagStatusRequest(s){
  if (s === "pending") return '<span class="smc-user-tag smc-user-pending">Pendente</span>';
  if (s === "approved") return '<span class="smc-user-tag smc-user-admin">Aprovado</span>';
  if (s === "rejected") return '<span class="smc-user-tag smc-user-inativo">Recusado</span>';
  return smcEsc(s || "-");
}

function smcAbrirGerenciarAcessos(){
  if (!smcPodeAdministrar()) { alert("Você não tem permissão para executar esta ação."); return; }
  smcAbrirTelaInterna("Gerenciar Acessos", "Aprovação de solicitações e administração de usuários dentro da SPA.", `
    <section class="smc-spa-card"><div class="smc-users-stats"><div class="smc-users-stat"><strong id="smcStReqPendentes">0</strong><span>Solicitações pendentes</span></div><div class="smc-users-stat"><strong id="smcStTotal">0</strong><span>Usuários</span></div><div class="smc-users-stat"><strong id="smcStAtivos">0</strong><span>Ativos</span></div><div class="smc-users-stat"><strong id="smcStAdmins">0</strong><span>Admins/Masters</span></div></div><div class="smc-users-toolbar"><input id="smcUsuariosBusca" placeholder="Buscar por nome ou e-mail"><select id="smcUsuariosPerfil"><option value="">Todos os perfis</option><option value="master">Master</option><option value="admin">Admin</option><option value="usuario">Usuário comum</option></select><select id="smcUsuariosAtivo"><option value="">Todos</option><option value="true">Ativos</option><option value="false">Bloqueados</option></select><button type="button" id="smcUsuariosAtualizarBtn">Atualizar</button></div></section>
    <section class="smc-spa-card"><h3>Solicitações pendentes</h3><div class="smc-users-tablewrap" id="smcAccessRequestsTabela"><div class="smc-users-empty">Carregando solicitações...</div></div></section>
    <section class="smc-spa-card"><h3>Usuários aprovados</h3><div class="smc-users-tablewrap" id="smcUsuariosTabela"><div class="smc-users-empty">Carregando usuários...</div></div></section>`);
  smcBind("smcUsuariosBusca", "input", smcRenderGerenciarAcessos);
  smcBind("smcUsuariosPerfil", "change", smcRenderGerenciarAcessos);
  smcBind("smcUsuariosAtivo", "change", smcRenderGerenciarAcessos);
  smcBind("smcUsuariosAtualizarBtn", "click", smcCarregarGerenciarAcessos);
  smcCarregarGerenciarAcessos();
}

async function smcCarregarGerenciarAcessos(){
  const tabelaReq = document.getElementById("smcAccessRequestsTabela");
  const tabelaUsers = document.getElementById("smcUsuariosTabela");
  if (tabelaReq) tabelaReq.innerHTML = '<div class="smc-users-empty">Carregando solicitações...</div>';
  if (tabelaUsers) tabelaUsers.innerHTML = '<div class="smc-users-empty">Carregando usuários...</div>';
  try {
    const [req, users] = await Promise.all([
      smcAuthClient.from("access_requests").select("id,email,nome,setor,motivo,status,requested_at,reviewed_at,reviewed_by,rejection_reason").order("requested_at", { ascending:false }),
      smcAuthClient.from("usuarios_smc").select("nome,email,perfil,ativo,criado_em,atualizado_em").order("perfil", { ascending:true }).order("nome", { ascending:true })
    ]);
    if (req.error) throw req.error;
    if (users.error) throw users.error;
    smcAccessRequestsRows = req.data || [];
    smcUsuariosRows = users.data || [];
    smcRenderGerenciarAcessos();
  } catch (error) {
    const msg = `<div class="smc-users-empty">Falha ao carregar dados: ${smcEsc(error.message)}. Verifique se o SQL de acesso foi executado no Supabase.</div>`;
    if (tabelaReq) tabelaReq.innerHTML = msg;
    if (tabelaUsers) tabelaUsers.innerHTML = msg;
  }
}

function smcRenderGerenciarAcessos(){
  const total = document.getElementById("smcStTotal");
  const ativos = document.getElementById("smcStAtivos");
  const admins = document.getElementById("smcStAdmins");
  const pendentes = document.getElementById("smcStReqPendentes");
  if (total) total.textContent = smcUsuariosRows.length;
  if (ativos) ativos.textContent = smcUsuariosRows.filter(r => r.ativo !== false).length;
  if (admins) admins.textContent = smcUsuariosRows.filter(r => ["master", "admin"].includes(r.perfil)).length;
  if (pendentes) pendentes.textContent = smcAccessRequestsRows.filter(r => r.status === "pending").length;
  smcRenderAccessRequestsTabela();
  smcRenderUsuariosTabela();
}

function smcRenderAccessRequestsTabela(){
  const tabela = document.getElementById("smcAccessRequestsTabela");
  if (!tabela) return;
  const rows = smcAccessRequestsRows.filter(r => r.status === "pending");
  if (!rows.length) { tabela.innerHTML = '<div class="smc-users-empty">Nenhuma solicitação pendente.</div>'; return; }
  tabela.innerHTML = `<table class="smc-users-table"><thead><tr><th>Solicitante</th><th>Setor</th><th>Motivo</th><th>Data</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${smcEsc(r.nome || "-")}</strong><span class="smc-muted">${smcEsc(r.email)}</span></td><td>${smcEsc(r.setor || "-")}</td><td>${smcEsc(r.motivo || "-")}</td><td>${r.requested_at ? new Date(r.requested_at).toLocaleString("pt-BR") : "-"}</td><td>${smcTagStatusRequest(r.status)}</td><td><div class="smc-access-action"><button class="smc-mini-btn ok" onclick="smcAprovarAcesso('${smcJs(r.id)}')">Aprovar</button><button class="smc-mini-btn danger" onclick="smcRecusarAcesso('${smcJs(r.id)}')">Recusar</button></div></td></tr>`).join("")}</tbody></table>`;
}

function smcRenderUsuariosTabela(){
  const tabela = document.getElementById("smcUsuariosTabela");
  if (!tabela) return;
  const busca = (document.getElementById("smcUsuariosBusca")?.value || "").toLowerCase();
  const perfil = document.getElementById("smcUsuariosPerfil")?.value || "";
  const ativo = document.getElementById("smcUsuariosAtivo")?.value || "";
  const list = smcUsuariosRows.filter(r => {
    const texto = `${r.nome || ""} ${r.email || ""}`.toLowerCase();
    return (!busca || texto.includes(busca)) && (!perfil || r.perfil === perfil) && (!ativo || String(r.ativo !== false) === ativo);
  });
  if (!list.length) { tabela.innerHTML = '<div class="smc-users-empty">Nenhum usuário encontrado.</div>'; return; }
  tabela.innerHTML = `<table class="smc-users-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Criado em</th><th>Ações</th></tr></thead><tbody>${list.map(r => `<tr><td>${smcEsc(r.nome || "-")}</td><td>${smcEsc(r.email)}</td><td>${smcRoleCell(r)}</td><td>${r.ativo !== false ? "Ativo" : '<span class="smc-user-tag smc-user-inativo">Bloqueado</span>'}</td><td>${r.criado_em ? new Date(r.criado_em).toLocaleString("pt-BR") : "-"}</td><td>${smcUserActions(r)}</td></tr>`).join("")}</tbody></table>`;
}

function smcRoleCell(r){
  if (!smcIsMaster() || r.email === smcUser?.email) return smcTagPerfil(r.perfil);
  return `<div class="smc-access-action"><select onchange="smcAlterarPerfil('${smcJs(r.email)}',this.value)"><option value="usuario" ${r.perfil === "usuario" ? "selected" : ""}>Usuário</option><option value="admin" ${r.perfil === "admin" ? "selected" : ""}>Admin</option><option value="master" ${r.perfil === "master" ? "selected" : ""}>Master</option></select></div>`;
}

function smcUserActions(r){
  if (r.email === smcUser?.email) return '<span class="smc-muted">Próprio usuário</span>';
  if (!smcIsMaster() && ["master", "admin"].includes(r.perfil)) return '<span class="smc-muted">Sem permissão</span>';
  if (r.ativo === false) return `<button class="smc-mini-btn ok" onclick="smcAlterarAtivo('${smcJs(r.email)}',true)">Desbloquear</button>`;
  return `<button class="smc-mini-btn danger" onclick="smcAlterarAtivo('${smcJs(r.email)}',false)">Bloquear</button>`;
}

async function smcAprovarAcesso(id){
  const req = smcAccessRequestsRows.find(r => String(r.id) === String(id));
  if (!req) return;
  const email = String(req.email || "").trim().toLowerCase();
  if (!email.endsWith(SMC_DOMAIN)) { alert("Acesso permitido apenas para e-mails corporativos da Global Eletronics."); return; }
  if (email === smcUser?.email) { alert("Você não pode aprovar a própria solicitação."); return; }
  if (!confirm(`Aprovar acesso para ${email}?`)) return;
  try {
    const { error: userError } = await smcAuthClient.from("usuarios_smc").upsert({ nome:req.nome || email, email, perfil:"usuario", ativo:true }, { onConflict:"email" });
    if (userError) throw userError;
    const { error: reqError } = await smcAuthClient.from("access_requests").update({ status:"approved", reviewed_by:smcUser?.email || null, reviewed_at:smcNowIso(), rejection_reason:null }).eq("id", id);
    if (reqError) throw reqError;
    await smcLogAudit("access_request_approved", email, "Solicitação aprovada");
    await smcCarregarGerenciarAcessos();
  } catch (error) { alert("Falha ao aprovar: " + (error.message || error)); }
}

async function smcRecusarAcesso(id){
  const req = smcAccessRequestsRows.find(r => String(r.id) === String(id));
  if (!req) return;
  if (String(req.email || "").toLowerCase() === String(smcUser?.email || "").toLowerCase()) { alert("Você não pode recusar a própria solicitação."); return; }
  const reason = prompt("Informe o motivo da recusa:");
  if (reason === null) return;
  try {
    const { error } = await smcAuthClient.from("access_requests").update({ status:"rejected", reviewed_by:smcUser?.email || null, reviewed_at:smcNowIso(), rejection_reason:reason || "Recusado pelo administrador" }).eq("id", id);
    if (error) throw error;
    await smcLogAudit("access_request_rejected", req.email, reason || "Recusado");
    await smcCarregarGerenciarAcessos();
  } catch (error) { alert("Falha ao recusar: " + (error.message || error)); }
}

async function smcAlterarAtivo(email, ativo){
  email = String(email || "").toLowerCase();
  const alvo = smcUsuariosRows.find(r => String(r.email).toLowerCase() === email);
  if (!alvo) return;
  if (email === smcUser?.email) { alert("Você não pode bloquear/desbloquear a si mesmo."); return; }
  if (!smcIsMaster() && ["master", "admin"].includes(alvo.perfil)) { alert("Você não tem permissão para executar esta ação."); return; }
  if (!confirm(`${ativo ? "Desbloquear" : "Bloquear"} ${email}?`)) return;
  try {
    const { error } = await smcAuthClient.from("usuarios_smc").update({ ativo }).eq("email", email);
    if (error) throw error;
    await smcLogAudit(ativo ? "user_unblocked" : "user_blocked", email, ativo ? "Usuário desbloqueado" : "Usuário bloqueado");
    await smcCarregarGerenciarAcessos();
  } catch (error) { alert("Falha ao alterar status: " + (error.message || error)); }
}

async function smcAlterarPerfil(email, perfil){
  email = String(email || "").toLowerCase();
  if (!smcIsMaster()) { alert("Somente master pode alterar perfil."); await smcCarregarGerenciarAcessos(); return; }
  if (email === smcUser?.email) { alert("Você não pode alterar sua própria role."); await smcCarregarGerenciarAcessos(); return; }
  const alvo = smcUsuariosRows.find(r => String(r.email).toLowerCase() === email);
  if (!alvo) return;
  if (alvo.perfil === "master" && perfil !== "master") {
    const mastersAtivos = smcUsuariosRows.filter(r => r.perfil === "master" && r.ativo !== false).length;
    if (mastersAtivos <= 1) { alert("Não é permitido remover o último master ativo."); await smcCarregarGerenciarAcessos(); return; }
  }
  try {
    const { error } = await smcAuthClient.from("usuarios_smc").update({ perfil }).eq("email", email);
    if (error) throw error;
    await smcLogAudit("role_changed", email, `Novo perfil: ${perfil}`);
    await smcCarregarGerenciarAcessos();
  } catch (error) { alert("Falha ao alterar perfil: " + (error.message || error)); await smcCarregarGerenciarAcessos(); }
}

async function smcLogin(){
  const rawUser = document.getElementById("smcLoginUsuario")?.value.trim();
  const normalized = smcNormalizarUsuario(rawUser);
  const password = document.getElementById("smcLoginSenha")?.value;
  const msg = document.getElementById("smcLoginMsg");
  if (!msg) return;
  msg.className = "smc-auth-msg";
  if (!normalized.ok) { msg.textContent = normalized.message; msg.classList.add("err"); await smcLogAudit("login_blocked_invalid_domain", rawUser, normalized.message); return; }
  if (!password) { msg.textContent = "Informe a senha."; msg.classList.add("err"); return; }
  msg.textContent = "Validando acesso...";
  const { error } = await smcAuthClient.auth.signInWithPassword({ email: normalized.email, password });
  if (error) { msg.textContent = smcMensagemAuth(error); msg.classList.add("err"); return; }
  msg.textContent = "Login realizado. Validando permissão...";
  msg.classList.add("ok");
}

function smcContinuarPublico(event){
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("smcAuthOverlay")?.remove();
  document.getElementById("smcAuthBox")?.remove();
  smcSetBodyLock();
}

async function smcLogout(){
  smcFecharTelaInterna();
  await smcAuthClient.auth.signOut();
}

function smcAuthHeader(){
  return smcSession?.access_token ? { Authorization: `Bearer ${smcSession.access_token}` } : {};
}

smcInitAuth().catch(e => {
  console.error("Falha fatal no Auth:", e);
  document.body.classList.remove("smc-auth-locked");
});
