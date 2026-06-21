// Structured diagnostics — the compiler's error/suggestion language.
//
// Because the compiler knows the WHOLE vocabulary (types, tokens, state, ops), it does
// not emit generic errors: it proposes the closest candidate ("did you mean ...?").
// Shaped for an editor (squiggles) or for the AI (auto-fix). This is the foundation of
// the LSP that comes next.

import type { Loc, Diagnostic, DiagOpts } from '#engine/shared/types.js';

export class ParseError extends Error {
  code: string;
  loc: Loc | null;
  constructor(message: string, loc?: Loc | null) {
    super(message);
    this.name = 'ParseError';
    this.code = 'syntax';
    this.loc = loc || null; // { line, col }
  }
}

// structured diagnostic: { code, severity, message, loc, suggestion }
export function diag(code: string, message: string, opts: DiagOpts = {}): Diagnostic {
  const { loc = null, suggestion = null, severity = 'error' } = opts;
  return { code, severity, message, loc, suggestion };
}

// closest candidate by edit distance (Levenshtein) → the suggestion
export function closest(target: string, candidates: Iterable<string>, maxDist = 3): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = lev(target, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= maxDist ? best : null;
}

function lev(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[b.length];
}

// CLI format:  file:line:col  error  [code]  message  → did you mean "x"?
export function formatDiagnostic(d: Diagnostic, file: string): string {
  const where = d.loc ? `${file}:${d.loc.line}:${d.loc.col}` : file;
  const hint = d.suggestion ? `  → did you mean "${d.suggestion}"?` : '';
  return `${where}  ${d.severity}  [${d.code}]  ${d.message}${hint}`;
}
