# Autenticação corporativa SMC

Camada de autenticação interna para permitir acesso somente com usuário corporativo da Global Eletronics.

## Regra principal

A tela não deve mostrar `@globaleletronics.ind.br`. O usuário digita somente o usuário corporativo, por exemplo:

```text
joao.silva
```

O backend monta internamente:

```text
joao.silva@globaleletronics.ind.br
```

## Regra solicitada agora

A validação de acesso só acontece se o e-mail completo existir na tabela `usuarios`.

Não basta o usuário digitar um nome com domínio corporativo. O fluxo correto é:

```text
monta email completo
consulta usuarios.email
se não existir, bloqueia login e permite apenas solicitar acesso
se existir e status = pendente, bloqueia
se existir e status = bloqueado, bloqueia
se existir e status = aprovado, libera sessão
```

Usuário inexistente não recebe sessão e gera log:

```text
login bloqueado por usuário inexistente
```

## Arquivos

```text
smc_auth/auth_service.py   Backend SQLite com autenticação, sessão e auditoria
smc_auth/auth_ui.js        Tela SPA de login/solicitação/admin
smc_auth/schema.sql        Schema SQLite
```

## Primeiro master

Depois de copiar/integrar o módulo ao projeto, rode:

```bash
python -m smc_auth.auth_service --db data/app.db --create-master "Kauã Devit" "kaua.devit" --setor Engenharia
```

Isso cria:

```text
kaua.devit@globaleletronics.ind.br
```

## Segurança

- Não depende do Chrome.
- Não lê e-mail salvo no navegador.
- Não usa e-mail do Windows para autenticar.
- Validação real fica no backend.
- Nenhuma tela protegida deve carregar dados antes de `get_current_user(token)` retornar `ok: true`.
- Área de usuários e solicitações só pode aparecer para `admin` e `master`.
