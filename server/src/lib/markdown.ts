// Normalização de markdown vindo de geradores de IA (LLM/GitHub Action).
//
// Alguns geradores envolvem o documento INTEIRO numa cerca de código
// (```markdown … ```), apesar de instruídos a não fazê-lo. Renderizado, isso vira
// um único bloco <pre> — o texto aparece "cru", sem formatação. Aqui desfazemos
// essa cerca de envoltório no limite de exibição (e na geração), preservando
// cercas internas (blocos de código legítimos dentro do documento).

// Remove uma cerca que envolve TODO o conteúdo, apenas quando a info-string é
// vazia ou "markdown"/"md" (um bloco ```ts/```bash de abertura é conteúdo real e
// NÃO é tocado). null/'' passam intactos.
export function stripWrappingCodeFence(content: string | null): string | null {
  if (content == null) return content;
  const text = content.trim();

  // Caso 1: cerca balanceada envolvendo o documento inteiro (```lang … ```).
  const wrapped = text.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i);
  if (wrapped) return wrapped[1];

  // Caso 2: cerca de abertura ```markdown/```md órfã — geração truncada/sem
  // fechamento (sem ela, o react-markdown trata o resto todo como bloco de
  // código = texto cru). Exige a info-string explícita para não comer um bloco
  // de código real que por acaso abra o documento.
  const orphan = text.match(/^```(?:markdown|md)[ \t]*\r?\n/i);
  if (orphan) {
    return text.slice(orphan[0].length).replace(/\r?\n?```$/, '');
  }

  return content;
}
