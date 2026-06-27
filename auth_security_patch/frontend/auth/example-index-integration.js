import { AuthUI } from './auth-ui.js';

let auth;

function cleanupDashboard() {
  // Remova listeners/timers/dados temporários da sua tela principal aqui.
  // Exemplo:
  // clearInterval(window.dashboardTimer);
  // window.dashboardTimer = null;
}

function renderDashboard(user) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <main class="app-dashboard">
      <header>
        <h1>Sistema interno</h1>
        <p>Usuário: ${user.nome || user.email} | Perfil: ${user.perfil}</p>
        <button id="btn-users" type="button">Usuários</button>
        <button id="btn-logout" type="button">Sair</button>
      </header>
      <section id="main-content"></section>
    </main>
  `;

  document.getElementById('btn-logout').addEventListener('click', () => auth.logout(), { once: true });

  const usersButton = document.getElementById('btn-users');
  if (['admin', 'master'].includes(user.perfil)) {
    usersButton.addEventListener('click', () => auth.showAdminPanel());
  } else {
    usersButton.remove();
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  auth = new AuthUI({
    root: document.getElementById('app'),
    api: window.pywebview?.api,
    onAuthenticated: renderDashboard,
    onLogout: cleanupDashboard,
  });

  const restored = await auth.restoreSession();
  if (restored) {
    renderDashboard(auth.currentUser);
  } else {
    auth.init();
  }
});
