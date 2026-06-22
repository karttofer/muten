// The app's routes — src/app.muten `routes { /url -> page }`. Single source of truth the AI reads.
// REQUIRED: no app.muten, no app. Throws on bad input (the CLI formats + exits).
// Parsed by the real engine parser (same as the editor lints) — no regex hack.
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '#engine/lang/parse.js';
import type { RouteEntry, Value } from '#engine/shared/types.js';

export function readRoutes(appRoot: string): RouteEntry[] {
  const rel = (p: string) => relative(appRoot, p);
  const root = join(appRoot, 'src', 'app.muten');
  if (!existsSync(root)) {
    throw new Error(`No app.muten at ${rel(root)}\n   Every app needs a root. Create src/app.muten with:\n     routes {\n       / -> home\n     }`);
  }
  let ir;
  try { ir = parse(readFileSync(root, 'utf8')); }
  catch (e) { throw new Error(`${rel(root)}: ${e instanceof Error ? e.message : String(e)}`); }
  const pagesDir = join(appRoot, 'src', 'pages');
  const routes: RouteEntry[] = (ir.routes || []).map((r) => ({
    route: r.url.replace(/^\//, ''), page: r.page, screenPath: join(pagesDir, r.page, r.page + '.muten'),
  }));
  if (!routes.length) throw new Error(`${rel(root)} has no routes. Add:  routes { /url -> page }`);
  for (const r of routes) {
    if (!existsSync(r.screenPath)) throw new Error(`route /${r.route} -> ${r.page}: page not found at ${rel(r.screenPath)}`);
  }
  return routes;
}

// The app-wide backend config from app.muten `api { base, headers }` ({} if none) — applied to every `sources`.
export function readApi(appRoot: string): { [name: string]: Value } {
  const root = join(appRoot, 'src', 'app.muten');
  if (!existsSync(root)) return {};
  try { return parse(readFileSync(root, 'utf8')).api || {}; }
  catch { return {}; }
}
