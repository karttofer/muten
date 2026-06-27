// Oracle-side icon existence check — dependency-free (no @iconify/utils). The SVG inlining that needs
// @iconify/utils happens at vite BUILD; here we only answer "does set:name exist" by reading the set's
// own icons.json directly. This closes a lint≠runtime gap: `Icon "lucide:hand-pointer"` (a name that isn't
// in lucide) passed `check` green, then crashed compile ("no icon named …") and blanked the page. Now the
// oracle (and the live editor) catch it first, with the same clear message — before the build ever breaks.

import fs from 'node:fs';
import { join } from 'node:path';

type IconJson = { icons?: { [name: string]: unknown }; aliases?: { [name: string]: unknown } };
const setCache = new Map<string, IconJson | null>();             // `${appRoot}|${set}` -> parsed set (null = not installed)
const checkers = new Map<string, (ref: string) => string | null>(); // memoized per appRoot (live linter rebuilds context every keystroke)

function loadSet(appRoot: string, set: string): IconJson | null {
  const key = `${appRoot}|${set}`;
  if (setCache.has(key)) return setCache.get(key) ?? null;
  let data: IconJson | null = null;
  try { data = JSON.parse(fs.readFileSync(join(appRoot, 'node_modules', '@iconify-json', set, 'icons.json'), 'utf8')) as IconJson; } catch { data = null; }
  setCache.set(key, data); // ponytail: a newly-installed set needs an editor restart to be picked up (cache never invalidates)
  return data;
}

/** Returns null if the icon resolves (or its shape is validate's job), else a clear, actionable message. */
export function getIconChecker(appRoot: string): (ref: string) => string | null {
  const existing = checkers.get(appRoot);
  if (existing) return existing;
  const fn = (ref: string): string | null => {
    const colon = ref.indexOf(':');
    if (colon < 1) return null;                                  // bad shape — validate already reports it
    const set = ref.slice(0, colon), name = ref.slice(colon + 1);
    const data = loadSet(appRoot, set);
    if (!data) return `the icon set "${set}" isn't installed — run \`npm i -D @iconify-json/${set}\` (or fix the set name).`;
    if (data.icons?.[name] !== undefined || data.aliases?.[name] !== undefined) return null;
    return `no icon named "${name}" in set "${set}".`;
  };
  checkers.set(appRoot, fn);
  return fn;
}
