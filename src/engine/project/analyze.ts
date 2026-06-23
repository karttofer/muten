// PROJECT-AWARE analysis — the engine behind the "smart" linter/autocomplete.
//
// Unlike a single-file linter, this knows the WHOLE app:
//  - loads all parts (shared `src/parts/` + local `pages/<route>/parts/`), so it resolves
//    instances (`Changelog()`) and catches typos in part names;
//  - hoists the state of used parts, so `@refs` are validated for real;
//  - knows which parts and which `@state` to offer in autocomplete.
//
// Uses node:fs (runs in the extension host and in Node). Consumed by extension.js and the CLI.

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '#engine/lang/parse.js';
import { composeDoc } from '#engine/ir/compose.js';
import { validate } from '#engine/ir/validate.js';
import { closest, diag, ParseError } from '#engine/shared/diagnostics.js';
import { PRIMITIVE_NAMES } from '#engine/lang/manifest.js';
import { mergeTheme } from '#engine/style/tokens.js';
import type { Theme, PartDef, Route, Diagnostic, ValidateResult, StateDef, CompletionResult, CompletionState } from '#engine/shared/types.js';

type Parts = { [name: string]: PartDef };

// the project's theme.muten (scale) → so the editor validates token VALUES, not just shape
export function projectTheme(filePath: string): Theme {
  const appRoot = findAppRoot(filePath);
  if (!appRoot) return mergeTheme({});
  try { return mergeTheme(parse(fs.readFileSync(join(appRoot, 'theme.muten'), 'utf8')).theme || {}); }
  catch { return mergeTheme({}); }
}

// loads parts from a folder (without styles: the lint doesn't need them)
function loadPartsLite(dir: string): Parts {
  const parts: Parts = {};
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return parts; }
  for (const f of files) {
    if (!f.endsWith('.muten')) continue;
    let ir;
    try { ir = parse(fs.readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    for (const [name, def] of Object.entries(ir.parts || {})) {
      parts[name] = { ...def, state: ir.state || {}, entities: ir.entities || {} };
    }
  }
  return parts;
}

// walks up until it finds the app root (the one with src/pages)
function findAppRoot(filePath: string): string | null {
  let dir = dirname(filePath);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(join(dir, 'src', 'pages'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// every `parts/` folder under the app's src/ (parts are app-global)
function allPartsDirs(root: string): string[] {
  const dirs: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(d, e.name);
      if (e.name === 'parts') dirs.push(full);
      else walk(full);
    }
  };
  walk(join(root, 'src'));
  return dirs;
}

// app-global store domains (every *.store under src/) — so .muten store refs (cart.total) validate
export function projectStores(filePath: string): string[] {
  const appRoot = findAppRoot(filePath);
  if (!appRoot) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.store')) out.push(e.name.slice(0, -'.store'.length));
    }
  };
  walk(join(appRoot, 'src'));
  return out;
}

// domain → its member names (state + gets + actions), so validate can allow `cart.count` refs
// and page→store action composition (`cart.add(d)`). Mirrors projectStores' walk, but parses each store.
export function projectStoreMembers(filePath: string): { [domain: string]: string[] } {
  const appRoot = findAppRoot(filePath);
  if (!appRoot) return {};
  const out: { [domain: string]: string[] } = {};
  const walk = (d: string): void => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.store')) {
        const domain = e.name.slice(0, -'.store'.length);
        try {
          const ir = parse(fs.readFileSync(full, 'utf8'));
          out[domain] = [...Object.keys(ir.state || {}), ...Object.keys(ir.gets || {}), ...Object.keys(ir.actions || {})];
        } catch { out[domain] = []; }
      }
    }
  };
  walk(join(appRoot, 'src'));
  return out;
}

export function projectParts(filePath: string): Parts {
  const appRoot = findAppRoot(filePath);
  if (!appRoot) return loadPartsLite(join(dirname(filePath), 'parts'));
  const parts: Parts = {};
  for (const d of allPartsDirs(appRoot)) Object.assign(parts, loadPartsLite(d));
  return parts;
}

// lint the ROOT file (app.muten): every route must point to an existing page; no dup urls.
function analyzeRoutes(filePath: string, routes: Route[]): ValidateResult {
  const appRoot = findAppRoot(filePath);
  const pagesDir = appRoot ? join(appRoot, 'src', 'pages') : null;
  let pageNames: string[] = [];
  if (pagesDir) { try { pageNames = fs.readdirSync(pagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* no pages dir */ } }
  const D: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const r of routes) {
    if (seen.has(r.url)) D.push(diag('dup-route', `duplicate route "${r.url}"`, { loc: r.loc }));
    seen.add(r.url);
    if (pagesDir && !pageNames.includes(r.page)) {
      D.push(diag('unknown-page', `route "${r.url}" → page "${r.page}" not found in src/pages/`, { loc: r.loc, suggestion: closest(r.page, pageNames) }));
    }
  }
  return { ok: D.length === 0, diagnostics: D };
}

// diagnostics for a file, aware of the whole app
export function analyze(filePath: string, text: string): ValidateResult {
  let ir;
  try { ir = parse(text); }
  catch (e) {
    if (e instanceof ParseError && e.loc) return { ok: false, diagnostics: [diag('syntax', e.message, { loc: e.loc })] };
    return { ok: true, diagnostics: [] };
  }
  if (ir.routes) return analyzeRoutes(filePath, ir.routes); // app.muten = ROOT file, not a page
  if (ir.theme) return { ok: true, diagnostics: [] };       // theme.muten = a config block, not a page
  if (filePath.endsWith('.store')) { // a .store DOMAIN slice (state + get + action + effect), not a page
    return validate({ screen: 'store', state: ir.state || {}, actions: ir.actions || {}, entities: ir.entities || {}, gets: ir.gets || {}, effects: ir.effects || [], consts: {}, constraints: {}, rootId: undefined, nodes: {} }, { kind: 'store' });
  }
  const parts = projectParts(filePath);
  const { doc } = composeDoc(ir, parts); // resolve parts (typos survive → flagged) + hoist state → THE one doc builder
  return validate(doc, { parts: Object.keys(parts), stores: projectStores(filePath), storeMembers: projectStoreMembers(filePath), theme: projectTheme(filePath) });
}

// autocomplete context: the parts, state and actions this file knows within the WHOLE app
export function completion(filePath: string, text: string): CompletionResult {
  let ir = null;
  try { ir = parse(text); } catch { /* whatever could be parsed */ }
  const parts = projectParts(filePath);

  const partList = Object.entries(parts).map(([name, def]) => ({ name, params: def.params || [] }));

  const stateList: CompletionState[] = [];
  const addState = (name: string, d: StateDef): void => {
    stateList.push({ name, type: d.type || '', query: typeof d.source === 'string' && d.source.startsWith('query:') });
  };
  for (const [n, d] of Object.entries(ir?.state || {})) addState(n, d);
  for (const def of Object.values(parts)) for (const [n, d] of Object.entries(def.state || {})) addState(n, d); // hoisted

  return { parts: partList, state: stateList, actions: Object.keys(ir?.actions || {}), primitives: PRIMITIVE_NAMES, theme: projectTheme(filePath) };
}
