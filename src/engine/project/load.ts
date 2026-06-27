// load: project-aware loader that turns a .muten page into everything needed to compile it.
// Pipeline: parse -> gather parts (shared + local + inline) -> compose (inline instances) ->
// hoist entity/state/mock of used parts -> gather styles (page + used parts) -> flatten data.
// Consumed by build.ts, map.ts, and the Vite plugin.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { parse } from '#engine/lang/parse.js';
import { resolveStyles } from '#engine/project/styles.js';
import { composeDoc } from '#engine/ir/compose.js';
import type { PartDef, Value, LoadResult, IR, Entity } from '#engine/shared/types.js';

type Parts = { [name: string]: PartDef };

// Element entity of each store's list-typed STATE member, keyed "domain.member" — so a PAGE doing a
// cross-store aggregate (`orders.items.count where status == …`) can resolve the element's fields the
// same way it resolves a local list. (State members only; a get returning a list is left to local resolution.)
export function storeListEntities(stores: { [domain: string]: IR }): { [k: string]: Entity } {
  const out: { [k: string]: Entity } = {};
  for (const [domain, ir] of Object.entries(stores)) {
    for (const [member, def] of Object.entries(ir.state || {})) {
      const m = (def.type || '').match(/^list<(.+)>$/);
      const ent = m ? ir.entities?.[m[1]] : undefined;
      if (ent) out[`${domain}.${member}`] = ent;
    }
  }
  return out;
}

// Every *.store file under a directory -> parsed IR keyed by domain name.
// Shared by the Vite plugin, the linter, and `muten map` so store refs resolve everywhere.
export function findStores(dir: string, out: { [domain: string]: IR } = {}): { [domain: string]: IR } {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findStores(full, out);
    else if (entry.name.endsWith('.store')) out[basename(entry.name, '.store')] = parse(readFileSync(full, 'utf8'));
  }
  return out;
}

// Each part file contributes its parts, state/entities/mock, and colocated .scss.
export async function loadParts(dir: string): Promise<Parts> {
  const parts: Parts = {};
  if (!existsSync(dir)) return parts;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.muten')) continue;
    const filePath = join(dir, f);
    const ir = parse(readFileSync(filePath, 'utf8'));
    const { css } = await resolveStyles(filePath); // colocated .scss/.css for this part
    for (const [name, def] of Object.entries(ir.parts || {})) {
      parts[name] = { ...def, state: ir.state || {}, entities: ir.entities || {}, mock: ir.mock || {}, css };
    }
  }
  return parts;
}

// Gather all parts in the app (any `parts/` folder under src/). Parts are app-global:
// defined anywhere, usable and autocompleted anywhere.
export async function loadAllParts(appRoot: string): Promise<Parts> {
  const all: Parts = {};
  const dirs: string[] = [];
  const walk = (d: string): void => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(d, e.name);
      if (e.name === 'parts') dirs.push(full);
      else walk(full);
    }
  };
  walk(join(appRoot, 'src'));
  for (const d of dirs) Object.assign(all, await loadParts(d));
  return all;
}

export async function load(screenPath: string, sharedParts: Parts = {}): Promise<LoadResult> {
  const ir = parse(readFileSync(screenPath, 'utf8'));

  const localParts = await loadParts(join(dirname(screenPath), 'parts')); // parts local to this page
  const inlineParts: Parts = {};                                          // parts declared inline in the .muten
  for (const [name, def] of Object.entries(ir.parts || {})) inlineParts[name] = { ...def, state: {}, entities: {}, mock: {}, css: '' };
  const parts: Parts = { ...sharedParts, ...localParts, ...inlineParts };  // local wins over shared

  const { doc, used } = composeDoc(ir, parts); // inline parts + hoist entity/state -> flat doc

  // hoist used parts' mock data for build-time rendering
  let mock: { [name: string]: Value } = { ...(ir.mock || {}) };
  for (const name of used) { const p = parts[name]; if (p) mock = { ...mock, ...p.mock }; }

  const dataPath = screenPath.replace(/\.muten$/, '.data.json');
  const fileData: { [name: string]: Value } = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : {};
  const data = { ...fileData, ...mock };

  // styles: page-level + each used part's .scss (skipped if the part is unused)
  const pageStyles = await resolveStyles(screenPath);
  const partCss = used.map((n) => parts[n]?.css).filter(Boolean).join('\n\n');
  const css = [pageStyles.css, partCss].filter(Boolean).join('\n\n');

  return { ir, doc, data, sources: ir.sources || {}, styles: { css, from: pageStyles.from }, partNames: Object.keys(parts) };
}
