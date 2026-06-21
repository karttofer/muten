// Fine-grained signals runtime — shared by every compiled .muten module (~18 lines, no deps).
// Provided to the bundle by vite-plugin-muten as the virtual module `virtual:muten/runtime`.
let __current = null; // the running effect (dependency tracking)
let __scope = null;   // collects effects created while mounting a page → disposed on unmount

export function signal(value) {
  const subs = new Set();
  return {
    get() { if (__current) { subs.add(__current); __current.deps.add(subs); } return value; },
    set(next) { if (next === value) return; value = next; for (const e of [...subs]) e(); },
  };
}

export function effect(fn) {
  const run = () => {
    if (run.disposed) return;
    for (const dep of run.deps) dep.delete(run); // drop stale subscriptions before re-running
    run.deps.clear();
    const prev = __current; __current = run;
    try { fn(); } finally { __current = prev; }
  };
  run.deps = new Set();
  run.disposed = false;
  if (__scope) __scope.push(run); // owned by the current page → disposable
  run();
  return run;
}

// Run fn collecting every effect it creates; returns a disposer that stops them. The router uses
// this so an UNMOUNTED page's effects stop firing on shared store signals (cart/ui) — otherwise
// they touch detached DOM (anchor.parentNode === null) and crash the whole UI.
export function scope(fn) {
  const prev = __scope; const owned = []; __scope = owned;
  try { fn(); } finally { __scope = prev; }
  return () => { for (const run of owned) { run.disposed = true; for (const dep of run.deps) dep.delete(run); run.deps.clear(); } };
}

// `a contains b`: list membership OR case-insensitive substring (one operator, both meanings).
export function __has(a, b) {
  if (Array.isArray(a)) return a.includes(b);
  return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
}

// derived/memoized value (a store `get`): recomputes when its signal deps change.
export function computed(fn) {
  const s = signal(undefined);
  effect(() => s.set(fn()));
  return { get: () => s.get() };
}

let __seq = 0;
export function __id() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + (++__seq); }

// inject a page/shell stylesheet once (deduped by content)
const __injected = new Set();
export function injectCss(css) {
  if (!css || __injected.has(css)) return;
  __injected.add(css);
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

// hash router: mount the active route's page module into `outlet`, swap on hashchange.
// routes = { '/path': { load, guard?, redirect? } }. A guard is a () => boolean reading a store
// signal; when it flips (login/logout) the effect re-runs, so navbar/routes react automatically.
export function route(outlet, routes) {
  const keys = Object.keys(routes);
  let mounted = null;     // path currently shown (don't re-mount on every auth tick)
  let disposePage = null; // disposer for the mounted page's effects
  const render = () => {
    const path = (location.hash || '').replace(/^#/, '') || keys[0];
    const r = routes[path] || routes[keys[0]];
    if (r.guard && !r.guard()) { // unauthorized → redirect (the hashchange re-triggers render)
      if (location.hash !== '#' + r.redirect) location.hash = r.redirect;
      return;
    }
    if (path === mounted) return;
    mounted = path;
    if (disposePage) disposePage(); // stop the previous page's effects → no stale-DOM crashes
    disposePage = null;
    outlet.replaceChildren();
    r.load().then((m) => { injectCss(m.css); disposePage = scope(() => m.mount(outlet)); });
  };
  addEventListener('hashchange', () => { mounted = null; render(); });
  effect(() => { for (const k of keys) routes[k].guard && routes[k].guard(); render(); }); // track guard signals → re-render on auth change
}
