// Diff de linhas (LCS clássico) computado client-side — usado pelo painel de
// versões da spec (o backend fornece só os blobs). O(n·m) é suficiente para
// documentos markdown de centenas de linhas.

export interface DiffRow {
  type: 'ctx' | 'add' | 'del';
  /** linha no arquivo base (del/ctx) */
  left?: { n: number; text: string };
  /** linha no arquivo novo (add/ctx) */
  right?: { n: number; text: string };
}

export function diffLines(baseText: string, headText: string): DiffRow[] {
  const a = baseText.split('\n');
  const b = headText.split('\n');
  const n = a.length;
  const m = b.length;

  // Tabela LCS (comprimentos), depois backtrack para emitir as linhas.
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'ctx', left: { n: i + 1, text: a[i] }, right: { n: j + 1, text: b[j] } });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: 'del', left: { n: i + 1, text: a[i] } });
      i += 1;
    } else {
      rows.push({ type: 'add', right: { n: j + 1, text: b[j] } });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', left: { n: i + 1, text: a[i] } });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: 'add', right: { n: j + 1, text: b[j] } });
    j += 1;
  }
  return rows;
}

// Pareia deleções/adições consecutivas para a visão side-by-side: cada linha da
// esquerda alinha com a da direita quando fazem parte do mesmo bloco alterado.
export interface SideBySideRow {
  left: { n: number; text: string; changed: boolean } | null;
  right: { n: number; text: string; changed: boolean } | null;
}

export function toSideBySide(rows: DiffRow[]): SideBySideRow[] {
  const out: SideBySideRow[] = [];
  let k = 0;
  while (k < rows.length) {
    const row = rows[k];
    if (row.type === 'ctx') {
      out.push({
        left: { ...row.left!, changed: false },
        right: { ...row.right!, changed: false },
      });
      k += 1;
      continue;
    }
    // Bloco alterado: junta o run de del e o run de add e alinha aos pares.
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (k < rows.length && rows[k].type !== 'ctx') {
      if (rows[k].type === 'del') dels.push(rows[k]);
      else adds.push(rows[k]);
      k += 1;
    }
    const len = Math.max(dels.length, adds.length);
    for (let x = 0; x < len; x += 1) {
      out.push({
        left: dels[x] ? { ...dels[x].left!, changed: true } : null,
        right: adds[x] ? { ...adds[x].right!, changed: true } : null,
      });
    }
  }
  return out;
}
