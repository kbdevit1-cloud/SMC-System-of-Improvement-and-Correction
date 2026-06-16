// SMC – System of Improvement and Correction
// Tela profissional de acesso com Supabase Auth.
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
let smcModoCadastro = false;

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

function smcInstallStyle(){
  if (document.getElementById("smcAuthStyle")) return;
  const st = document.createElement("style");
  st.id = "smcAuthStyle";
  st.textContent = `
    .smc-auth-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(circle at 18% 18%,rgba(47,128,237,.18),transparent 32%),radial-gradient(circle at 80% 8%,rgba(34,197,94,.10),transparent 28%),rgba(3,8,17,.86);backdrop-filter:blur(10px)}
    .smc-auth-shell{width:min(1040px,100%);min-height:560px;display:grid;grid-template-columns:1.05fr .95fr;border:1px solid rgba(120,170,220,.24);border-radius:24px;overflow:hidden;background:linear-gradient(135deg,rgba(9,24,43,.98),rgba(12,31,54,.96));box-shadow:0 28px 90px rgba(0,0,0,.55)}
    .smc-auth-brand{position:relative;padding:38px;display:flex;flex-direction:column;justify-content:space-between;border-right:1px solid rgba(255,255,255,.08);background:radial-gradient(circle at 80% 15%,rgba(47,128,237,.22),transparent 34%),linear-gradient(180deg,rgba(16,37,64,.90),rgba(7,17,31,.95))}
    .smc-auth-brand:after{content:"";position:absolute;inset:auto -90px -90px auto;width:240px;height:240px;border-radius:50%;background:rgba(47,128,237,.14);filter:blur(2px)}
    .smc-auth-kicker{display:inline-flex;align-items:center;gap:8px;width:max-content;border:1px solid rgba(112,168,240,.38);background:rgba(47,128,237,.12);border-radius:999px;padding:8px 12px;color:#d9ecff;font:800 12px Arial,Helvetica,sans-serif;letter-spacing:.2px}
    .smc-auth-brand h2{margin:22px 0 12px;color:#fff;font:900 34px/1.05 Arial,Helvetica,sans-serif;letter-spacing:-.7px}
    .smc-auth-brand p{max-width:520px;margin:0;color:#c7d7ea;font:400 14px/1.65 Arial,Helvetica,sans-serif}
    .smc-auth-flow{display:grid;gap:12px;margin-top:28px;position:relative;z-index:1}.smc-auth-flow div{display:flex;gap:12px;align-items:flex-start;padding:13px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(3,9,18,.36)}
    .smc-auth-flow b{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:10px;background:rgba(47,128,237,.22);color:#dceeff;font:900 12px Arial}.smc-auth-flow strong{display:block;color:#fff;font:800 13px Arial;margin-bottom:3px}.smc-auth-flow span{display:block;color:#aebfd3;font:400 11px/1.4 Arial}
    .smc-auth-foot{position:relative;z-index:1;color:#9fb2c8;font:400 11px/1.5 Arial;margin-top:28px}.smc-auth-panel{padding:38px;display:flex;flex-direction:column;justify-content:center;background:rgba(7,17,31,.72)}
    .smc-auth-panel h3{margin:0 0 7px;color:#fff;font:900 25px/1.1 Arial,Helvetica,sans-serif}.smc-auth-panel p{margin:0 0 22px;color:#b8c9de;font:400 13px/1.55 Arial}
    .smc-auth-form{display:grid;gap:13px}.smc-auth-field label{display:block;margin:0 0 7px;color:#dce8f7;font:800 12px Arial}.smc-auth-field input{width:100%;height:46px;border-radius:12px;border:1px solid rgba(113,154,204,.28);background:rgba(3,9,18,.55);color:#fff;padding:0 14px;outline:none;font:500 14px Arial}.smc-auth-field input:focus{border-color:#2f80ed;box-shadow:0 0 0 4px rgba(47,128,237,.16)}
    .smc-auth-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}.smc-auth-actions button,.smc-public-btn{height:44px;border:0;border-radius:12px;font:900 13px Arial;cursor:pointer;transition:.16s ease}.smc-auth-actions button:hover,.smc-public-btn:hover{transform:translateY(-1px);filter:brightness(1.06)}.smc-login-btn{background:#2f80ed;color:#fff}.smc-create-btn{background:rgba(255,255,255,.08);color:#edf6ff;border:1px solid rgba(255,255,255,.13)!important}.smc-public-btn{width:100%;margin-top:10px;background:transparent;color:#bcd0e7;border:1px solid rgba(188,208,231,.24)!important}
    .smc-auth-msg{min-height:18px;margin-top:12px;color:#d8e8fa;font:700 12px Arial}.smc-auth-note{margin-top:18px;padding:12px;border-radius:12px;background:rgba(47,128,237,.10);border:1px solid rgba(47,128,237,.24);color:#bfd4ec;font:400 12px/1.45 Arial}.smc-auth-note strong{color:#fff}.smc-auth-close{position:absolute;right:18px;top:18px;width:36px;height:36px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font:900 18px Arial}
    .smc-session-pill{position:fixed;right:18px;bottom:18px;z-index:99998;display:flex;align-items:center;gap:10px;max-width:min(420px,calc(100vw - 36px));padding:10px 12px;border-radius:16px;border:1px solid rgba(120,170,220,.28);background:rgba(9,24,43,.96);box-shadow:0 18px 50px rgba(0,0,0,.35);color:#fff;font-family:Arial}.smc-session-pill small{display:block;color:#aebfd3;font-size:11px}.smc-session-pill strong{font-size:13px}.smc-session-pill button{border:0;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;padding:8px 10px;font-weight:800;cursor:pointer}
    @media(max-width:820px){.smc-auth-overlay{align-items:flex-start;overflow:auto}.smc-auth-shell{grid-template-columns:1fr;min-height:auto}.smc-auth-brand{padding:26px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08)}.smc-auth-brand h2{font-size:28px}.smc-auth-panel{padding:26px}.smc-auth-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(st);
}

async function smcInitAuth(){
  smcInstallStyle();
  const lib = await smcLoadSupabaseClient();
  smcAuthClient = lib.createClient(SMC_SUPABASE_URL, SMC_SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
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
    if (typeof loadSolicitacoes === "function") loadSolicitacoes();
  });
}

async function smcAtualizarPerfil(){
  smcPerfil = "publico";
  smcUsuarioInterno = null;
  if (!smcUser?.email) return;
  const email = smcUser.email.toLowerCase();
  if (email === SMC_MASTER_EMAIL.toLowerCase()) smcPerfil = "master";
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

function smcPodeAdministrar(){ return smcPerfil === "master" || smcPerfil === "admin"; }
function smcPodeGerenciarUsuarios(){ return smcPerfil === "master"; }

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
  if (smcUser) return smcRenderSessao();
  smcRenderLoginProfissional();
}

function smcRenderLoginProfissional(){
  const overlay = document.createElement("div");
  overlay.id = "smcAuthOverlay";
  overlay.className = "smc-auth-overlay";
  overlay.innerHTML = `
    <section class="smc-auth-shell" role="dialog" aria-modal="true" aria-label="Acesso ao SMC">
      <button class="smc-auth-close" onclick="smcContinuarPublico()" title="Continuar sem login">×</button>
      <div class="smc-auth-brand">
        <div>
          <div class="smc-auth-kicker">SMC • Acesso seguro</div>
          <h2>System of Improvement and Correction</h2>
          <p>Canal de registro, acompanhamento e controle de melhorias, correções e ações internas. O acesso público permite abrir e acompanhar chamados; contas autorizadas liberam funções administrativas.</p>
          <div class="smc-auth-flow">
            <div><b>1</b><span><strong>Abrir chamado</strong><span>Registro rápido para fábrica, ADM ou outro setor.</span></span></div>
            <div><b>2</b><span><strong>Acompanhar status</strong><span>Visualização geral de recebido, análise, execução e conclusão.</span></span></div>
            <div><b>3</b><span><strong>Gestão ADM</strong><span>Master e admins podem editar, excluir, alterar status e exportar backup.</span></span></div>
          </div>
        </div>
        <div class="smc-auth-foot">Master principal: ${SMC_MASTER_EMAIL}</div>
      </div>
      <div class="smc-auth-panel">
        <h3>${smcModoCadastro ? "Criar conta" : "Entrar no SMC"}</h3>
        <p>${smcModoCadastro ? "Crie sua conta para futura liberação de acesso. O master define o perfil depois." : "Acesse com sua conta para liberar permissões conforme seu perfil."}</p>
        <div class="smc-auth-form">
          <div class="smc-auth-field"><label>E-mail</label><input id="smcLoginEmail" type="email" placeholder="nome@globaleletronics.ind.br" autocomplete="email"></div>
          <div class="smc-auth-field"><label>Senha</label><input id="smcLoginSenha" type="password" placeholder="Digite sua senha" autocomplete="current-password"></div>
          <div class="smc-auth-actions">
            <button class="smc-login-btn" onclick="${smcModoCadastro ? "smcCriarConta()" : "smcLogin()"}">${smcModoCadastro ? "Criar conta" : "Entrar"}</button>
            <button class="smc-create-btn" onclick="smcAlternarCadastro()">${smcModoCadastro ? "Já tenho conta" : "Criar conta"}</button>
          </div>
          <button class="smc-public-btn" onclick="smcContinuarPublico()">Continuar sem login</button>
          <div class="smc-auth-msg" id="smcLoginMsg"></div>
          <div class="smc-auth-note"><strong>Sem login:</strong> você pode abrir, acompanhar e complementar chamados com protocolo + chave. <strong>Com login:</strong> permissões são liberadas automaticamente.</div>
        </div>
      </div>
    </section>`;
  document.body.appendChild(overlay);
}

function smcRenderSessao(){
  const pill = document.createElement("div");
  pill.id = "smcSessionPill";
  pill.className = "smc-session-pill";
  pill.innerHTML = `<div><strong>SMC conectado</strong><small>${smcUser.email} • Perfil: ${smcPerfil}</small></div><button onclick="smcLogout()">Sair</button>`;
  document.body.appendChild(pill);
}

function smcAlternarCadastro(){
  smcModoCadastro = !smcModoCadastro;
  smcRenderLoginProfissional();
}

async function smcLogin(){
  const email = document.getElementById("smcLoginEmail").value.trim();
  const password = document.getElementById("smcLoginSenha").value;
  const msg = document.getElementById("smcLoginMsg");
  if (!email || !password) { msg.textContent = "Informe e-mail e senha."; return; }
  msg.textContent = "Validando acesso...";
  const { error } = await smcAuthClient.auth.signInWithPassword({ email, password });
  msg.textContent = error ? error.message : "Login realizado.";
}

async function smcCriarConta(){
  const email = document.getElementById("smcLoginEmail").value.trim();
  const password = document.getElementById("smcLoginSenha").value;
  const msg = document.getElementById("smcLoginMsg");
  if (!email || !password) { msg.textContent = "Informe e-mail e senha."; return; }
  msg.textContent = "Criando conta...";
  const { error } = await smcAuthClient.auth.signUp({ email, password });
  msg.textContent = error ? error.message : "Conta criada. Se pedir confirmação, verifique o e-mail.";
}

function smcContinuarPublico(){
  document.getElementById("smcAuthOverlay")?.remove();
  document.getElementById("smcAuthBox")?.remove();
}

async function smcLogout(){ await smcAuthClient.auth.signOut(); }
function smcAuthHeader(){ return smcSession?.access_token ? { Authorization: `Bearer ${smcSession.access_token}` } : {}; }

smcInitAuth().catch(console.error);
