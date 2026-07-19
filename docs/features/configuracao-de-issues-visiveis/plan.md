# Estratégia Técnica

**Abordagem Arquitetural:**
A funcionalidade será implementada como uma extensão do Workspace existente, seguindo o padrão de arquitetura fullstack do sistema. O backend atuará como um proxy seguro e inteligente para a GitHub GraphQL API, aplicando a lógica de filtragem e transformação de dados antes de enviá-los ao frontend. O frontend React será responsável pela interface de filtros dinâmica e pela renderização da lista de issues atualizada em tempo real, utilizando o estado local e requisições assíncronas à API interna. A persistência do estado dos filtros será mantida no cliente (React state/URL), sem necessidade de alterações no banco de dados SQLite, que continuará gerenciando apenas os repositórios.

**Decisões-Chave:**
1.  **Filtragem no Backend:** A aplicação de filtros será realizada no servidor (Express) para garantir consistência, performance e segurança, aproveitando a capacidade da GitHub API de receber parâmetros de consulta.
2.  **Atualização Dinâmica via `fetch`:** O frontend utilizará a função `fetch` com `AbortController` para realizar requisições à API à medida que os filtros mudam, proporcionando atualização sem recarregamento da página (SPA).
3.  **Estado dos Filtros na URL:** Os parâmetros de filtro ativos serão serializados e refletidos na query string da URL (ex: `?type=Bug&status=Open`). Isso permite compartilhamento de links, bookmarking e sincronização com o histórico do navegador.
4.  **Contrato de API Estendido:** A API `/api/repositories/{id}/workitems` será estendida para aceitar parâmetros de query para filtragem, mantendo a compatibilidade com chamadas existentes.
5.  **Componentização Reutilizável:** Os componentes de UI para filtros (dropdowns, campo de busca, botões) serão construídos de forma genérica dentro do diretório `client/src/components/Workspace/`, permitindo reuso nas visões "Project" e "Backlog".

**Matriz de Rastreabilidade:**

| Critério de Aceite (Spec) | Componente Técnico (Implementação) |
| :--- | :--- |
| **Cenário: Aplicar filtro por tipo de issue** | **Backend:** Extensão do endpoint `GET /api/repositories/{id}/workitems` para aceitar parâmetro `type`. <br> **Frontend:** Componente `FilterDropdown` para "Tipo", que atualiza a query string e dispara `fetch`. |
| **Cenário: Pesquisar issue por título** | **Backend:** Extensão do endpoint `GET /api/repositories/{id}/workitems` para aceitar parâmetro `titleSearch`. <br> **Frontend:** Componente `SearchBar` que captura input e atualiza a query string. |
| **Cenário: Combinar múltiplos filtros** | **Backend:** Lógica no resolver da rota para combinar (AND) múltiplos parâmetros de query (`type`, `status`, `priority`, `stage`, `titleSearch`). <br> **Frontend:** Múltiplos componentes `FilterDropdown` e `SearchBar` que coexistem e atualizam o mesmo estado de URL. |
| **Cenário: Limpar todos os filtros** | **Frontend:** Botão "Limpar Filtros" que limpa o estado React e a query string, acionando uma requisição com os parâmetros padrão (status != Fechado). |
| **Cenário: Botão "Ver Todos"** | **Frontend:** Botão "Ver Todos" que remove explicitamente o filtro de status "Fechado" da query string, acionando uma requisição sem o filtro `status`. |
| **Cenário: Feedback visual durante filtragem** | **Frontend:** Estado de carregamento (`isLoading`) no hook de busca, acoplado a um componente `LoadingSpinner` e/ou esqueleto de UI (`Skeleton`) na lista de issues. |

# Detalhamento da Implementação

## Backend
**Arquivo:** `server/src/routes/repositoryRoutes.ts`
**Endpoint Modificado:** `GET /api/repositories/:id/workitems`
**Alterações:**
1.  **Extensão dos Parâmetros de Query:** A rota passará a aceitar os seguintes query parameters:
    *   `type` (opcional, string): Filtra pelo tipo da issue (ex: "Bug", "Story").
    *   `status` (opcional, string): Filtra pelo status da issue (ex: "Em Progresso"). O valor especial `"all"` desativa o filtro padrão de status "Fechado".
    *   `priority` (opcional, string): Filtra pela prioridade (ex: "Alta").
    *   `stage` (opcional, string): Filtra pela etapa.
    *   `titleSearch` (opcional, string): Termo para busca textual no título (case-insensitive, partial match).
2.  **Lógica de Filtragem:** A função handler construirá a query GraphQL para a GitHub API incorporando dinamicamente os `filters` baseados nos parâmetros recebidos. A lógica padrão de ocultar status "Fechado" será aplicada a menos que `status` seja explicitamente `"all"` ou outro valor seja fornecido.
3.  **Validação:** Utilizar o módulo `server/src/lib/validation` para validar os valores dos parâmetros contra uma lista permitida (ex: tipos de issue conhecidos).
4.  **DTO de Resposta:** A resposta manterá o formato existente (array de `WorkItemView`), mas conterá apenas os itens filtrados.

**Novo Arquivo:** `server/src/lib/filterBuilder.ts`
**Função:** `buildGitHubIssueFilters(queryParams)`: Recebe os parâmetros da query string e retorna um objeto com os filtros formatados para ser injetado na consulta GraphQL.

## Banco de Dados
**Nenhuma alteração de schema é necessária.** A tabela `repositories` permanece inalterada. Toda a lógica de filtragem é aplicada em tempo de execução sobre os dados obtidos da GitHub API.

## Frontend
**Estrutura de Componentes Novos/Modificados:**
1.  **`client/src/components/Workspace/WorkspaceFilters.tsx`:** Componente contêiner que agrupa todos os controles de filtro e pesquisa. Será incluído nas páginas `ProjectView` e `BacklogView`.
    *   Subs componentes: `FilterDropdown` (reutilizável para Tipo, Status, Prioridade, Etapa), `SearchBar`, `Button` (para "Limpar Filtros" e "Ver Todos").
    *   Responsável por gerenciar o estado local dos filtros e sincronizá-lo com a query string da URL usando `useSearchParams` do React Router.
2.  **`client/src/components/Workspace/FilterDropdown.tsx`:** Componente genérico de dropdown para seleção de filtro.
    *   Props: `label`, `paramKey` (ex: "type"), `options` (array de {value, label}).
3.  **`client/src/components/Workspace/SearchBar.tsx`:** Componente de input de texto para busca por título.
    *   Inclui debounce (ex: 300ms) para evitar requisições excessivas.
4.  **`client/src/hooks/useFilteredWorkItems.ts`:** Hook customizado que encapsula a lógica de busca.
    *   Lê os parâmetros da URL (`useSearchParams`).
    *   Executa `fetch` para o endpoint `/api/repositories/{id}/workitems` com os parâmetros de query.
    *   Gerencia os estados `data`, `isLoading`, `error`.
    *   Utiliza `AbortController` para cancelar requisições pendentes.
5.  **Atualização das Views:** `ProjectView.tsx` e `BacklogView.tsx` integrarão o `WorkspaceFilters` e substituirão a busca direta pelo uso do hook `useFilteredWorkItems`.

## Infraestrutura
**Nenhuma alteração necessária.** A funcionalidade é executada dentro do processo Node.js/Express existente. A infraestrutura de build (Vite) e o deployment (servindo `client/dist`) permanecem inalterados.

# Segurança e Conformidade
*   **Controle de Acesso:** A funcionalidade herda o modelo de segurança do sistema. Não há autenticação de usuário no frontend, mas o acesso à API interna é restrito à rede de origem configurada pelo CORS (por padrão, `http://localhost:5173`). O acesso aos dados do GitHub é protegido pelo `GITHUB_TOKEN` no backend, que nunca é exposto ao cliente.
*   **Hardening:** As medidas existentes (Helmet, rate limiting) continuam a proteger os novos endpoints. A validação rigorosa dos parâmetros de entrada no backend previne ataques de injeção ou manipulação indevida.
*   **Exposição de Dados:** A filtragem ocorre no backend, garantindo que o frontend receba apenas o subconjunto de dados permitido pelos filtros, alinhando-se ao princípio do menor privilégio.

# Estratégia de Testes
*   **Testes Unitários (Backend):**
    *   `server/src/lib/filterBuilder.test.ts`: Testar a construção correta dos filtros GraphQL a partir de diversos conjuntos de parâmetros de query.
    *   `server/src/routes/repositoryRoutes.test.ts`: Testar a rota `GET /api/repositories/:id/workitems` com diferentes combinações de query parameters, verificando se a resposta contém apenas os itens esperados e se o status padrão ("Fechado" oculto) é respeitado.
*   **Testes Unitários (Frontend):**
    *   `client/src/components/Workspace/WorkspaceFilters.test.tsx`: Testar a renderização dos controles e a atualização da URL ao interagir com dropdowns e campo de busca.
    *   `client/src/hooks/useFilteredWorkItems.test.ts`: Testar o hook em um ambiente mockado, verificando os estados de carregamento, chamadas à API com os parâmetros corretos e tratamento de erros.
*   **Testes de Integração:**
    *   Testar o fluxo completo: frontend envia parâmetros de filtro -> backend processa e consulta GitHub API mockada -> backend retorna dados filtrados -> frontend os renderiza. Focar na combinação de múltiplos filtros e no comportamento dos botões "Limpar" e "Ver Todos".
*   **Testes End-to-End (Playwright):**
    *   Criar testes que cubram os **Critérios de Aceite** listados:
        *   Navegar até o Workspace, aplicar filtro por tipo "Bug" e validar a lista.
        *   Realizar uma pesquisa por texto e verificar a atualização dinâmica.
        *   Aplicar e combinar filtros de status e prioridade.
        *   Clicar em "Limpar Filtros" e validar o retorno ao estado padrão.
        *   Clicar em "Ver Todos" e validar a exibição de issues com status "Fechado".
        *   Verificar a exibição do indicador de carregamento durante a filtragem e a mensagem "Nenhuma issue encontrada".

# Rollback e Monitoramento
*   **Plano de Rollback:** Como a funcionalidade é uma extensão de endpoints e componentes existentes, o rollback pode ser realizado através de um revert do commit no repositório de código, seguido de um novo deployment. A API mantém compatibilidade retroativa (parâmetros de query são opcionais), portanto, uma versão anterior do frontend continuaria a funcionar.
*   **Métricas Observadas:**
    *   **Performance:** Latência do endpoint `GET /api/repositories/:id/workitems` (alvo < 500ms). Métrica a ser coletada via logging (Winston) no backend.
    *   **Utilização:** Contagem de requisições para o endpoint de workitems com parâmetros de filtro vs. sem parâmetros.
    *   **Erros:** Taxa de erro 4xx/5xx para o endpoint, especialmente para parâmetros de query inválidos.
*   **Alertas:**
    *   Alertar se a latência média do endpoint de workitems exceder 800ms por um período prolongado.
    *   Alertar se a taxa de erro do endpoint subir acima de 5%.
    *   Alertar sobre qualquer erro não tratado (`500 Internal Server Error`) na rota.