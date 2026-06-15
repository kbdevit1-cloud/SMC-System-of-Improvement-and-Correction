# Salvar solicitações no GitHub em JSON

Arquivo central criado:

```text
data/solicitacoes.json
```

Ele começa como uma lista vazia:

```json
[]
```

## Importante

O site em GitHub Pages é estático. Ele consegue LER arquivos do repositório, mas não deve ESCREVER diretamente no GitHub usando JavaScript, porque isso exigiria colocar um token do GitHub dentro do HTML público.

O fluxo correto é:

```text
HTML no GitHub Pages
→ Power Automate/Webhook
→ GitHub API
→ atualiza data/solicitacoes.json
→ envia e-mail
```

## Por que não colocar token no HTML?

Nunca coloque um GitHub Token/PAT dentro do `index.html`, porque qualquer pessoa conseguiria abrir o código-fonte do site, copiar o token e alterar ou apagar o repositório.

## Estrutura do JSON

Cada solicitação deve ser salva como um objeto dentro da lista:

```json
[
  {
    "id": 1710000000000,
    "dataAbertura": "15/06/2026",
    "diaAbertura": "Segunda-feira",
    "horaAbertura": "10:30:00",
    "nome": "João Silva",
    "area": "Fábrica",
    "setorLivre": "Pré-formatação",
    "destino": "Manutenção",
    "tipo": "Correção / arrumar algo",
    "prioridade": "Média",
    "local": "Mesa da pré-formatação",
    "titulo": "Mesa da pré-formatação quebrada",
    "problema": "A mesa está quebrada e dificulta a atividade.",
    "solicitacao": "Solicito avaliação e ajuste da mesa.",
    "impacto": "Dificulta o processo, Gera perda de tempo",
    "obs": "Problema ocorre durante o turno da manhã.",
    "status": "Recebido",
    "emailStatus": "Enviado"
  }
]
```

## Como configurar no Power Automate

### 1. Criar o gatilho

Crie um fluxo com o gatilho:

```text
Quando uma solicitação HTTP for recebida
```

Cole o schema recebido do HTML.

### 2. Gerar um token do GitHub

No GitHub:

```text
Settings → Developer settings → Personal access tokens → Fine-grained tokens
```

Permissão necessária no repositório:

```text
Contents: Read and write
```

Guarde o token somente dentro do Power Automate.

### 3. Ler o arquivo JSON atual

Adicione uma ação HTTP:

```text
GET https://api.github.com/repos/kbdevit1-cloud/solicitacao-melhoria-correcao/contents/data/solicitacoes.json
```

Headers:

```text
Authorization: Bearer SEU_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

A resposta terá:

- `content`: conteúdo base64 do JSON;
- `sha`: SHA atual do arquivo.

### 4. Decodificar o JSON

No Power Automate, use uma expressão para decodificar o `content`:

```text
base64ToString(body('HTTP_GET_GitHub')?['content'])
```

Depois faça parse do JSON para obter a lista atual.

### 5. Adicionar a nova solicitação

Monte um novo objeto com os campos recebidos pelo webhook e adicione ao array existente.

### 6. Atualizar o arquivo no GitHub

Use outra ação HTTP:

```text
PUT https://api.github.com/repos/kbdevit1-cloud/solicitacao-melhoria-correcao/contents/data/solicitacoes.json
```

Headers:

```text
Authorization: Bearer SEU_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
```

Body:

```json
{
  "message": "Add new solicitation",
  "content": "CONTEUDO_JSON_ATUALIZADO_EM_BASE64",
  "sha": "SHA_ATUAL_DO_ARQUIVO"
}
```

A parte `content` precisa ser o JSON atualizado convertido para base64.

## Observação sobre concorrência

Se duas pessoas enviarem ao mesmo tempo, pode dar conflito de SHA. Para uso simples funciona, mas para uso mais robusto o ideal é usar SharePoint List, Dataverse, Supabase ou GitHub Issues em vez de um único arquivo JSON.
