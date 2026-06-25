```markdown
# Estratégia Técnica
**Abordagem Arquitetural:**  
Extensão da arquitetura monolítica existente com novos endpoints REST no backend e componentes React no frontend. Dados persistidos exclusivamente via GitHub Issues, utilizando GraphQL/REST APIs. O backend atua como proxy seguro para GitHub, mantendo o frontend como consumidor de JSON.

**Decisões-Chave:**  
1. Operações de escrita via GitHub GraphQL API (criação/remoção hierárquica de issues)  
2. Validação de limite de features no backend antes de criar novas  
3. Exclusão em cascata implementada via travessia DFS pós-ordem (tasks → stories → feature)  
4. Frontend calcula impacto de remoção localmente a partir dos dados já carregados  

**Matriz de Rastreabilidade:**  

| Critério de Aceite                     | Componente Técnico                                                                 |
|----------------------------------------|------------------------------------------------------------------------------------|
| Adição bem-sucedida de feature         | POST /api/repositories/:repoId/epics/:epicNumber/features + FeatureForm (UI)      |
| Remoção de feature com dependências    | DELETE /api/repositories/:repoId/epics/:epicNumber/features/:featureNumber + DeleteConfirmationModal (UI) |
| Tentativa de remoção com falha de rede | Error handling em useMutation (frontend) + Retry mechanism (UI)                   |

# Detalhamento da Implementação
## Backend
**Novos Endpoints (em `server/src/routes/repositoryRoutes.ts`):**  
1. `POST /api/repositories/:repoId/epics/:epicNumber/features`  
   - **Request Body:** `CreateFeatureDto { name: string; description?: string }`  
   - **Validações:**  
     - `name` obrigatório (retorna 400 se vazio)  
     - Verifica limite de 20 features (via contagem de issues filhas no GitHub)  
   - **Fluxo:**  
     1. Cria issue no GitHub via `createIssue` mutation (tipo feature)  
     2. Atualiza parentesco com épico via `updateIssue` mutation  
     3. Rollback automático se passo 2 falhar (exclui issue criada)  
   - **Respostas:**  
     - 201 Created + `WorkItemView` (AC1)  
     - 400 Bad Request (limite excedido/dados inválidos)  

2. `DELETE /api/repositories/:repoId/epics/:epicNumber/features/:featureNumber`  
   - **Fluxo:**  
     1. Obtém árvore de dependências via GraphQL (feature → stories → tasks)  
     2. Exclui em ordem inversa (tasks → stories → feature) via `deleteIssue`  
     3. Transação simulada: interrompe e reporta erro a qualquer falha  
   - **Respostas:**  
     - 204 No Content (AC2)  
     - 502 Bad Gateway (falha GitHub) (AC3)  

**Camada de Serviço:**  
- `FeatureService.createFeature()`: Implementa lógica de criação em 2 passos  
- `FeatureService.deleteFeatureWithDependencies()`: DFS pós-ordem para exclusão  

## Banco de Dados
- **Zero alterações de schema:** Utiliza-se exclusivamente GitHub Issues como armazenamento  
- **Constraints via código:**  
  - Limite 20 features: Validação via contagem GraphQL antes de inserção  
  - Integridade hierárquica: Garantida por mutations atômicas no GraphQL  
- **Transações:** Simuladas via rollback manual em falhas (create) e sequência ordenada (delete)  

## Frontend
**Componentes (em `client/src/views/EpicDetail/`):**  
1. `FeatureForm.tsx` (Novo)  
   - Campos: Nome (obrigatório), Descrição (opcional)  
   - Validação em tempo real com mensagens específicas (AC1)  
   - Submete via `useMutation` para endpoint POST  

2. `DeleteConfirmationModal.tsx` (Novo)  
   - Exibe contagem de stories/tasks (calculada a partir do estado local) (AC2)  
   - Botões: "Confirmar" (chama DELETE) / "Cancelar" (fecha modal) (Alternativo 2)  

**Integração:**  
- Botão "Adicionar Feature" no `EpicDetail.tsx` abre `FeatureForm`  
- Ícone "