# Supabase e GitHub JSON

Este projeto usa o Supabase como banco principal das solicitacoes.

O arquivo `data/solicitacoes.json` pode ser usado como backup e historico sincronizado no GitHub.

## Fluxo atual

1. O usuario preenche o formulario no site.
2. A Edge Function do Supabase recebe os dados.
3. A solicitacao e salva na tabela `public.solicitacoes`.
4. A funcao tenta enviar email, se o provedor estiver configurado.
5. A funcao tenta atualizar `data/solicitacoes.json` no GitHub, se o token estiver configurado.

## Secrets necessarios para sincronizar o JSON

- `GITHUB_TOKEN`
- `GITHUB_OWNER=kbdevit1-cloud`
- `GITHUB_REPO=solicitacao-melhoria-correcao`
- `GITHUB_BRANCH=main`
- `GITHUB_JSON_PATH=data/solicitacoes.json`

## Observacao

O Supabase continua sendo a fonte principal dos dados. O JSON do GitHub funciona como backup central e evidencia de historico.