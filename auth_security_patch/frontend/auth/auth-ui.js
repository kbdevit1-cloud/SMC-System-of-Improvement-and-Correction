/*
  Componente SPA de autenticação corporativa.
  - Não abre nova janela.
  - Não cria outro WebView.
  - Não mostra @globaleletronics.ind.br na tela.
  - Guarda token apenas em sessionStorage.
  - Só libera sessão quando o e-mail existir na tabela usuarios e estiver aprovado.
*/

const CORPORATE_DOMAIN = '@globaleletronics.ind.br';
const SESSION_KEY = 'global_auth_session_token';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeUserInput(rawValue) {
  let value = String(rawValue ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!value) {
    return { ok: false, message: 'Informe seu usuário corporativo.' };
  }

  if (value.includes('@')) {
    const [local, ...domainParts] = value.split('@');
    const domain = `@${domainParts.join('@')}`;
    if (domain !== CORPORATE_DOMAIN) {
      return {
        ok: false,
        code: 'invalid_domain',
        message: 'Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.',
      };
    }
    value = local;
  }

  if (!/^[a-z0-9._-]{2,80}$/.test(value)) {
    return {
      ok: false,
      message: 'Usuário corporativo inválido. Use apenas letras, números, ponto, hífen ou underline.',
    };
  }

  return { ok: true, usuario: value };
}

function defaultApi() {
  if (window.pywebview && window.pywebview.api) return window.pywebview.api;
  return {
    async login(usuario) {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario }),
      });
      return response.json();
    },
    async request_access(nome, usuario, setor, observacao) {
      const response = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, usuario, setor, observacao }),
      });
      return response.json();
    },
    async get_current_user(token) {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return { ok: false, authenticated: false, message: 'Sessão inválida ou expirada.' };
      return response.json();
    },
    async logout(token) {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      return response.ok ? response.json() : { ok: true };
    },
    async list_users(token, status = null, perfil = null, setor = null) {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (perfil) params.set('perfil', perfil);
      if (setor) params.set('setor', setor);
      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json();
    },
    async approve_user(token, target_email, observacao = '') {
      const response = await fetch('/api/admin/users/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_email, observacao }),
      });
      return response.json();
    },
    async block_user(token, target_email, observacao = '') {
      const response = await fetch('/api/admin/users/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_email, observacao }),
      });
      return response.json();
    },
    async update_user_profile(token, target_email, perfil) {
      const response = await fetch('/api/admin/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_email, perfil }),
      });
      return response.json();
    },
  };
}

export class AuthUI {
  constructor({ root, api = null, onAuthenticated = null, onLogout = null } = {}) {
    this.root = root || document.getElementById('app');
    this.api = api || defaultApi();
    this.onAuthenticated = onAuthenticated;
    this.onLogout = onLogout;
    this.abortController = null;
    this.currentUser = null;
  }

  init() {
    this.showLogin();
  }

  cleanup() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.root) this.root.innerHTML = '';
  }

  getToken() {
    return sessionStorage.getItem(SESSION_KEY);
  }

  setToken(token) {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
  }

  clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    this.currentUser = null;
  }

  async restoreSession() {
    const token = this.getToken();
    if (!token) return false;
    const result = await this.api.get_current_user(token);
    if (!result?.ok) {
      this.clearSession();
      return false;
    }
    this.currentUser = result.user;
    return true;
  }

  async guard(loader) {
    const valid = await this.restoreSession();
    if (!valid) {
      this.showLogin('Sessão inválida ou expirada. Faça login novamente.');
      return false;
    }
    if (typeof loader === 'function') loader(this.currentUser);
    return true;
  }

  showMessage(message, type = 'info') {
    const box = this.root?.querySelector('[data-auth-message]');
    if (!box) return;
    box.className = `auth-message auth-message--${type}`;
    box.textContent = message || '';
    box.hidden = !message;
  }

  showLogin(initialMessage = '') {
    this.cleanup();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.root.innerHTML = `
      <section class="auth-shell" aria-label="Login corporativo">
        <div class="auth-card">
          <div class="auth-header">
            <span class="auth-kicker">Acesso interno</span>
            <h1>Login do sistema</h1>
            <p>Informe seu usuário corporativo para continuar.</p>
          </div>

          <form class="auth-form" data-auth-login-form autocomplete="off">
            <label for="auth-user">Usuário corporativo</label>
            <input
              id="auth-user"
              name="usuario"
              type="text"
              inputmode="email"
              autocomplete="off"
              spellcheck="false"
              placeholder="Digite seu usuário corporativo"
              required
            />

            <div data-auth-message class="auth-message" hidden></div>

            <button type="submit" class="auth-button auth-button--primary">Entrar</button>
            <button type="button" class="auth-button auth-button--ghost" data-auth-request-open>Solicitar acesso</button>
          </form>
        </div>
      </section>
    `;

    if (initialMessage) this.showMessage(initialMessage, 'error');

    const form = this.root.querySelector('[data-auth-login-form]');
    const requestButton = this.root.querySelector('[data-auth-request-open]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('input[name="usuario"]');
      const normalized = normalizeUserInput(input.value);
      if (!normalized.ok) {
        this.showMessage(normalized.message, 'error');
        return;
      }

      this.showMessage('Validando acesso...', 'info');
      const result = await this.api.login(normalized.usuario);

      if (!result?.ok) {
        this.showMessage(result?.message || 'Acesso negado.', 'error');
        if (result?.can_request_access) {
          requestButton.focus();
        }
        return;
      }

      this.setToken(result.session?.token);
      this.currentUser = result.user;
      this.showMessage(result.message || 'Acesso liberado.', 'success');

      if (typeof this.onAuthenticated === 'function') {
        this.onAuthenticated(result.user, result.session);
      }
    }, { signal });

    requestButton.addEventListener('click', () => {
      const input = this.root.querySelector('#auth-user');
      this.showRequestAccess(input?.value || '');
    }, { signal });
  }

  showRequestAccess(initialUser = '') {
    this.cleanup();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const normalized = normalizeUserInput(initialUser);
    const initialUsuario = normalized.ok ? normalized.usuario : '';

    this.root.innerHTML = `
      <section class="auth-shell" aria-label="Solicitação de acesso">
        <div class="auth-card auth-card--wide">
          <div class="auth-header">
            <span class="auth-kicker">Solicitação</span>
            <h1>Solicitar acesso</h1>
            <p>Preencha os dados abaixo. O acesso só será liberado após aprovação.</p>
          </div>

          <form class="auth-form" data-auth-request-form autocomplete="off">
            <div class="auth-grid">
              <div>
                <label for="request-name">Nome</label>
                <input id="request-name" name="nome" type="text" autocomplete="off" required />
              </div>
              <div>
                <label for="request-user">Usuário corporativo</label>
                <input id="request-user" name="usuario" type="text" autocomplete="off" spellcheck="false" placeholder="Digite seu usuário corporativo" value="${escapeHtml(initialUsuario)}" required />
              </div>
              <div>
                <label for="request-sector">Setor</label>
                <input id="request-sector" name="setor" type="text" autocomplete="off" placeholder="Exemplo: Engenharia" />
              </div>
              <div>
                <label for="request-note">Observação</label>
                <input id="request-note" name="observacao" type="text" autocomplete="off" placeholder="Motivo do acesso" />
              </div>
            </div>

            <div data-auth-message class="auth-message" hidden></div>

            <div class="auth-actions">
              <button type="submit" class="auth-button auth-button--primary">Enviar solicitação</button>
              <button type="button" class="auth-button auth-button--ghost" data-auth-back>Voltar</button>
            </div>
          </form>
        </div>
      </section>
    `;

    const form = this.root.querySelector('[data-auth-request-form]');
    const backButton = this.root.querySelector('[data-auth-back]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      const normalizedUser = normalizeUserInput(payload.usuario);
      if (!normalizedUser.ok) {
        this.showMessage(normalizedUser.message, 'error');
        return;
      }

      this.showMessage('Enviando solicitação...', 'info');
      const result = await this.api.request_access(
        String(payload.nome || '').trim(),
        normalizedUser.usuario,
        String(payload.setor || '').trim(),
        String(payload.observacao || '').trim(),
      );

      if (!result?.ok) {
        this.showMessage(result?.message || 'Não foi possível enviar a solicitação.', 'error');
        return;
      }

      this.showMessage(result.message || 'Solicitação enviada. Aguarde aprovação do administrador.', 'success');
      setTimeout(() => this.showLogin(result.message), 900);
    }, { signal });

    backButton.addEventListener('click', () => this.showLogin(), { signal });
  }

  async showAdminPanel() {
    const valid = await this.restoreSession();
    if (!valid || !['master', 'admin'].includes(this.currentUser?.perfil)) {
      this.showLogin('Acesso restrito a administradores.');
      return;
    }

    this.cleanup();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.root.innerHTML = `
      <section class="auth-admin" aria-label="Administração de usuários">
        <header class="auth-admin-header">
          <div>
            <span class="auth-kicker">Administração</span>
            <h1>Usuários e solicitações</h1>
            <p>Aprovação, bloqueio e alteração de perfil dentro da mesma tela.</p>
          </div>
          <div class="auth-admin-actions">
            <select data-filter-status aria-label="Filtrar por status">
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="aprovado">Aprovado</option>
              <option value="bloqueado">Bloqueado</option>
            </select>
            <button class="auth-button auth-button--ghost" data-refresh>Atualizar</button>
          </div>
        </header>

        <div data-auth-message class="auth-message" hidden></div>
        <div class="auth-table-wrap">
          <table class="auth-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Setor</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Último login</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody data-users-body>
              <tr><td colspan="7">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `;

    const loadUsers = async () => {
      const token = this.getToken();
      const status = this.root.querySelector('[data-filter-status]').value || null;
      const result = await this.api.list_users(token, status, null, null);
      const body = this.root.querySelector('[data-users-body]');

      if (!result?.ok) {
        body.innerHTML = `<tr><td colspan="7">${escapeHtml(result?.message || 'Erro ao carregar usuários.')}</td></tr>`;
        return;
      }

      const users = result.users || [];
      if (!users.length) {
        body.innerHTML = '<tr><td colspan="7">Nenhum usuário encontrado.</td></tr>';
        return;
      }

      body.innerHTML = users.map((user) => {
        const profileOptions = ['visualizador', 'engenharia', 'producao', 'admin', 'master']
          .map((profile) => `<option value="${profile}" ${profile === user.perfil ? 'selected' : ''}>${profile}</option>`)
          .join('');

        const canEditMaster = this.currentUser?.perfil === 'master' || user.perfil !== 'master';
        const disabled = canEditMaster ? '' : 'disabled';

        return `
          <tr data-user-email="${escapeHtml(user.email)}">
            <td>${escapeHtml(user.nome)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${escapeHtml(user.setor || '-')}</td>
            <td>
              <select data-profile ${disabled}>${profileOptions}</select>
            </td>
            <td><span class="auth-badge auth-badge--${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
            <td>${escapeHtml(user.ultimo_login || '-')}</td>
            <td class="auth-row-actions">
              <button class="auth-mini-button" data-approve ${disabled}>Aprovar</button>
              <button class="auth-mini-button auth-mini-button--danger" data-block ${disabled}>Bloquear</button>
            </td>
          </tr>
        `;
      }).join('');
    };

    this.root.querySelector('[data-refresh]').addEventListener('click', loadUsers, { signal });
    this.root.querySelector('[data-filter-status]').addEventListener('change', loadUsers, { signal });

    this.root.querySelector('[data-users-body]').addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const row = button.closest('tr[data-user-email]');
      const email = row?.dataset.userEmail;
      if (!email) return;

      const token = this.getToken();
      const result = button.matches('[data-approve]')
        ? await this.api.approve_user(token, email, 'Aprovado pelo painel administrativo')
        : await this.api.block_user(token, email, 'Bloqueado pelo painel administrativo');

      this.showMessage(result?.message || 'Ação concluída.', result?.ok ? 'success' : 'error');
      await loadUsers();
    }, { signal });

    this.root.querySelector('[data-users-body]').addEventListener('change', async (event) => {
      const select = event.target.closest('select[data-profile]');
      if (!select) return;
      const row = select.closest('tr[data-user-email]');
      const email = row?.dataset.userEmail;
      if (!email) return;

      const result = await this.api.update_user_profile(this.getToken(), email, select.value);
      this.showMessage(result?.message || 'Perfil alterado.', result?.ok ? 'success' : 'error');
      await loadUsers();
    }, { signal });

    await loadUsers();
  }

  async logout() {
    const token = this.getToken();
    try {
      if (token) await this.api.logout(token);
    } finally {
      this.clearSession();
      if (typeof this.onLogout === 'function') this.onLogout();
      this.showLogin();
    }
  }
}

export { normalizeUserInput, CORPORATE_DOMAIN, SESSION_KEY };
