// Lint orchestration: parse + validate every page of a host app, WITHOUT compiling.
// Returns the problem count (the CLI in bin/muten.ts exits non-zero when it's > 0).

import { join, relative } from 'node:path';
import { readRoutes } from '#engine/project/routes.js';
import { load, loadParts } from '#engine/project/load.js';
import { validate } from '#engine/ir/validate.js';
import { formatDiagnostic, ParseError } from '#engine/shared/diagnostics.js';
import type { Diagnostic } from '#engine/shared/types.js';

export async function lintApp(appRoot: string): Promise<number> {
  const rel = (p: string) => relative(appRoot, p);
  const sharedParts = await loadParts(join(appRoot, 'src', 'parts'));
  const pages = readRoutes(appRoot);

  let problems = 0;
  for (const page of pages) {
    let diagnostics: Diagnostic[] = [];
    try {
      const { doc, partNames } = await load(page.screenPath, sharedParts);
      diagnostics = validate(doc, { parts: partNames }).diagnostics;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;             // a syntax error is one diagnostic; anything else is a bug
      diagnostics = [{ code: e.code, severity: 'error', message: e.message, loc: e.loc, suggestion: null }];
    }
    for (const d of diagnostics) { console.log(formatDiagnostic(d, rel(page.screenPath))); problems++; }
  }
  console.log(problems ? `\n✖ ${problems} problem(s)` : '✓ no problems');
  return problems;
}
