// `muten add <component...>` — the registry seam's CLI. Copies a component's source (a muten part) from an
// installed registry package into the app's src/parts/. This is the "own the source" model: you don't depend on
// a black box, you get the .muten file and edit it. The core ships this command; PLUGINS ship the registry data.
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';

// `component` (PascalCase) marks a Custom-backed entry: besides the .muten part, copy the sibling .js
// (same basename) into src/components/<component>.js, where muten's `Custom` primitive loads it.
interface RegistryEntry { name: string; part: string; file: string; component?: string; description?: string; deps?: string[]; }
interface Registry { name?: string; components: RegistryEntry[]; }
interface Source { dir: string; reg: Registry; }

// A registry is any installed dependency whose package root holds a `registry.json`.
function discoverRegistries(root: string): Source[] {
  const out: Source[] = [];
  const req = createRequire(join(root, 'package.json'));
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); }
  catch { return out; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const name of Object.keys(deps)) {
    try {
      const regPath = req.resolve(name + '/registry.json'); // resolved via the package's exports; a dep with no registry just throws
      if (existsSync(regPath)) out.push({ dir: dirname(regPath), reg: JSON.parse(readFileSync(regPath, 'utf8')) as Registry });
    } catch { /* not a registry package — skip */ }
  }
  return out;
}

export function addComponents(root: string, names: string[]): void {
  const sources = discoverRegistries(root);
  if (!sources.length) { console.error('✖ no component registry installed. Add one first, e.g. `npm i @muten/shadcn`.'); process.exit(1); }

  const index = new Map<string, { dir: string; entry: RegistryEntry }>();
  for (const { dir, reg } of sources) for (const e of reg.components || []) if (!index.has(e.name)) index.set(e.name, { dir, entry: e });

  const partsDir = join(root, 'src', 'parts');
  mkdirSync(partsDir, { recursive: true });

  const queue = [...names];
  const seen = new Set<string>();
  const added: string[] = [];
  let missing = false;
  while (queue.length) {
    const n = queue.shift();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const hit = index.get(n);
    if (!hit) { console.error(`✖ unknown component "${n}" (not in any installed registry)`); missing = true; continue; }
    copyFileSync(join(hit.dir, hit.entry.file), join(partsDir, basename(hit.entry.file)));
    added.push(`${hit.entry.part}  →  src/parts/${basename(hit.entry.file)}`);
    if (hit.entry.component) { // Custom-backed: copy the host .js into src/components/ so `Custom` can load it
      const compDir = join(root, 'src', 'components');
      mkdirSync(compDir, { recursive: true });
      const jsSrc = join(hit.dir, hit.entry.file.replace(/\.muten$/, '.js'));
      if (existsSync(jsSrc)) { copyFileSync(jsSrc, join(compDir, hit.entry.component + '.js')); added.push(`${hit.entry.component} (Custom)  →  src/components/${hit.entry.component}.js`); }
    }
    for (const d of hit.entry.deps || []) if (!seen.has(d)) queue.push(d);   // pull dependencies in too
  }
  console.log(`✓ added ${added.length} component${added.length === 1 ? '' : 's'}${added.length ? ':' : ''}`);
  for (const a of added) console.log('  ' + a);
  if (missing) process.exit(1);
}
