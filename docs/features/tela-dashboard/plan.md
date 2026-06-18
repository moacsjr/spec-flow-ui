# Frontend
- Criar rota `/dashboard` como página inicial
- Desenvolver componente `DashboardPage` com:
  - Título "Repositórios Conectados"
  - Listagem responsiva em cards/grid
  - Cada item mostra: nome do repositório, URL, data de conexão
- Implementar busca/filtro client-side para repositórios
- Usar React Query ou SWR para data fetching
- Criar hook `useRepositories` para:
  - GET `/api/repositories`
  - Gerenciar estados (loading, error, empty)
- Adicionar botão "Conectar novo repositório" (roteamento para futura feature)
- UI Components:
  - Skeletons durante loading
  - Empty state com call-to-action
  - Tratamento de erros com retry
- Biblioteca de UI: Material-UI ou ChakraUI
- Responsividade: Mobile-first (grid adaptativo)

# Backend
- Criar endpoint REST:
  - `GET /api/repositories` → Retorna todos repositórios
  - `POST /api/repositories` → (Para futura integração)
- Implementar controller `RepositoryController` com:
  - `getAllRepositories()`: Busca todos registros no DB
  - Retorna JSON: `{ id, name, url, createdAt }`
- Configurar SQLite connection pool
- Setup inicial:
  - Migrations para criação da tabela
  - Seed básico para desenvolvimento
- Estrutura de pastas:
  - `src/controllers/RepositoryController.ts`
  - `src/routes/repositoryRoutes.ts`

# Banco de dados
- Schema SQLite:
  ```sql
  CREATE TABLE repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- Indexes:
  - `CREATE INDEX idx_repositories_name ON repositories(name);`
- Configuração:
  - Arquivo DB local: `./data/database.db`
  - Use Knex.js ou TypeORM:
    - Migrations inicial
    - Model `Repository` com validações
- Backup automático diário (scripts/cron)

# Infraestrutura
- Ambiente local:
  - Frontend: Vite (porta 5173)
  - Backend: Node.js (Express, porta 3001)
- SQLite:
  - Armazenamento local (arquivo `database.db`)
  - Backup incluído no repositório (git-lfs)
- Dockerização (opcional para MVP):
  - `docker-compose.yml` com serviços front/back
- Monitoramento:
  - Logging básico com Winston
  - Health check endpoint `/status`

# Segurança
- Frontend:
  - Sanitização de output (react-dom purify)
  - Validação de URLs na exibição
- Backend:
  - Helmet middleware
  - Rate limiting (express-rate-limit)
  - CORS restrito ao domínio do front
- SQLite:
  - Parameterized queries (prevenir SQLi)
  - Validação de input: regex para URLs
- Dados sensíveis:
  - .env no .gitignore
  - Chaves em variáveis ambiente

# Testes
**Frontend:**
- Testes de componente (Jest + React Testing Library):
  - Renderização do Dashboard
  - Estados (loading, empty, error)
  - Interação de filtro
- Testes E2E (Cypress):
  - Fluxo completo de carregamento
  - Mock de API response

**Backend:**
- Testes de integração (Jest/Supertest):
  - `GET /api/repositories` (200, 404, 500)
  - Validação de schema de resposta
- Testes unitários:
  - Repository controller
  - SQLite queries (mocking)

**Banco de dados:**
- Testes de migração
- Testes de consistência:
  - UNIQUE constraint na URL
  - Valores padrão (created_at)

# Estimativa (Story Points)
**5**  
*(Complexidade média: integração front-back-db, múltiplos estados UI, persistência local, mas sem autenticação)*