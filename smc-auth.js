// SMC – System of Improvement and Correction
// Base de login com Supabase Auth.
// Perfis: master, admin e usuario.

const SMC_SUPABASE_URL = "https://quqqcudiyhajbmtrebvr.supabase.co";
const SMC_SUPABASE_KEY = "sb_publishable_X3m3BdRtfzaH4c12ehjkMw_VsqiZGJG";
const SMC_API = "https://quqqcudiyhajbmtrebvr.functions.supabase.co/solicitacoes-api";
const SMC_MASTER_EMAIL = "trainee.processo@globaleletronics.ind.br";

let smcAuthClient = null;
let smcSession = null;
let smcUser = null;
let smcPerfil = "publico";
let smcUsuarioInterno = null;

function smcLoadSupabaseClient(){
  return new Promise((resolve, reject) => {
    if (window.supabase) return resolve(window.supabase);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error("Falha ao carregar Supabase Auth."));
    document.head.appendChild(s);
  });
}

async function smcInitAuth(){
  const lib = await smcLoadSupabaseClient();
  smcAuthClient = lib.createClient(SMC_SUPABASE_URL, SMC_SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const { data } = await smcAuthClient.auth.getSession();
  smcSession = data.session || null;
  smcUser = smcSession?.user || null;
  await smcAtualizarPerfil();
  smcRenderLoginBox();
  smcAplicarPermissoesVisuais();
  smcAuthClient.auth.onAuthStateChange(async (_event, session) => {
    smcSession = session || null;
    smcUser = smcSession?.user || null;
    await smcAtualizarPerfil();
    smcRenderLoginBox();
    smcAplicarPermissoesVisuais();
    if (typeof loadSolicitacoes === "function") loadSolicitacoes();
  });
}

async function smcAtualizarPerfil(){
  smcPerfil = "publico";
  smcUsuarioInterno = null;
  if (!smcUser?.email) return;
  const email = smcUser.email.toLowerCase();
  if (email === SMC_MASTER_EMAIL.toLowerCase()) {
    smcPerfil = "master";
  }
  try {
    const { data } = await smcAuthClient
      .from("usuarios_smc")
      .select("nome,email,perfil,ativo")
      .eq("email", smcUser.email)
      .eq("ativo", true)
      .maybeSingle();
    if (data) {
      smcUsuarioInterno = data;
      smcPerfil = data.perfil || smcPerfil || "usuario";
    } else if (smcPerfil !== "master") {
      smcPerfil = "usuario";
    }
  } catch (_err) {
    if (smcPerfil !== "master") smcPerfil = "usuario";
  }
}

function smcPodeAdministrar(){
  return smcPerfil === "master" || smcPerfil === "admin";
}

function smcPodeGerenciarUsuarios(){
  return smcPerfil === "master";
}

function smcAplicarPermissoesVisuais(){
  document.querySelectorAll("[data-smc-admin]").forEach(el => {
    el.style.display = smcPodeAdministrar() ? "" : "none";
  });
  document.querySelectorAll("[data-smc-master]").forEach(el => {
    el.style.display = smcPodeGerenciarUsuarios() ? "" : "none";
  });
  document.querySelectorAll(".adminOnly").forEach(el => {
    el.classList.toggle("hidden", !smcPodeAdministrar());
  });
  document.querySelectorAll(".masterOnly").forEach(el => {
    el.classList.toggle("hidden", !smcPodeGerenciarUsuarios());
  });
}

function smcRenderLoginBox(){
  let box = document.getElementById("smcAuthBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "smcAuthBox";
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;background:#102540;border:1px solid #24425f;border-radius:14px;padding:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);color:#f4f8ff;font-family:Arial;min-width:260px";
    document.body.appendChild(box);
  }
  if (smcUser) {
    box.innerHTML = `<strong>SMC conectado</strong><br><small>${smcUser.email}</small><br><small>Perfil: ${smcPerfil}</small><br><button onclick="smcLogout()" style="margin-top:10px">Sair</button>`;
  } else {
    box.innerHTML = `<strong>Login SMC</strong><br><small>Entre ou continue sem login para abrir e acompanhar chamados.</small><br><input id="smcLoginEmail" placeholder="e-mail" style="margin-top:8px;width:100%"><input id="smcLoginSenha" type="password" placeholder="senha" style="margin-top:6px;width:100%"><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button onclick="smcLogin()">Entrar</button><button onclick="smcCriarConta()">Criar conta</button><button onclick="smcContinuarPublico()">Continuar sem login</button></div><small id="smcLoginMsg"></small>`;
  }
}

async function smcLogin(){
  const email = document.getElementById("smcLoginEmail").value.trim();
  const password = document.getElementById("smcLoginSenha").value;
  const msg = document.getElementById("smcLoginMsg");
  msg.textContent = "Entrando...";
  const { error } = await smcAuthClient.auth.signInWithPassword({ email, password });
  msg.textContent = error ? error.message : "Login realizado.";
}

async function smcCriarConta(){
  const email = document.getElementById("smcLoginEmail").value.trim();
  const password = document.getElementById("smcLoginSenha").value;
  const msg = document.getElementById("smcLoginMsg");
  msg.textContent = "Criando conta...";
  const { error } = await smcAuthClient.auth.signUp({ email, password });
  msg.textContent = error ? error.message : "Conta criada. Se pedir confirmação, verifique o e-mail.";
}

function smcContinuarPublico(){
  const box = document.getElementById("smcAuthBox");
  if (box) box.style.display = "none";
}

async function smcLogout(){
  await smcAuthClient.auth.signOut();
}

function smcAuthHeader(){
  return smcSession?.access_token ? { Authorization: `Bearer ${smcSession.access_token}` } : {};
}

smcInitAuth().catch(console.error);
