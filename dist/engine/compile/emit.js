const n=`// \u2500\u2500 fine-grained signals runtime (~18 lines, no dependencies) \u2500\u2500
  let __current = null;
  function signal(value) {
    const subs = new Set();
    return {
      get() { if (__current) subs.add(__current); return value; },
      set(next) { if (next === value) return; value = next; for (const e of [...subs]) e(); },
    };
  }
  function effect(fn) {
    const run = () => { const prev = __current; __current = run; try { fn(); } finally { __current = prev; } };
    run();
  }
  function __has(a, b) { return Array.isArray(a) ? a.includes(b) : String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()); }`;function t(e){return`const __DATA = ${JSON.stringify(e.data)};
  const __SOURCES = ${JSON.stringify(e.sources)};
  const __UUIDS = ${JSON.stringify(e.queryUuids)};
  const __DELAY = 450;
  const __fill = (name, rows) => { const ids = __UUIDS[name] || []; return rows.map((r) => { const o = { ...r }; for (const f of ids) if (o[f] === null || o[f] === undefined) o[f] = __id(); return o; }); };
  function __fetch(name) { const s = __SOURCES[name]; if (s) { const url = typeof s === 'string' ? s : s.url; const at = typeof s === 'string' ? null : s.at; return fetch(url).then((r) => r.json()).then((j) => __fill(name, at ? (j[at] ?? []) : (Array.isArray(j) ? j : []))); } return new Promise((res) => setTimeout(() => res(__fill(name, __DATA[name] ?? [])), __DELAY)); }
  function query(name) { const sig = signal({ data: [], loading: true, error: null }); __fetch(name).then((d) => sig.set({ data: d, loading: false, error: null })).catch((e) => sig.set({ data: [], loading: false, error: String(e) })); return sig; }`}function r(e){return`import { signal, computed, effect, __id, __has } from 'virtual:muten/runtime';

  ${t(e)}

${e.stateDecls}

${e.getDecls}

${e.actionDecls}

${e.effectDecls}
`}function o(e){return`export const screen = ${JSON.stringify(e.screen)};
export const css = ${JSON.stringify(`${e.tokenCss}
${e.projectCss}`)};
export function mount(app) { app.innerHTML = ${JSON.stringify(e.staticHtml)}; return app; }
`}function s(e){return`import { signal, effect, __id, __has } from 'virtual:muten/runtime';
${e.storeImports}
export const screen = ${JSON.stringify(e.screen)};
export const css = ${JSON.stringify(`${e.tokenCss}
${e.projectCss}`)};

export function mount(app) {
  ${t(e)}

  ${e.stateDecls}

  ${e.actionDecls}

  ${e.componentDecls}

  ${e.renderBody}
  return ${e.hasSlot?"__outlet":"app"};
}
`}function i(e){return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e.screen}</title>
<style>
  /* engine: only the used tokens \u2014 no base styles (those are the project's stylesheet) */
  ${e.tokenCss}
  /* project: overrides the above via the cascade (bring-your-own-theme) */
  ${e.projectCss}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
  ${n}

  // \u2500\u2500 dynamic ids (nothing hardcoded) \u2500\u2500
  let __seq = 0;
  function __id() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + (++__seq); }

  ${t(e)}

  // \u2500\u2500 declared state (state from the IR) \u2500\u2500
  ${e.stateDecls}

  // \u2500\u2500 actions (actions from the IR) \u2500\u2500
  ${e.actionDecls}

  // \u2500\u2500 custom components (host-written, opaque to the IR) \u2500\u2500
  ${e.componentDecls}

  // \u2500\u2500 render: imperative DOM + fine-grained effects \u2500\u2500
  const app = document.getElementById('app');
  ${e.renderBody}
<\/script>
</body>
</html>
`}export{n as RUNTIME,i as emitHtml,s as emitModule,o as emitStatic,r as emitStore};
