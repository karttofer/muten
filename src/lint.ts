// Lint / check: parse + validate every page of a host app, WITHOUT compiling. The deterministic ORACLE
// an AI consults instead of running a browser — `--json` returns the structured diagnostics (code + loc +
// "did you mean…?" suggestion) in milliseconds. Returns the problem count (the CLI exits non-zero if > 0).

import { join, relative } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { readRoutes } from '#engine/project/routes.js';
import { load, loadParts, findStores } from '#engine/project/load.js';
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { validate } from '#engine/ir/validate.js';
import { formatDiagnostic, ParseError } from '#engine/shared/diagnostics.js';
import type { Diagnostic } from '#engine/shared/types.js';

export async function lintApp(appRoot: string, json = false): Promise<number> {
  const rel = (p: string) => relative(appRoot, p);
  const sharedParts = await loadParts(join(appRoot, 'src', 'parts'));
  const storeIRs = findStores(join(appRoot, 'src'));             // store domains + their members → validate cart.add / cart.count
  const stores = Object.keys(storeIRs);
  const storeMembers: { [d: string]: string[] } = {};
  for (const [d, ir] of Object.entries(storeIRs)) storeMembers[d] = [...Object.keys(ir.state || {}), ...Object.keys(ir.gets || {}), ...Object.keys(ir.actions || {})];
  const pages = readRoutes(appRoot);

  const found: Array<{ file: string } & Diagnostic> = [];
  for (const page of pages) {
    let diagnostics: Diagnostic[] = [];
    try {
      const { doc, partNames } = await load(page.screenPath, sharedParts);
      diagnostics = validate(doc, { parts: partNames, stores, storeMembers }).diagnostics;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;             // a syntax error is one diagnostic; anything else is a bug
      diagnostics = [{ code: e.code, severity: 'error', message: e.message, loc: e.loc, suggestion: null }];
    }
    for (const d of diagnostics) {
      if (!json) console.log(formatDiagnostic(d, rel(page.screenPath)));
      found.push({ file: rel(page.screenPath), ...d });
    }
  }
  // the shell (app.muten) wraps every route → validate its store refs too (e.g. the navbar's cart count)
  const appFile = join(appRoot, 'src', 'app.muten');
  if (existsSync(appFile)) {
    try {
      const appIr = parse(readFileSync(appFile, 'utf8'));
      if (appIr.shell) {
        for (const d of validate(toDoc({ ...appIr, tree: appIr.shell }), { stores, storeMembers }).diagnostics) {
          if (!json) console.log(formatDiagnostic(d, rel(appFile)));
          found.push({ file: rel(appFile), ...d });
        }
      }
    } catch (e) { if (!(e instanceof ParseError)) throw e; } // a syntax error surfaces via the pages' load
  }

  if (json) console.log(JSON.stringify(found, null, 2));
  else console.log(found.length ? `\n✖ ${found.length} problem(s)` : '✓ no problems');
  return found.length;
}
