// Vite plugin: compiles `.muten` files to ESM modules (mount + css) via the Muten engine, and
// serves the runtime, the app-global stores, the persistent shell, and the router entry — so a
// Muten app gets npm + dev server + HMR + navigation, while authoring stays the .muten DSL.
//
//   muten()                → store on if any `.store` exists; shell+router from app.muten
//   muten({ store:false }) → store off
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { parse } from './engine/parse.js';
import { toDoc } from './engine/flatten.js';
import { load, loadAllParts } from './engine/load.js';
import { validate } from './engine/validate.js';
import { compileModule, compileStore } from './engine/compile.js';
import { mergeTheme } from './engine/tokens.js';

const RID = 'virtual:muten/runtime';
const SPREFIX = 'virtual:muten/store/';
const SHELL = 'virtual:muten/shell';
const APP = 'virtual:muten/app';
const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME = readFileSync(join(here, 'runtime.js'), 'utf8');

function findStores(dir, out = {}) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) findStores(full, out);
    else if (e.name.endsWith('.store')) out[basename(e.name, '.store')] = parse(readFileSync(full, 'utf8'));
  }
  return out;
}

export default function muten(options = {}) {
  const storeEnabled = options.store !== false;
  let theme = mergeTheme(options.theme); // the PROJECT's theme; overridden by theme.muten if present
  let appRoot = process.cwd();
  let parts = {};
  let slices = {};
  let storesMeta = {};
  let appIr = {}; // parsed app.muten (shell + routes)

  return {
    name: 'vite-plugin-muten',
    enforce: 'pre',

    async configResolved(cfg) {
      appRoot = cfg.root;
      parts = await loadAllParts(appRoot);
      if (storeEnabled) {
        slices = findStores(join(appRoot, 'src'));
        for (const [domain, ir] of Object.entries(slices)) {
          storesMeta[domain] = { state: Object.keys(ir.state || {}), gets: Object.keys(ir.gets || {}), actions: Object.keys(ir.actions || {}) };
        }
      }
      const rootFile = join(appRoot, 'src', 'app.muten');
      if (existsSync(rootFile)) appIr = parse(readFileSync(rootFile, 'utf8'));
      // theme.muten (authored in Muten, scaffolded by the CLI): `const theme = { space {…} base "…" }`
      const themeFile = join(appRoot, 'theme.muten');
      if (existsSync(themeFile)) theme = mergeTheme(parse(readFileSync(themeFile, 'utf8')).theme || {});
    },

    resolveId(id) { if (id === RID || id === SHELL || id === APP || id.startsWith(SPREFIX)) return '\0' + id; },

    load(id) {
      if (id === '\0' + RID) return RUNTIME;

      if (id.startsWith('\0' + SPREFIX)) {
        const ir = slices[id.slice(('\0' + SPREFIX).length)];
        if (ir) return compileStore({ state: ir.state || {}, gets: ir.gets || {}, actions: ir.actions || {}, effects: ir.effects || [], entities: ir.entities || {} }, ir.mock || {}, ir.sources || {});
      }

      if (id === '\0' + SHELL) { // persistent chrome (navbar + slot). Fallback: just an outlet.
        const tree = appIr.shell || { type: 'Shell', props: {}, children: [{ type: 'slot', props: {} }] };
        const doc = toDoc({ screen: 'shell', entities: {}, state: {}, actions: {}, tree });
        // the shell mounts once at start() → it carries BASE (reset + .stack + heading sizes) so
        // BASE is injected EXACTLY once; pages emit only their token CSS (no duplicate .stack that
        // would override .t-row/.t-grid via the cascade and collapse layouts to vertical).
        return compileModule(doc, {}, '', {}, {}, { stores: storesMeta, base: true, theme });
      }

      if (id === '\0' + APP) { // the router entry: shell + route→module map (+ guards) + boot
        const guardDomains = new Set();
        const routes = (appIr.routes || []).map((r) => {
          const path = JSON.stringify('/' + r.url.replace(/^\//, ''));
          const imp = `() => import(${JSON.stringify('/src/pages/' + r.page + '/' + r.page + '.muten')})`;
          if (r.guard) {
            const [d, f] = r.guard.split('.');
            guardDomains.add(d);
            return `  ${path}: { load: ${imp}, guard: () => ${r.guardNeg ? '!' : ''}__store_${d}.${f}.get(), redirect: ${JSON.stringify(r.redirect)} },`;
          }
          return `  ${path}: { load: ${imp} },`;
        }).join('\n');
        const guardImports = [...guardDomains].map((d) => `import * as __store_${d} from '${SPREFIX}${d}';`).join('\n');
        return `import * as __shell from '${SHELL}';
import { route, injectCss } from '${RID}';
${guardImports}
const routes = {
${routes}
};
export function start(root) {
  injectCss(__shell.css);
  const outlet = __shell.mount(root);
  route(outlet, routes);
}`;
      }
    },

    async transform(code, id) {
      if (!id.endsWith('.muten')) return null;
      const loaded = await load(id, parts);
      const { ok, diagnostics } = validate(loaded.doc, { parts: loaded.partNames, stores: Object.keys(storesMeta), theme });
      if (!ok) this.error('muten: ' + diagnostics.map((d) => d.message).join(' · '));

      const customNames = [...new Set(Object.values(loaded.doc.nodes)
        .filter((n) => n.type === 'Custom').map((n) => n.props?.component).filter(Boolean))];
      const components = {};
      for (const name of customNames) {
        const cp = join(appRoot, 'src', 'components', name + '.js');
        if (existsSync(cp)) components[name] = readFileSync(cp, 'utf8');
      }

      return { code: compileModule(loaded.doc, loaded.data, loaded.styles.css, components, loaded.sources, { stores: storesMeta, theme }), map: null };
    },

    handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.muten') || ctx.file.endsWith('.store')) ctx.server.ws.send({ type: 'full-reload' });
    },
  };
}
