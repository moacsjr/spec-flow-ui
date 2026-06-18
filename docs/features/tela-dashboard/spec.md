# Objetivo
Implementar a tela inicial (Dashboard) do sistema, exibindo uma lista de repositórios conectados com persistência local em SQLite. A tela deve ser responsiva, com estados de carregamento, lista vazia e tratamento de erros, além de permitir filtragem client-side dos repositórios.

# Regras de Negócio
1. A rota `/dashboard` é a página inicial do sistema
2. Repositórios devem ser armazenados em banco SQLite com estrutura:
   - ID (auto-incremento)
   - Nome (obrigatório, texto)
   - URL (obrigatório, único, formato válido)
   - Data de criação (automática, formato DATETIME)
3. A listagem deve mostrar até 50 repositórios por página (paginação futura)
4. Ordenação padrão: mais recentes primeiro
5. Filtragem client-side por nome do repositório
6. Estados obrigatórios de UI:
   - Carregamento (skeletons)
   - Lista vazia (com call-to-action)
   - Erro na requisição (com retry)
7. Validação de URL no backend (regex padrão)
8. Dados sensíveis (como chaves DB) devem vir de variáveis ambiente

# Fluxos
**Fluxo Principal: Carregamento do Dashboard**
1. Usuário acessa a aplicação (rota raiz)
2. Sistema redireciona para `/dashboard`
3. Frontend inicia requisição GET `/api/repositories`
4. Backend consulta SQLite e retorna lista de repositórios
5. Frontend renderiza lista em grid responsivo
6. Usuário visualiza repositórios com nome, URL e data de conexão

**Fluxo Alternativo: Filtragem de Repositórios**
1. Usuário digita no campo de busca
2. Frontend filtra lista existente (client-side) por correspondência no nome
3. Sistema atualiza a exibição em tempo real

**Fluxo de Erro: Falha na Requisição**
1. Frontend detecta erro na chamada API
2. Exibe mensagem de erro + botão "Tentar novamente"
3. Ao clicar, refaz a requisição GET

# Critérios de Aceite
- [ ] Acessar rota `/` redireciona para `/dashboard`
- [ ] Título "Repositórios Conectados" visível no topo da página
- [ ] Exibição em grid/cards responsivo (mínimo 1 coluna mobile, 3 desktop)
- [ ] Cada card mostra: nome, URL clicável, data formatada (ex: "12/05/2024 14:30")
- [ ] Campo de busca que filtra repositórios por nome (client-side)
- [ ] Botão "Conectar novo repositório" visível (roteia para rota futura)
- [ ] Durante loading: exibir 5 skeletons de cards
- [ ] Lista vazia: exibir ilustração + "Nenhum repositório encontrado" + botão "Adicionar repositório"
- [ ] Estado de erro: exibir "Falha ao carregar dados" + botão "Tentar novamente"
- [ ] Endpoint `GET /api/repositories` retorna status 200 com schema:
  ```json
  [{
    "id": 1,
    "name": "Meu Repositório",
    "url": "https://github.com/user/repo",
    "createdAt": "2024-05-12T14:30:00.000Z"
  }]
  ```
- [ ] Banco SQLite com tabela `repositories` conforme schema
- [ ] Backup automático diário do arquivo `database.db`
- [ ] Validação de URL no backend (regex padrão HTTP/HTTPS)
- [ ] Queries SQL parametrizadas (prevenção SQLi)
- [ ] Frontend sanitiza exibição de URLs (prevenção XSS)

# Casos de Erro
- **Erro 500 no backend:** 
  - Causa: Falha de conexão com SQLite
  - Ação Frontend: Exibir estado de erro com retry
- **Resposta API vazia:**
  - Causa: Tabela de repositórios vazia
  - Ação Frontend: Exibir estado de lista vazia
- **URL inválida no banco:**
  - Causa: Dados corrompidos ou migração falha
  - Ação Frontend: Exibir "URL inválida" no campo afetado
- **Timeout de requisição:**
  - Causa: Backend não responde em 10s
  - Ação Frontend: Cancelar requisição e exibir erro
- **Violação de UNIQUE constraint:**
  - Causa: URL duplicada (deverá ser tratada na feature de criação)
  - Ação Backend: Logar erro mas não bloquear listagem

# Dependências
- **Frontend:**
  - React Router (roteamento)
  - React Query/SWR (data fetching)
  - Material-UI/ChakraUI (componentes)
  - date-fns (formatação de datas)
- **Backend:**
  - Express.js (servidor)
  - Knex.js/TypeORM (ORM)
  - SQLite3 (driver do banco)
  - Winston (logging)
- **Banco de Dados:**
  - Arquivo `database.db` com permissões de escrita
  - Git LFS para backup (se incluído no repositório)
- **Infra:**
  - Node.js v18+
  - Script de backup diário (cron job)
  - Variáveis ambiente para configuração do DB