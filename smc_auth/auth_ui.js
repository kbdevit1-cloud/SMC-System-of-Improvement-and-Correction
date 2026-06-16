const SESSION_KEY = 'smc_auth_token';

function normalizeUsuario(raw) {
  let value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!value) return { ok: false, message: 'Informe seu usuário corporativo.' };
  if (value.includes('@')) {
    const [local, ...domainParts] = value.split('@');
    const domain = '@' + domainParts.join('@');
    if (domain !== '@globaleletronics.ind.br') {
      return { ok: false, message: 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.' };
    }
    value = local;
  }
  if (!/^[a-z0-9._-]{2,80}$/.test(value)) return { ok: false, message: 'Usuário corporativo inválido.' };
  return { ok: true, usuario: value };
}

class SMCAuthUI {
  constructor({ root, api, onAuthenticated } = {}) {
    this.root = root || document.getElementById('app');
    this.api = api || window.pywebview?.api;
    this.onAuthenticated = onAuthenticated;
  }

  token() { return sessionStorage.getItem(SESSION_KEY); }
  setToken(token) { if (token) sessionStorage.setItem(SESSION_KEY, token); }
  clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  showLogin(message = '') {
    this.root.innerHTML = `
      <section class="auth-shell">
        <div class="auth-card">
          <h1>Acesso interno</h1>
          <p>Digite apenas seu usuário corporativo.</p>
          <form data-login-form autocomplete="off">
            <input name="usuario" type="text" placeholder="Digite seu usuário corporativo" autocomplete="off" required>
            <div data-msg>${message}</div>
            <button type="submit">Entrar</button>
            <button type="button" data-request>Solicitar acesso</button>
          </form>
        </div>
      </section>`;

    const form = this.root.querySelector('[data-login-form]');
    const msg = this.root.querySelector('[data-msg]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const normalized = normalizeUsuario(form.usuario.value);
      if (!normalized.ok) { msg.textContent = normalized.message; return; }
      const result = await this.api.login(normalized.usuario);
      if (!result?.ok) { msg.textContent = result?.message || 'Acesso negado.'; return; }
      this.setToken(result.session?.token);
      if (typeof this.onAuthenticated === 'function') this.onAuthenticated(result.user, result.session);
    });
    this.root.querySelector('[data-request]').addEventListener('click', () => this.showRequestAccess(form.usuario.value));
  }

  showRequestAccess(initialUser = '') {
    const normalized = normalizeUsuario(initialUser);
    const userValue = normalized.ok ? normalized.usuario : '';
    this.root.innerHTML = `
      <section class="auth-shell">
        <div class="auth-card">
          <h1>Solicitar acesso</h1>
          <form data-request-form autocomplete="off">
            <input name="nome" type="text" placeholder="Nome" required>
            <input name="usuario" type="text" placeholder="Digite seu usuário corporativo" value="${userValue}" required>
            <input name="setor" type="text" placeholder="Setor">
            <input name="observacao" type="text" placeholder="Motivo do acesso">
            <div data-msg></div>
            <button type="submit">Enviar solicitação</button>
            <button type="button" data-back>Voltar</button>
          </form>
        </div>
      </section>`;
    const form = this.root.querySelector('[data-request-form]');
    const msg = this.root.querySelector('[data-msg]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const normalized = normalizeUsuario(form.usuario.value);
      if (!normalized.ok) { msg.textContent = normalized.message; return; }
      const result = await this.api.request_access(form.nome.value, normalized.usuario, form.setor.value, form.observacao.value);
      msg.textContent = result?.message || 'Solicitação processada.';
    });
    this.root.querySelector('[data-back]').addEventListener('click', () => this.showLogin());
  }

  async guard(loader) {
    const token = this.token();
    if (!token) { this.showLogin('Sessão inválida ou expirada.'); return false; }
    const result = await this.api.get_current_user(token);
    if (!result?.ok) { this.clearSession(); this.showLogin('Sessão inválida ou expirada.'); return false; }
    if (typeof loader === 'function') loader(result.user);
    return true;
  }

  async logout() {
    const token = this.token();
    if (token) await this.api.logout(token);
    this.clearSession();
    this.showLogin();
  }
}

export { SMCAuthUI, normalizeUsuario, SESSION_KEY };
