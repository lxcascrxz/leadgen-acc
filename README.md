# ACC Telecom — Gerador de Leads

Busca empresas ativas por bairro na base de CNPJs da [Casa dos Dados](https://casadosdados.com.br), classifica cada lead por qualidade e exporta para Excel (com divisão entre vendedores) ou CSV.

## Chave da API Casa dos Dados

A busca precisa da variável de ambiente `CASA_DOS_DADOS_KEY`. **Sem ela, a busca retorna erro.**

Cada empresa nova retornada consome cerca de 1 crédito da Casa dos Dados. O campo "Máx. por bairro" na tela controla quantas empresas vêm por bairro.

### Rodando localmente

1. Copie o arquivo de exemplo e coloque sua chave:
   ```bash
   cp .env.local.example .env.local
   ```
   ```
   CASA_DOS_DADOS_KEY=sua_chave_aqui
   ```
2. Instale e rode:
   ```bash
   npm install
   npm run dev
   ```
3. Abra [http://localhost:3000](http://localhost:3000).

O `.env.local` está no `.gitignore` e nunca deve ser commitado: o repositório é público.

### Em produção (Vercel)

A Vercel **não** lê o `.env.local`. A chave precisa ser cadastrada no painel:

1. Acesse [vercel.com](https://vercel.com) → projeto **leadgen-acc** → **Settings** → **Environment Variables**.
2. Adicione:
   - **Key:** `CASA_DOS_DADOS_KEY`
   - **Value:** a sua chave da Casa dos Dados
   - **Environments:** Production, Preview e Development
3. Salve e faça um novo deploy (**Deployments** → último deploy → **⋯** → **Redeploy**). A variável só vale para deploys feitos depois de cadastrada.

## Qualidade do lead

| Estrelas | Critério |
|---|---|
| ⭐⭐⭐ | telefone + email + responsável |
| ⭐⭐ | telefone + (email ou responsável) |
| ⭐ | só telefone |
| — | sem telefone |
