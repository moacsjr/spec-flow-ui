#!/usr/bin/env bash
#
# start-dev-agent.sh — dispara o "dev agent" numa User Story marcada.
#
# Varre o GitHub Project configurado em .spec-wave.json e encontra as User Stories
# elegíveis: issue do tipo Story (label [STORY]), no estado Todo (campo nativo
# "Status" do Projects v2) e com o label spec-wave:dev-agent. Para a PRIMEIRA
# elegível, roda `spec-wave implement <n> --dry-run` e, se ok, o `implement <n>`
# real — encerrando assim que UMA implementa com sucesso (uma issue por execução;
# rode o script de novo para a próxima).
#
# Requisitos: gh (autenticado, escopo project) e jq no PATH.
# Override do comando da CLI: SPEC_WAVE_CLI (default: "npx --yes @spec-wave/cli").

set -euo pipefail

# --- Localiza a raiz do repo (o spec-wave implement lê .spec-wave.json do CWD) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONFIG=".spec-wave.json"
DEV_LABEL="spec-wave:dev-agent"
STORY_LABEL="[STORY]"
SPEC_WAVE_CLI="${SPEC_WAVE_CLI:-npx --yes @spec-wave/cli}"

log()  { printf '\033[0;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Pré-checagens ---
[[ -f "$CONFIG" ]] || die "Não encontrei $CONFIG na raiz do repo ($REPO_ROOT). Rode o spec-wave init primeiro."
command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) não está instalado ou não está no PATH."
command -v jq >/dev/null 2>&1 || die "jq não está instalado ou não está no PATH."
gh auth status >/dev/null 2>&1 || die "gh não está autenticado. Rode: gh auth login --scopes project"

# --- Config do project ---
OWNER="$(jq -r '.owner // empty' "$CONFIG")"
PROJECT="$(jq -r '.project.number // empty' "$CONFIG")"
[[ -n "$OWNER" ]]   || die "owner ausente em $CONFIG."
[[ -n "$PROJECT" ]] || die "project.number ausente em $CONFIG (o repo tem um Projects v2 vinculado?)."

log "Varrendo o Project #$PROJECT de $OWNER por User Stories em Todo com o label $DEV_LABEL…"

# --- Scan: números das Stories elegíveis (ordem do board) ---
mapfile -t CANDIDATES < <(
  gh project item-list "$PROJECT" --owner "$OWNER" --format json --limit 500 \
    | jq -r --arg dev "$DEV_LABEL" --arg story "$STORY_LABEL" '
        .items[]
        | select(.content.type == "Issue")
        | select(.status == "Todo")
        | select(.labels != null and (.labels | index($dev)))
        | select(.labels | index($story))
        | .content.number'
)

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  ok "Nenhuma Story elegível (label $DEV_LABEL + estado Todo). Nada a fazer."
  exit 0
fi

log "Encontradas ${#CANDIDATES[@]} Story(ies) elegível(is): ${CANDIDATES[*]}"

# --- Processa a primeira que implementar com sucesso e encerra ---
FAILED=()
for n in "${CANDIDATES[@]}"; do
  log "Story #$n — dry-run: $SPEC_WAVE_CLI implement $n --dry-run"
  if ! $SPEC_WAVE_CLI implement "$n" --dry-run; then
    warn "Story #$n: dry-run falhou — pulando para a próxima."
    FAILED+=("$n (dry-run)")
    continue
  fi

  log "Story #$n — implementando: $SPEC_WAVE_CLI implement $n"
  if $SPEC_WAVE_CLI implement "$n"; then
    ok "Story #$n implementada com sucesso. Encerrando (uma issue por execução)."
    exit 0
  fi

  warn "Story #$n: implement falhou — pulando para a próxima."
  FAILED+=("$n (implement)")
done

# Chegou aqui: havia candidatas, mas nenhuma implementou com sucesso.
die "Nenhuma Story foi implementada com sucesso. Falhas: ${FAILED[*]}"
