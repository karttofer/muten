// Vite plugin: compiles .muten files to ESM modules (mount + css) and serves the runtime,
// stores, shell, and router entry as virtual modules. Gives a Muten app a full dev server,
// HMR, and navigation while authoring stays in the .muten DSL.
// Consumed by host apps via vite.config.(t|j)s: plugins: [muten()].

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Plugin, ResolvedConfig, HmrContext, ViteDevServer } from 'vite';
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { load, loadAllParts, findStores } from '#engine/project/load.js';
import { validate } from '#engine/ir/validate.js';
import { compileModule, compileStore } from '#engine/compile/compile.js';
import { mergeTheme, emitTheme } from '#engine/style/tokens.js';
import { Nt } from '#engine/shared/vocab.js';
import type { IR, Theme, ThemeRaw, ClassValidator, MutenOptions, StoreSlice, PartDef } from '#engine/shared/types.js';

// virtual module IDs this plugin owns (leading \0 prevents Vite from resolving them to disk).
const RID = 'virtual:muten/runtime';
const STORE_PREFIX = 'virtual:muten/store/';
const SHELL = 'virtual:muten/shell';

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME = readFileSync(join(here, 'runtime.js'), 'utf8'); // browser runtime served verbatim as the virtual:muten/runtime module

export default function muten(options: MutenOptions = {}): Plugin {
  const storeEnabled = options.store !== false;
  let theme: Theme = mergeTheme(options.theme);  // merged scale for style() tokens; overridden by theme.muten
  let themeRaw: ThemeRaw = options.theme || {};  // FULL theme.muten (incl. colors/radius) for the native theme emit
  let classValidator: ClassValidator | undefined; // class() checker backed by the framework's design system
  let appRoot = process.cwd();
  let parts: { [name: string]: PartDef } = {};
  let slices: { [domain: string]: IR } = {};
  const storesMeta: { [domain: string]: StoreSlice } = {}; // members each store exposes, needed for ref resolution in validate + codegen
  let appIr: IR | undefined;                      // parsed app.muten (shell + routes)
  let stylesHref: string | null = null;           // project stylesheet (/src/styles.css|scss), injected by the boot module

  // Generates the self-booting entry module. index.html imports /src/app.muten; the transform hook
  // rewrites it to this: imports the shell + route map (with guards) + stylesheet, then mounts onto
  // #app. The app needs no hand-written main.js.
  const buildBoot = (): string => {
    const guardDomains = new Set<string>();
    const routes = (appIr?.routes || []).map((r) => {
      const path = JSON.stringify('/' + r.url.replace(/^\//, ''));
      const imp = `() => import(${JSON.stringify('/src/pages/' + r.page + '/' + r.page + '.muten')})`;
      if (r.guard) {
        const [domain, field] = r.guard.split('.');
        guardDomains.add(domain);
        return `  ${path}: { load: ${imp}, guard: () => ${r.guardNeg ? '!' : ''}__store_${domain}.${field}.get(), redirect: ${JSON.stringify(r.redirect)} },`;
      }
      return `  ${path}: { load: ${imp} },`;
    }).join('\n');
    const guardImports = [...guardDomains].map((domain) => `import * as __store_${domain} from '${STORE_PREFIX}${domain}';`).join('\n');
    return `import * as __shell from '${SHELL}';
import { route, injectCss } from '${RID}';
${stylesHref ? `import ${JSON.stringify(stylesHref)};\n` : ''}${guardImports}
const routes = {
${routes}
};
const root = document.getElementById('app');
if (root) {
  injectCss(__shell.css);
  const outlet = __shell.mount(root);
  route(outlet, routes);
}`;
  };

  // (Re)scan the project: parts, store slices, app root, theme, stylesheet.
  // Runs at startup and on each relevant file change in dev. These are read from disk (not the module
  // graph), so without a rescan a newly added/edited part would wrongly report "not a known part".
  const loadProject = async (): Promise<void> => {
    parts = await loadAllParts(appRoot);
    for (const k of Object.keys(storesMeta)) delete storesMeta[k]; // clear stale metadata before repopulating
    if (storeEnabled) {
      slices = findStores(join(appRoot, 'src'));
      for (const [domain, ir] of Object.entries(slices)) {
        storesMeta[domain] = { state: Object.keys(ir.state || {}), gets: Object.keys(ir.gets || {}), actions: Object.keys(ir.actions || {}) };
      }
    }
    const rootFile = join(appRoot, 'src', 'app.muten');
    appIr = existsSync(rootFile) ? parse(readFileSync(rootFile, 'utf8')) : undefined;
    const themeFile = join(appRoot, 'theme.muten');
    themeRaw = existsSync(themeFile) ? (parse(readFileSync(themeFile, 'utf8')).theme || {}) : (options.theme || {});
    theme = mergeTheme(themeRaw);
    stylesHref = null;
    let stylesPath: string | null = null;
    for (const name of ['styles.css', 'styles.scss']) {
      const p = join(appRoot, 'src', name);
      if (existsSync(p)) { stylesHref = '/src/' + name; stylesPath = p; break; }
    }
    // class() validation is a styling-plugin concern (library-specific), never baked into the core.
    // If a plugin is connected via `muten({ styling: { validate } })`, use it; else class() is unchecked.
    classValidator = (stylesPath && options.styling?.validate) ? await options.styling.validate(stylesPath, appRoot, themeRaw) : undefined;
  };

  // Debounced HMR handler. Pages inline parts/data/theme; shell and stores are virtual modules.
  // Vite served cached output after edits, requiring a manual restart. Fix: re-read disk, invalidate
  // all muten modules from the graph, then full-reload so every .muten/.store/theme/style edit is live.
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const reload = (server: ViteDevServer): void => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      loadProject().then(() => {
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          const id = mod.id || '';
          if (id.endsWith('.muten') || id.endsWith('/styles.css') || id.endsWith('/styles.scss') || id.includes('virtual:muten/shell') || id.includes('virtual:muten/store/')) {
            server.moduleGraph.invalidateModule(mod); // styles too: a theme.muten edit must re-inject the native theme block
          }
        }
        server.ws.send({ type: 'full-reload' });
      });
    }, 30);
  };

  return {
    name: 'vite-plugin-muten',
    enforce: 'pre',

    // resolve the project once at startup; refreshed on file change in dev via reload().
    async configResolved(config: ResolvedConfig) {
      appRoot = config.root;
      await loadProject();
    },

    resolveId(id: string) { if (id === RID || id === SHELL || id.startsWith(STORE_PREFIX)) return '\0' + id; },

    load(id: string) {
      if (id === '\0' + RID) return RUNTIME; // browser runtime, served as-is

      if (id.startsWith('\0' + STORE_PREFIX)) { // one store domain -> compiled ESM slice
        const ir = slices[id.slice(('\0' + STORE_PREFIX).length)];
        if (ir) {
          // A store compiles to a VIRTUAL module, so a relative `use … from "./x"` has no disk anchor.
          // Rewrite it to a root-absolute path (the store lives at <root>/src/<domain>.store).
          const imports = (ir.imports || []).map((im) => im.from.startsWith('.') ? { ...im, from: '/' + join('src', im.from).replace(/\\/g, '/') } : im);
          return compileStore({ state: ir.state || {}, gets: ir.gets || {}, actions: ir.actions || {}, effects: ir.effects || [], entities: ir.entities || {}, imports }, ir.mock || {}, ir.sources || {});
        }
      }

      if (id === '\0' + SHELL) { // persistent chrome (navbar + slot); falls back to a bare outlet if no shell defined
        const tree = appIr?.shell || { type: Nt.Shell, props: {}, children: [{ type: Nt.Slot, props: {} }] };
        const doc = toDoc({ ...(appIr || {}), screen: 'shell', entities: {}, state: {}, actions: {}, tree }); // spread appIr so shell `imports` survive; chrome stays state/action-free
        // shell + pages emit only their token CSS; reset/base lives in the project stylesheet
        // loaded once via main, so there's no duplicate .stack fighting the cascade.
        return compileModule(doc, {}, '', {}, {}, { stores: storesMeta, theme });
      }

    },

    async transform(code: string, id: string) {
      // theme.muten -> the TARGET library's NATIVE theme block, appended to the project stylesheet.
      // `enforce: 'pre'` runs before @tailwindcss/vite. The adapter (which library + how to emit) comes
      // from theme.muten's `target` resolved against presets / `muten({ adapters })` — engine knows no library.
      const sheet = id.replace(/\\/g, '/').split('?')[0];
      if (sheet.endsWith('/styles.css') || sheet.endsWith('/styles.scss')) {
        const block = emitTheme(themeRaw, options.styling?.theme);
        return block ? { code: code + '\n\n/* muten: generated from theme.muten */\n' + block, map: null } : null;
      }
      if (!id.endsWith('.muten')) return null;
      if (id.replace(/\\/g, '/').endsWith('/src/app.muten')) return { code: buildBoot(), map: null }; // app root is the boot entry
      const loaded = await load(id, parts); // engine load() with parts gathered up front, not the Vite hook above
      // storeMembers (domain -> state/get/action names) lets validate allow `cart.count` refs and
      // page-to-store action composition. Without it, both are wrongly rejected.
      const storeMembers: { [d: string]: string[] } = {};
      for (const [d, m] of Object.entries(storesMeta)) storeMembers[d] = [...(m.state || []), ...(m.gets || []), ...(m.actions || [])];
      const { ok, diagnostics } = validate(loaded.doc, { parts: loaded.partNames, stores: Object.keys(storesMeta), storeMembers, theme, classValidator });
      if (!ok) throw new Error('muten: ' + diagnostics.map((d) => d.message).join(' · '));

      const customNames = [...new Set(Object.values(loaded.doc.nodes).filter((n) => n.type === Nt.Custom).map((n) => n.props?.component))];
      const components: { [name: string]: string } = {};
      for (const name of customNames) {
        if (!name) continue;
        const path = join(appRoot, 'src', 'components', name + '.js');
        if (existsSync(path)) components[name] = readFileSync(path, 'utf8');
      }

      return { code: compileModule(loaded.doc, loaded.data, loaded.styles.css, components, loaded.sources, { stores: storesMeta, theme, api: appIr?.api || {} }), map: null };
    },

    handleHotUpdate(ctx: HmrContext) {
      // return [] so Vite skips its default HMR; reload() handles invalidation + full-reload
      if (ctx.file.endsWith('.muten') || ctx.file.endsWith('.store')) { reload(ctx.server); return []; }
    },

    configureServer(server: ViteDevServer) {
      // Parts, stores, theme, app.muten, and styles are read from disk (not the module graph) and
      // pages inline them, so HMR alone never sees changes to these files. Watch everything muten-relevant:
      // add/change/unlink -> reload() re-reads, invalidates, and full-reloads (debounced).
      const onFile = (f: string): void => {
        const p = f.replace(/\\/g, '/');
        // covers .muten/.store/styles and Custom component JS (pages inline these too)
        if (p.endsWith('.muten') || p.endsWith('.store') || p.endsWith('/styles.css') || p.endsWith('/styles.scss')
          || (p.includes('/components/') && p.endsWith('.js'))) reload(server);
      };
      server.watcher.on('add', onFile);
      server.watcher.on('change', onFile);
      server.watcher.on('unlink', onFile);

      // Vite won't route /src/app.muten through `transform` on a direct browser fetch (it's not a JS file).
      // Serve the compiled boot explicitly. Production resolves it via transform + Rollup.
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0] !== '/src/app.muten') { next(); return; }
        server.transformRequest('/src/app.muten').then((result) => {
          if (!result) { next(); return; }
          res.setHeader('Content-Type', 'text/javascript');
          res.end(result.code);
        }, next);
      });
    },
  };
}
