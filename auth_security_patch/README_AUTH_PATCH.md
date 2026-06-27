# Camada de autenticação corporativa — Global Eletronics

Este pacote implementa autenticação interna com domínio corporativo, solicitação de acesso, aprovação por administrador/master, controle de sessão e logs de auditoria.

## O que foi implementado

- Login SPA dentro da tela principal.
- Sem nova janela, sem novo WebView e sem página externa.
- Tela de login sem exibir `@globaleletronics.ind.br` no input ou placeholder.
- Usuário digita apenas o usuário corporativo, exemplo: `joao.silva`.
- Backend monta internamente: `joao.silva@globaleletronics.ind.br`.
- Bloqueio de domínios pessoais como Gmail, Hotmail, Outlook, Yahoo, iCloud etc.
- Validação no frontend e no backend.
- A autenticação só libera acesso quando o e-mail completo existe na tabela `usuarios` e está com `status = aprovado`.
- Usuário corporativo inexistente não é validado, não recebe sessão e apenas pode abrir solicitação de acesso pendente.
- Tabela `usuarios`.
- Tabela `logs_auditoria`.
- Status: `pendente`, `aprovado`, `bloqueado`.
- Perfil: `master`, `admin`, `engenharia`, `producao`, `visualizador`.
- Área administrativa para `master` e `admin`.
- Logs obrigatórios de tentativa de login, bloqueios, aprovações, alteração de perfil e logout.
- Sessão em memória no backend e token apenas em `sessionStorage` no frontend.

## Arquivos principais

```text
security/auth_service.py          Backend SQLite/API de autenticação
security/session_store.py         Sessões em memória com expiração
security/guards.py                Helpers para proteger funções internas
frontend/auth/auth-ui.js          Componente SPA de login, solicitação e admin
frontend/auth/auth-ui.css         Estilo escuro integrado
sql/sqlite_schema.sql             Schema SQLite manual
sql/supabase_auth_audit.sql       Migração Supabase/PostgreSQL
examples/pywebview_bridge.py      Exemplo de integração pywebview
examples/fastapi_routes.py        Exemplo de integração FastAPI
```

## Integração rápida em projeto Python/pywebview

1. Copie a pasta `security` para a raiz do backend do projeto.
2. Copie `frontend/auth/auth-ui.js` e `frontend/auth/auth-ui.css` para a pasta de frontend.
3. Exponha as funções do `AuthService` na API principal do pywebview.
4. Inicialize o sistema pela tela de login antes de carregar qualquer tela protegida.

Exemplo básico:

```python
from pathlib import Path
from security.auth_service import AuthService

class AppApi:
    def __init__(self):
        self.auth = AuthService(Path('data/app.db'))

    def login(self, usuario, maquina=None, ip=None, windows_email=None):
        return self.auth.login(usuario=usuario, maquina=maquina, ip=ip, windows_email=windows_email)

    def request_access(self, nome, usuario, setor=None, observacao=None, maquina=None, ip=None):
        return self.auth.request_access(nome=nome, usuario=usuario, setor=setor, observacao=observacao, maquina=maquina, ip=ip)

    def get_current_user(self, token):
        return self.auth.get_current_user(token)

    def logout(self, token):
        return self.auth.logout(token)

    def list_users(self, token, status=None, perfil=None, setor=None):
        return self.auth.list_users(token=token, status=status, perfil=perfil, setor=setor)

    def approve_user(self, token, target_email, observacao=None):
        return self.auth.approve_user(token=token, target_email=target_email, observacao=observacao)

    def block_user(self, token, target_email, observacao=None):
        return self.auth.block_user(token=token, target_email=target_email, observacao=observacao)

    def update_user_profile(self, token, target_email, perfil):
        return self.auth.update_user_profile(token=token, target_email=target_email, perfil=perfil)
```

## Integração no frontend SPA

No `index.html`, importe o CSS:

```html
<link rel="stylesheet" href="./auth/auth-ui.css">
```

No JS principal:

```js
import { AuthUI } from './auth/auth-ui.js';

const auth = new AuthUI({
  root: document.getElementById('app'),
  api: window.pywebview.api,
  onAuthenticated: (user) => {
    renderDashboard(user);
  },
  onLogout: () => {
    cleanupDashboard();
  },
});

auth.init();
```

Para proteger uma tela interna:

```js
async function abrirTelaProtegida() {
  await auth.guard(async (user) => {
    // Só carregar dados aqui depois da sessão validada.
    renderTelaInterna(user);
  });
}
```

Para abrir a área administrativa dentro da mesma interface:

```js
auth.showAdminPanel();
```

Para logout:

```js
auth.logout();
```

## Criar o primeiro usuário master

Como ninguém terá acesso no início, crie o primeiro master por CLI:

```bash
python -m security.auth_service --db data/app.db --create-master "Kauã Devit" "kaua.devit" --setor Engenharia
```

O comando salva o e-mail como:

```text
kaua.devit@globaleletronics.ind.br
```

A tela de login continua mostrando apenas o campo `Usuário corporativo`.

## Regra nova solicitada: validar somente e-mail existente

A validação de acesso não aprova apenas porque o usuário digitou um nome com domínio corporativo. O backend primeiro monta o e-mail completo e consulta a tabela `usuarios`. Somente existe login aprovado quando:

```text
email existe na tabela usuarios
status = aprovado
perfil válido
```

Se o e-mail corporativo não existir na tabela, o retorno é `not_registered`, o acesso é bloqueado, o evento `login bloqueado por usuário inexistente` é registrado em `logs_auditoria` e o usuário pode apenas enviar uma solicitação pendente.

## Regras importantes de segurança

- Não usar e-mail do Chrome.
- Não ler conta salva no navegador.
- Não depender do e-mail do Windows para autenticação.
- O e-mail do Windows, se capturado, deve ir apenas para logs complementares.
- Nenhum dado protegido deve ser carregado antes de `get_current_user(token)` retornar `ok: true`.
- Não confiar em perfil/status enviado pelo frontend.
- Sempre consultar o banco no backend antes de liberar recurso.
- Não expor chave `service_role` do Supabase no frontend.

## Mensagens obrigatórias implementadas

- Domínio inválido: `Acesso bloqueado. Use apenas e-mail corporativo @globaleletronics.ind.br.`
- Usuário pendente: `Usuário pendente de aprovação. Solicite liberação ao administrador.`
- Usuário bloqueado: `Usuário bloqueado. Entre em contato com o administrador.`
- Login aprovado: `Acesso liberado.`
- Solicitação criada: `Solicitação enviada. Aguarde aprovação do administrador.`

## Observação sobre a imagem enviada

O campo mostrado como `home@globaleletronics.ind.br` deve ser substituído por um campo que aceite somente o usuário, sem domínio visual:

```text
Usuário corporativo
Digite seu usuário corporativo
```

O domínio é aplicado apenas internamente no backend.
