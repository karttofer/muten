// Emit targets: assemble the pre-computed pieces (an EmitParts) into the final output of each
// format — self-contained HTML, an ESM page module, an ESM store slice, or a static page.
// The async data layer is written ONCE here (dataLayer) and shared by every runtime format.

import type { EmitParts } from '#engine/shared/types.js';

// the fine-grained signals runtime, inlined into the standalone HTML format (no bundler there).
export const RUNTIME = `// ── fine-grained signals runtime (~18 lines, no dependencies) ──
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
  function __has(a, b) { return Array.isArray(a) ? a.includes(b) : String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()); }`;

// The data layer: a query is a RICH reactive signal { data, loading, error }. Real `sources`
// fetch over HTTP; otherwise a mock with a small delay so loading/error are visible. Written once.
function dataLayer(parts: EmitParts): string {
  return `const __DATA = ${JSON.stringify(parts.data)};
  const __SOURCES = ${JSON.stringify(parts.sources)};
  const __UUIDS = ${JSON.stringify(parts.queryUuids)};
  const __DELAY = 450;
  const __fill = (name, rows) => { const ids = __UUIDS[name] || []; return rows.map((r) => { const o = { ...r }; for (const f of ids) if (o[f] === null || o[f] === undefined) o[f] = __id(); return o; }); };
  function __fetch(name) { const s = __SOURCES[name]; if (s) { const url = typeof s === 'string' ? s : s.url; const at = typeof s === 'string' ? null : s.at; return fetch(url).then((r) => r.json()).then((j) => __fill(name, at ? (j[at] ?? []) : (Array.isArray(j) ? j : []))); } return new Promise((res) => setTimeout(() => res(__fill(name, __DATA[name] ?? [])), __DELAY)); }
  function query(name) { const sig = signal({ data: [], loading: true, error: null }); __fetch(name).then((d) => sig.set({ data: d, loading: false, error: null })).catch((e) => sig.set({ data: [], loading: false, error: String(e) })); return sig; }`;
}

// one .store DOMAIN slice → shared ESM module (state + get + actions, no DOM).
export function emitStore(parts: EmitParts): string {
  return `import { signal, computed, effect, __id, __has } from 'virtual:muten/runtime';

  ${dataLayer(parts)}

${parts.stateDecls}

${parts.getDecls}

${parts.actionDecls}

${parts.effectDecls}
`;
}

// a static page (no reactivity): plain HTML, NO runtime import, NO signals (Astro-like zero-JS).
export function emitStatic(parts: EmitParts): string {
  return `export const screen = ${JSON.stringify(parts.screen)};
export const css = ${JSON.stringify(`${parts.tokenCss}\n${parts.projectCss}`)};
export function mount(app) { app.innerHTML = ${JSON.stringify(parts.staticHtml)}; return app; }
`;
}

// an ESM page module Vite bundles (npm imports, HMR, SPA).
export function emitModule(parts: EmitParts): string {
  return `import { signal, effect, __id, __has } from 'virtual:muten/runtime';
${parts.storeImports}
export const screen = ${JSON.stringify(parts.screen)};
export const css = ${JSON.stringify(`${parts.tokenCss}\n${parts.projectCss}`)};

export function mount(app) {
  ${dataLayer(parts)}

  ${parts.stateDecls}

  ${parts.actionDecls}

  ${parts.componentDecls}

  ${parts.renderBody}
  return ${parts.hasSlot ? '__outlet' : 'app'};
}
`;
}

// a self-contained HTML document (the runtime is inlined; the browser runs it directly).
export function emitHtml(parts: EmitParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${parts.screen}</title>
<style>
  /* engine: only the used tokens — no base styles (those are the project's stylesheet) */
  ${parts.tokenCss}
  /* project: overrides the above via the cascade (bring-your-own-theme) */
  ${parts.projectCss}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
  ${RUNTIME}

  // ── dynamic ids (nothing hardcoded) ──
  let __seq = 0;
  function __id() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + (++__seq); }

  ${dataLayer(parts)}

  // ── declared state (state from the IR) ──
  ${parts.stateDecls}

  // ── actions (actions from the IR) ──
  ${parts.actionDecls}

  // ── custom components (host-written, opaque to the IR) ──
  ${parts.componentDecls}

  // ── render: imperative DOM + fine-grained effects ──
  const app = document.getElementById('app');
  ${parts.renderBody}
</script>
</body>
</html>
`;
}
