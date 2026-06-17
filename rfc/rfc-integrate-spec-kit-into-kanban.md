# RFC-001 — Processo de Gestão de Produto, Desenvolvimento e Entrega Assistido por IA

**Status:** Aprovado
**Versão:** 2.0
**Data:** 14/06/2026
**Autores:** Produto, Engenharia e Arquitetura

---

# 1. Objetivo

Definir um processo padronizado para gestão de demandas, planejamento, desenvolvimento, validação e entrega de software utilizando:

* GitHub Projects como ferramenta central de gestão
* GitHub Issues como unidade de trabalho
* GitHub Actions para automação do fluxo
* IA para geração de documentação, decomposição de trabalho e apoio à engenharia

O objetivo é criar um processo escalável, rastreável e orientado a fluxo contínuo, reduzindo atividades operacionais e permitindo que a equipe concentre esforços em tomada de decisão, arquitetura, qualidade e entrega de valor.

---

# 2. Princípios

## 2.1 Fluxo puxado (Pull System)

Nenhum trabalho é atribuído diretamente.

Cada membro da equipe puxa o próximo item disponível do fluxo.

---

## 2.2 Desenvolvimento orientado por especificação

Nenhuma implementação inicia sem documentação mínima aprovada.

Toda Feature deverá possuir:

```text
spec.md
plan.md
```

antes de entrar em desenvolvimento.

---

## 2.3 Rastreabilidade Completa

Todo trabalho deve possuir relação hierárquica.

```text
Epic
 └── Feature
      └── Story
           └── Task
```

---

## 2.4 IA como acelerador

A IA auxilia na geração de:

* Especificações
* Planejamento técnico
* Stories
* Tasks
* Casos de teste
* Release Notes
* Revisões automatizadas

A responsabilidade final permanece humana.

---

# 3. Estrutura Hierárquica

## Epic

Representa um objetivo estratégico ou iniciativa de negócio.

Exemplos:

```text
[EPIC] Gestão de Pedidos

[EPIC] Programa de Fidelidade

[EPIC] Plataforma Marketplace
```

---

## Feature

Representa uma capacidade funcional do sistema.

Exemplos:

```text
[FEATURE] Cadastro de Pedidos

[FEATURE] Controle de Produção

[FEATURE] Dashboard Operacional
```

---

## Story

Representa uma necessidade específica do usuário.

Formato:

```text
Como <perfil>
Quero <objetivo>
Para <benefício>
```

Exemplo:

```text
Como garçom
Quero criar pedidos
Para registrar o consumo dos clientes
```

---

## Task

Representa uma atividade técnica executável.

Exemplos:

```text
[TASK] Criar migration orders

[TASK] Criar endpoint POST /orders

[TASK] Criar testes unitários
```

---

## Bug

Correção de defeitos.

```text
[BUG] Duplicidade de pedidos
```

---

## Spike

Investigação técnica.

```text
[SPIKE] Avaliar integração com ERP
```

---

## RFC

Documentação de processos, arquitetura ou decisões relevantes.

```text
[RFC] Processo de Gestão de Trabalho
```

---

# 4. Fluxo Kanban

```text
📥 Backlog
    ↓
🎯 Priorizado
    ↓
🔍 Refinamento
    ↓
✅ Ready
    ↓
📋 Backlog Técnico
    ↓
🚧 Desenvolvimento
    ↓
👀 Code Review
    ↓
🧪 QA
    ↓
📋 Homologação
    ↓
🚀 Deploy
    ↓
🎉 Done
```

---

# 5. Definição das Etapas

## 📥 Backlog

Contém ideias, solicitações, melhorias e bugs.

Responsável:

* Stakeholders
* Product Owner

Não existe compromisso de implementação.

---

## 🎯 Priorizado

Itens selecionados pelo Product Owner.

Critérios:

* Valor de negócio identificado
* Interesse estratégico

---

## 🔍 Refinamento

Etapa de detalhamento funcional e técnico.

Participantes:

* Product Owner
* Tech Lead
* Desenvolvedores

Atividades:

* Definir regras de negócio
* Criar critérios de aceite
* Identificar dependências
* Definir arquitetura
* Estimar esforço

Artefatos gerados:

```text
spec.md
plan.md
```

---

## ✅ Ready

Representa que a Feature está pronta para ser decomposta automaticamente.

Critérios obrigatórios:

* Requisitos definidos
* Critérios de aceite definidos
* Dependências identificadas
* Estimativa realizada
* spec.md aprovado
* plan.md aprovado

---

## 📋 Backlog Técnico

Etapa responsável por armazenar Stories e Tasks geradas automaticamente.

Critérios de entrada:

* Feature movida para Ready
* Decomposição automática concluída

Critérios de saída:

* Story selecionada por um desenvolvedor

---

## 🚧 Desenvolvimento

Implementação da solução.

Critério de entrada:

* Story movida do Backlog Técnico

Critério de saída:

* Pull Request aberto

---

## 👀 Code Review

Validação técnica.

Checklist:

* Padrões respeitados
* Testes adequados
* Critérios de aceite implementados
* Segurança validada

---

## 🧪 QA

Validação funcional.

Atividades:

* Testes funcionais
* Testes regressivos
* Verificação dos critérios de aceite

---

## 📋 Homologação

Validação do negócio.

Responsáveis:

* Product Owner
* Stakeholders

Objetivo:

Confirmar aderência à necessidade original.

---

## 🚀 Deploy

Publicação em produção.

Checklist:

* Pipeline executado
* Migrações aplicadas
* Monitoramento ativo

---

## 🎉 Done

Entrega concluída.

Critérios:

* Produção atualizada
* Sem incidentes críticos
* Aprovação registrada

---

# 6. Processo de Spec-Driven Development

Toda Feature deve seguir o seguinte fluxo:

```text
Feature
↓
spec.md
↓
plan.md
↓
Ready
↓
Decomposição automática
↓
Stories
↓
Tasks
↓
Desenvolvimento
```

---

# 7. Automação com IA

## 7.1 Geração de Especificação

A IA pode gerar:

```text
spec.md
```

Contendo:

* Objetivo
* Regras de negócio
* Fluxos
* Critérios de aceite
* Casos de erro

---

## 7.2 Geração de Plano Técnico

A IA pode gerar:

```text
plan.md
```

Contendo:

* Frontend
* Backend
* Banco de dados
* Infraestrutura
* Segurança
* Testes

---

## 7.3 Decomposição Automática

Ao mover uma Feature para:

```text
Ready
```

o sistema executa:

```text
Feature
↓
Stories
↓
Tasks
```

automaticamente.

---

## 7.4 Casos de Teste

Ao abrir um Pull Request:

A IA pode gerar:

* Cenários de teste
* Casos de regressão
* Checklist funcional

---

## 7.5 Release Notes

Ao concluir Deploy:

A IA gera automaticamente:

```text
Novidades
Correções
Melhorias
Impactos
```

---

# 8. Fluxo Automático de Decomposição

## Entrada

```text
Status = Ready

Tipo = Feature
```

---

## Execução

GitHub Action é acionada.

Passos:

### Passo 1

Validar:

```text
spec.md
plan.md
```

---

### Passo 2

Gerar Stories.

Exemplo:

```text
[STORY] Garçom cria pedido

[STORY] Garçom adiciona itens

[STORY] Garçom finaliza pedido
```

---

### Passo 3

Gerar Tasks.

Exemplo:

```text
[TASK] Criar migration orders

[TASK] Criar entidade Order

[TASK] Criar endpoint POST /orders

[TASK] Criar testes unitários
```

---

### Passo 4

Criar relacionamento hierárquico.

```text
Epic
 └── Feature
      ├── Story
      │     ├── Task
      │     └── Task
      │
      └── Story
```

---

### Passo 5

Adicionar todos os itens ao GitHub Project.

Status inicial:

```text
Backlog Técnico
```

---

# 9. Papéis e Responsabilidades

## Product Owner (PO)

Responsável por:

* Gestão do Backlog
* Priorização
* Refinamento funcional
* Aprovação de Features
* Homologação

Atua principalmente até a etapa Ready.

---

## Tech Lead

Responsável por:

* Arquitetura
* Governança técnica
* Revisão de especificações
* Revisão de planos técnicos
* Padrões de engenharia
* Mentoria técnica

Responsável pela qualidade estrutural da solução.

---

## Desenvolvedor

Responsável por:

### Refinamento

* Identificar riscos
* Identificar dependências
* Apoiar estimativas

### Desenvolvimento

* Selecionar Stories do Backlog Técnico
* Implementar solução
* Criar testes
* Atualizar documentação

### Revisão

* Participar de Code Reviews
* Validar qualidade técnica

O desenvolvedor não é responsável por criar manualmente Stories e Tasks.

Essa atividade é automatizada e posteriormente validada.

---

## QA

Responsável por:

* Testes funcionais
* Testes regressivos
* Validação dos critérios de aceite

---

## DevOps

Responsável por:

* Pipelines
* Infraestrutura
* Deploy
* Observabilidade
* Segurança operacional

---

## Stakeholders

Responsáveis por:

* Definir necessidades
* Fornecer feedback
* Participar da homologação

---

# 10. Campos do GitHub Project

## Work Item Type

```text
Epic
Feature
Story
Task
Bug
Spike
RFC
```

---

## Priority

```text
P0
P1
P2
P3
```

| Prioridade | Descrição |
| ---------- | --------- |
| P0         | Crítico   |
| P1         | Alta      |
| P2         | Média     |
| P3         | Baixa     |

---

## Story Points

```text
1
2
3
5
8
13
21
```

---

## Area

```text
Frontend
Backend
Mobile
Infra
DevOps
Data
```

---

## Release

Exemplos:

```text
v1.0
v1.1
v2.0
```

---

# 11. Regras Operacionais

## Regra 1

Nenhum item pode ir diretamente de Backlog para Desenvolvimento.

---

## Regra 2

Nenhuma Feature pode entrar em Ready sem:

```text
spec.md
plan.md
```

---

## Regra 3

Toda Story deve pertencer a uma Feature.

---

## Regra 4

Toda Feature deve pertencer a um Epic.

---

## Regra 5

Toda Task deve pertencer a uma Story.

---

## Regra 6

Todo código deve passar por Code Review.

---

## Regra 7

Ao mover uma Feature para Ready, o sistema deve gerar automaticamente:

* Stories
* Tasks
* Relacionamentos pai/filho
* Inclusão no GitHub Project

---

## Regra 8

Nenhuma Story pode iniciar desenvolvimento sem ter sido gerada a partir de uma Feature aprovada.

---

## Regra 9

A IA pode sugerir trabalho, mas não aprovar trabalho.

Toda aprovação permanece responsabilidade humana.

---

# 12. Métricas

Monitorar:

* Lead Time
* Cycle Time
* Throughput
* Bugs por Release
* Tempo médio de Review
* Tempo médio de QA
* Tempo médio de Homologação
* Tempo médio de Deploy
* Taxa de retrabalho
* Taxa de sucesso da decomposição automática

---

# 13. Critérios de Sucesso

O processo será considerado bem-sucedido quando:

* 100% das Features possuírem spec.md e plan.md
* 100% das Features forem rastreáveis até um Epic
* 100% das Tasks forem rastreáveis até uma Story
* Nenhum desenvolvimento iniciar sem refinamento
* A decomposição automática reduzir significativamente o trabalho operacional da equipe
* Houver visibilidade completa do fluxo de entrega para todos os envolvidos

---

# 14. Visão de Futuro

Evoluir gradualmente para uma plataforma de entrega assistida por IA onde:

```text
PO
↓
Feature
↓
IA gera Spec
↓
IA gera Plano
↓
IA gera Stories
↓
IA gera Tasks
↓
Desenvolvedor implementa
↓
IA auxilia revisão
↓
QA valida
↓
Deploy automatizado
```

Mantendo sempre a tomada de decisão, arquitetura, validação e responsabilidade final sob controle humano.

