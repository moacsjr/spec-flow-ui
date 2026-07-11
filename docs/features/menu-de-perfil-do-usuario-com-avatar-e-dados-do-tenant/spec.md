# Visão Geral
- **Objetivo**: Fornecer um ponto de acesso centralizado no cabeçalho para o usuário visualizar suas informações de perfil, dados do tenant ativo e realizar logout de forma intuitiva.
- **Personas**: Usuário autenticado em ambiente multi-tenant que precisa identificar rapidamente em qual tenant está operando e acessar funcionalidades de conta.
- **Critérios de Sucesso**: 
  - 100% dos usuários autenticados visualizam o menu de perfil no cabeçalho
  - Redução em 50% do tempo para identificação do tenant ativo
  - 0 incidentes de logout mal-sucedido após implementação

# Regras de Negócio
- RN001: O menu de perfil só deve ser exibido para usuários autenticados
- RN002: Quando o usuário possui avatar cadastrado, este deve ser exibido no ícone do menu
- RN003: Na ausência de avatar, devem ser exibidas as iniciais do nome do usuário (primeira letra do primeiro nome + primeira letra do último nome)
- RN004: O dropdown deve conter obrigatoriamente: nome completo do usuário, tenant-id, tenant-name e opção de logout
- RN005: O tenant exibido deve ser sempre o tenant ativo na sessão atual
- RN006: Ao clicar em logout, a sessão deve ser encerrada e o usuário redirecionado para a tela de login

# Fluxos
## Fluxo Principal (Happy Path)
1. Usuário faz login com sucesso no sistema
2. Sistema carrega o cabeçalho da aplicação com o menu de perfil
3. Avatar do usuário é exibido no ícone do menu (quando disponível)
4. Usuário clica no ícone do menu
5. Dropdown abre mostrando: nome do usuário, tenant-id, tenant-name e botão de logout
6. Usuário visualiza as informações e fecha o dropdown clicando fora ou no ícone novamente

## Fluxos Alternativos
- **FA001 - Usuário sem avatar**: 
  1. Sistema detecta que usuário não possui avatar cadastrado
  2. Exibe iniciais do nome em um círculo colorido no lugar do avatar
  3. Restante do fluxo igual ao principal

- **FA002 - Logout bem-sucedido**:
  1. Usuário clica no botão de logout no dropdown
  2. Sistema encerra a sessão
  3. Redireciona para tela de login
  4. Exibe mensagem de logout bem-sucedido

## Cenários de Erro
- **CE001 - Falha ao carregar avatar**:
  1. Sistema tenta carregar avatar mas encontra erro (imagem corrompida ou URL inválida)
  2. Fallback para exibição das iniciais do nome
  3. Registra erro em logs para debugging

- **CE002 - Dados de tenant indisponíveis**:
  1. Sistema não consegue recuperar informações do tenant ativo
  2. Exibe placeholder "[Dados não disponíveis]" no lugar do tenant-id e tenant-name
  3. Mantém funcionalidade de logout disponível

# Critérios de Aceite
```gherkin
Cenário: Exibição do menu de perfil para usuário autenticado com avatar
  Dado que o usuário está autenticado no sistema
  E possui um avatar cadastrado
  Quando o sistema carrega o cabeçalho da aplicação
  Então o avatar do usuário deve ser exibido no ícone do menu de perfil

Cenário: Fallback para iniciais quando avatar não está disponível
  Dado que o usuário está autenticado no sistema
  E não possui avatar cadastrado
  Quando o sistema carrega o cabeçalho da aplicação
  Então as iniciais do nome do usuário devem ser exibidas no ícone do menu

Cenário: Abertura do dropdown com informações completas
  Dado que o usuário está autenticado no sistema
  Quando clica no ícone do menu de perfil
  Então o dropdown deve abrir mostrando:
    | Campo        | Valor esperado           |
    | Nome         | Nome completo do usuário |
    | tenant-id    | ID do tenant ativo       |
    | tenant-name  | Nome do tenant ativo     |
    | Logout       | Opção clicável           |

Cenário: Logout bem-sucedido
  Dado que o usuário está autenticado no sistema
  E o dropdown do menu de perfil está aberto
  Quando clica na opção de logout
  Então a sessão deve ser encerrada
  E o usuário deve ser redirecionado para a tela de login

Cenário: Consistência multi-tenant
  Dado que o usuário está autenticado em um tenant específico
  Quando acessa o dropdown do menu de perfil
  Então as informações de tenant-id e tenant-name devem corresponder ao tenant ativo da sessão
```

# Dependências
## Internas
- Serviço de autenticação para validar sessão do usuário
- API de usuários para obter dados do perfil (nome, avatar)
- API de tenants para obter informações do tenant ativo
- Componente de cabeçalho existente para integração do menu

## Externas
- Amazon S3 para armazenamento dos avatares dos usuários
- Amazon CloudFront como CDN para distribuição otimizada das imagens
- AWS IAM para gerenciamento seguro de permissões de acesso aos buckets

# Requisitos Não-Funcionais
## Performance
- O menu deve carregar em menos de 100ms após o login
- Os avatares devem ser servidos via CloudFront com cache de pelo menos 1 dia
- O dropdown deve abrir/fechar com animação suave (max 300ms)
- Latência máxima de 500ms para carregamento de avatares via CDN

## Segurança
- Bucket S3 configurado com acesso privado por padrão
- URLs de avatares devem ser assinadas e ter tempo de expiração
- Validação de sessão deve ser feita a cada interação com o menu
- Logout deve invalidar token JWT/refresh token adequadamente

## Usabilidade
- O ícone do menu deve ser claramente identificável como elemento clicável
- O dropdown deve ser fechado ao clicar fora ou pressionar ESC
- Deve ser totalmente acessível via teclado (tabindex, aria-labels)
- Responsivo para diferentes tamanhos de tela
- Avatares devem ter fallback visual durante carregamento