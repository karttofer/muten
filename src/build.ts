// Build orchestration: a host app (.muten files) → <app>/dist/<url>/index.html + app.map.json.
// A pure-ish library function: it throws on any error; the CLI (bin/muten.ts) formats + exits.

import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Nt } from '#engine/shared/vocab.js';
import { readRoutes } from '#engine/project/routes.js';
import { load, loadAllParts } from '#engine/project/load.js';
import { validate } from '#engine/ir/validate.js';
import { compile } from '#engine/compile/compile.js';
import { formatDiagnostic, ParseError } from '#engine/shared/diagnostics.js';
import type { Diagnostic, AppMap, Value } from '#engine/shared/types.js';

// a source descriptor's URL, for the app graph: a bare URL string, or the `url` of a { url, at } object.
const sourceUrl = (v: Value): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.url === 'string') return v.url;
  return '';
};

export async function buildApp(appRoot: string, outDir = join(appRoot, 'dist')): Promise<{ routes: string[]; outDir: string }> {
  const rel = (p: string) => relative(appRoot, p);
  rmSync(outDir, { recursive: true, force: true }); // clean: no stale routes left from deleted pages

  const sharedParts = await loadAllParts(appRoot); // every part in the app (parts are global)
  if (Object.keys(sharedParts).length) console.log(`Parts: ${Object.keys(sharedParts).join(', ')}`);

  const pages = readRoutes(appRoot); // throws on a missing/duplicate/dangling route
  console.log(`Host app: ${appRoot}`);
  console.log(`Pages: ${pages.map((p) => '/' + p.route).join(', ')}\n`);

  const built: string[] = [];
  // the "root that knows everything" (north star): an index of the app, derived from the build.
  const appMap: AppMap = { app: appRoot.split(/[\\/]/).pop() || '', parts: Object.keys(sharedParts), routes: {} };

  for (const page of pages) {
    let loaded;
    try {
      loaded = await load(page.screenPath, sharedParts); // parse + compose + flatten + data + styles
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      const d: Diagnostic = { code: e.code, severity: 'error', message: e.message, loc: e.loc, suggestion: null };
      throw new Error(`/${page.route}\n   ` + formatDiagnostic(d, rel(page.screenPath)));
    }
    const { doc, data, sources, styles, partNames } = loaded;

    const { ok, diagnostics } = validate(doc, { parts: partNames }); // project-aware: catches part typos too
    if (!ok) throw new Error(`/${page.route}\n` + diagnostics.map((d) => '   ' + formatDiagnostic(d, rel(page.screenPath))).join('\n'));

    // host-written Custom components referenced in the tree (opaque, inlined into the output)
    const customNames = [...new Set(Object.values(doc.nodes).filter((n) => n.type === Nt.Custom).map((n) => n.props?.component))];
    const components: { [name: string]: string } = {};
    for (const name of customNames) {
      if (!name) continue;
      const path = join(appRoot, 'src', 'components', name + '.js');
      if (!existsSync(path)) throw new Error(`/${page.route}: Custom component not found: src/components/${name}.js`);
      components[name] = readFileSync(path, 'utf8');
    }

    const pageOut = join(outDir, page.route);
    mkdirSync(pageOut, { recursive: true });
    writeFileSync(join(pageOut, 'index.html'), compile(doc, data, styles.css, components, sources));
    console.log(`✓ /${page.route}  →  ${rel(join(pageOut, 'index.html'))}  (${Object.keys(doc.nodes).length} nodes${styles.from ? ', + ' + styles.from : ''})`);
    built.push(page.route);

    appMap.routes['/' + page.route] = {
      file: rel(page.screenPath),
      models: Object.keys(doc.entities),
      state: Object.fromEntries(Object.entries(doc.state).map(([name, def]) => [name, typeof def.source === 'string' ? def.source : (def.initial ?? null)])),
      sources: Object.fromEntries(Object.entries(sources).map(([name, src]) => [name, sourceUrl(src)])),
    };
  }

  // the app graph + a route index — but only when no root route ("/") already wrote dist/index.html,
  // so a `/ -> home` build keeps the home page there instead of clobbering it with the listing.
  mkdirSync(outDir, { recursive: true });
  if (!built.includes('')) {
    const links = built.map((route) => `<li><a href="./${route}/">/${route}</a></li>`).join('\n      ');
    writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>app</title>\n<h1>Routes</h1>\n<ul>\n      ${links}\n</ul>\n`);
    console.log(`\n✓ ${rel(join(outDir, 'index.html'))} → route index`);
  }
  writeFileSync(join(outDir, 'app.map.json'), JSON.stringify(appMap, null, 2));
  console.log(`✓ ${rel(join(outDir, 'app.map.json'))} → app graph (the root the AI reads)`);

  return { routes: built, outDir };
}
