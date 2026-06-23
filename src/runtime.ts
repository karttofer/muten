// Fine-grained signals runtime — the only Muten code that ships to the browser, shared by every
// compiled .muten module. The Vite plugin serves it as the virtual module `virtual:muten/runtime`;
// the standalone HTML format inlines an equivalent. No dependencies, ~50 lines.

import type { Signal, EffectRun, PageModule, RouteDef } from '#engine/shared/types.js';

let current: EffectRun | null = null;            // the effect currently running (so reads can subscribe it)
let owner: Array<EffectRun | (() => void)> | null = null;   // effects AND onCleanup teardowns created in the current scope → disposed together

// A reactive cell. Reading it inside an effect subscribes that effect; writing notifies subscribers.
export function signal<T>(value: T): Signal<T> {
  const subs = new Set<EffectRun>();
  return {
    get() { if (current) { subs.add(current); current.deps.add(subs); } return value; },
    set(next: T) { if (next === value) return; value = next; for (const run of [...subs]) run.sync ? run() : schedule(run); },
  };
}

// Batching (Solid-style): many sets in one tick flush their effects ONCE, in a microtask — so a burst
// of updates (a real-time feed) re-renders each spot a single time. Computed effects are `sync` (run
// immediately) so a `get` read elsewhere in the same tick is never stale.
let pending: Set<EffectRun> | null = null;
function flush(): void { const runs = pending; pending = null; if (runs) for (const run of runs) run(); }
function schedule(run: EffectRun): void { if (!pending) { pending = new Set(); queueMicrotask(flush); } pending.add(run); }

// Run `fn`, tracking every signal it reads; re-run it whenever any of those signals changes.
export function effect(fn: () => void, sync?: boolean): EffectRun {
  const run: EffectRun = Object.assign(
    () => {
      if (run.disposed) return;
      for (const dep of run.deps) dep.delete(run); // drop last run's subscriptions before re-tracking
      run.deps.clear();
      const prev = current; current = run;
      try { fn(); } finally { current = prev; }
    },
    { deps: new Set<Set<EffectRun>>(), disposed: false, sync },
  );
  if (owner) owner.push(run); // belongs to the page currently mounting → disposable on navigation
  run();
  return run;
}

// Run `fn`, collecting every effect it creates, and return a disposer that stops them all. The router
// uses this so an unmounted page's effects stop firing on shared store signals (cart/ui) — otherwise
// they touch detached DOM (anchor.parentNode === null) and crash the whole UI.
function disposeOwned(owned: Array<EffectRun | (() => void)>): void {
  for (const o of owned) {
    if ('deps' in o) { o.disposed = true; for (const dep of o.deps) dep.delete(o); o.deps.clear(); } // an effect
    else o(); // an onCleanup teardown (a keyed list disposing its rows, a when disposing its block)
  }
}
export function root<T>(fn: () => T): { value: T; dispose: () => void } {
  const prev = owner; const owned: Array<EffectRun | (() => void)> = []; owner = owned;
  let value: T; try { value = fn(); } finally { owner = prev; }
  return { value, dispose: () => disposeOwned(owned) };
}
export function scope(fn: () => void): () => void { return root(fn).dispose; }
export function onCleanup(fn: () => void): void { if (owner) owner.push(fn); }

// `a contains b`: list membership OR case-insensitive substring — one operator, both meanings.
export function __has<T>(a: readonly T[] | string | null | undefined, b: T): boolean {
  if (Array.isArray(a)) return a.includes(b);
  return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
}

// Shallow value equality — keyed reconciliation skips rows whose data didn't change.
export function __eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

// A derived/memoized value (a store `get`): recomputes when the signals it reads change. Seeded once
// eagerly (a `get` is pure), then kept current by an effect that tracks its dependencies.
export function computed<T>(fn: () => T): Signal<T> {
  const cell = signal(fn());
  effect(() => cell.set(fn()), true); // sync: a `get` read in the same tick is always fresh (no batching glitch)
  return cell;
}

let seq = 0;
export function __id(): string {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + (++seq);
}

// Inject a page/shell stylesheet once, deduped by content (so re-mounting a route doesn't pile up <style>s).
const injected = new Set<string>();
export function injectCss(css: string): void {
  if (!css || injected.has(css)) return;
  injected.add(css);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// Apply a page's `meta` to <head>: set the title and upsert each meta tag (og:* → property, else name).
export function applyMeta(meta: { [key: string]: string }): void {
  if (meta.title) document.title = meta.title;
  for (const name in meta) {
    if (name === 'title' || !meta[name]) continue;
    const attr = name.indexOf('og:') === 0 ? 'property' : 'name';
    let el = document.head.querySelector(`meta[${attr}="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute('content', meta[name]);
  }
}

// History router: real-path URLs (`/about`, `/product/42`). Intercepts internal <a> clicks for client-side
// navigation, syncs on popstate, scrolls to top, applies each page's <head> meta, and falls back to the
// first route as a soft 404. A guard is a () => boolean over a store signal; when it flips the tracking
// effect re-runs, so routes + navbar react to auth automatically. (Deploy: serve index.html for any path.)
export function route(outlet: Element, routes: { [path: string]: RouteDef }): void {
  const keys = Object.keys(routes);
  // pre-split each route key into segments; a ":x" segment matches any value and captures it as `x`.
  const patterns = keys.map((key) => ({ key, segs: key.replace(/^\//, '').split('/').filter(Boolean) }));
  // match a path to a route + capture its `:params`; fall back to the first route (a soft 404).
  const matchRoute = (path: string): { def: RouteDef; params: { [k: string]: string } } => {
    const parts = path.replace(/^\//, '').split('/').filter(Boolean);
    for (const { key, segs } of patterns) {
      if (segs.length !== parts.length) continue;
      const params: { [k: string]: string } = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i][0] === ':') params[segs[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (segs[i] !== parts[i]) { ok = false; break; }
      }
      if (ok) return { def: routes[key], params };
    }
    return { def: routes['/404'] || routes[keys[0]], params: {} }; // no match → a `/404` page if defined, else the first route
  };
  let mounted: string | null = null;        // path currently shown (don't re-mount on every auth tick)
  let disposePage: (() => void) | null = null;
  const go = (to: string): void => { if (to !== location.pathname) { history.pushState({}, '', to); mounted = null; render(); } };
  const render = (): void => {
    const path = location.pathname || keys[0];
    const { def, params } = matchRoute(path);
    if (def.guard && !def.guard()) {          // unauthorized → redirect (replaceState, then re-render)
      const to = def.redirect ?? '/';
      if (location.pathname !== to) { history.replaceState({}, '', to); mounted = null; render(); }
      return;
    }
    if (path === mounted) return;
    mounted = path;
    if (disposePage) disposePage();           // stop the previous page's effects → no stale-DOM crashes
    disposePage = null;
    outlet.replaceChildren();
    scrollTo(0, 0);
    def.load().then((module: PageModule) => {
      injectCss(module.css);
      if (module.meta) applyMeta(module.meta);
      disposePage = scope(() => { module.mount(outlet, params); });
    });
  };
  // intercept internal link clicks → client-side navigation (external / new-tab / downloads pass through)
  addEventListener('click', (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const a = t.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href[0] === '#' || a.getAttribute('target') || a.hasAttribute('download') || /^[a-z]+:|^\/\//i.test(href)) return;
    e.preventDefault();
    go(href);
  });
  addEventListener('popstate', () => { mounted = null; render(); });
  // track every guard signal so logging in/out re-renders the active route automatically.
  effect(() => { for (const key of keys) { const guard = routes[key].guard; if (guard) guard(); } render(); });
}
