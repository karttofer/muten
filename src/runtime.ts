// Fine-grained signals runtime — the only Muten code that ships to the browser, shared by every
// compiled .muten module. The Vite plugin serves it as the virtual module `virtual:muten/runtime`;
// the standalone HTML format inlines an equivalent. No dependencies, ~50 lines.

import type { Signal, EffectRun, PageModule, RouteDef } from '#engine/shared/types.js';

let current: EffectRun | null = null;   // the effect currently running (so reads can subscribe it)
let owner: EffectRun[] | null = null;   // effects created while a page mounts → disposed on unmount

// A reactive cell. Reading it inside an effect subscribes that effect; writing notifies subscribers.
export function signal<T>(value: T): Signal<T> {
  const subs = new Set<EffectRun>();
  return {
    get() { if (current) { subs.add(current); current.deps.add(subs); } return value; },
    set(next: T) { if (next === value) return; value = next; for (const run of [...subs]) run(); },
  };
}

// Run `fn`, tracking every signal it reads; re-run it whenever any of those signals changes.
export function effect(fn: () => void): EffectRun {
  const run: EffectRun = Object.assign(
    () => {
      if (run.disposed) return;
      for (const dep of run.deps) dep.delete(run); // drop last run's subscriptions before re-tracking
      run.deps.clear();
      const prev = current; current = run;
      try { fn(); } finally { current = prev; }
    },
    { deps: new Set<Set<EffectRun>>(), disposed: false },
  );
  if (owner) owner.push(run); // belongs to the page currently mounting → disposable on navigation
  run();
  return run;
}

// Run `fn`, collecting every effect it creates, and return a disposer that stops them all. The router
// uses this so an unmounted page's effects stop firing on shared store signals (cart/ui) — otherwise
// they touch detached DOM (anchor.parentNode === null) and crash the whole UI.
export function scope(fn: () => void): () => void {
  const prev = owner; const owned: EffectRun[] = []; owner = owned;
  try { fn(); } finally { owner = prev; }
  return () => { for (const run of owned) { run.disposed = true; for (const dep of run.deps) dep.delete(run); run.deps.clear(); } };
}

// `a contains b`: list membership OR case-insensitive substring — one operator, both meanings.
export function __has<T>(a: readonly T[] | string | null | undefined, b: T): boolean {
  if (Array.isArray(a)) return a.includes(b);
  return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
}

// A derived/memoized value (a store `get`): recomputes when the signals it reads change. Seeded once
// eagerly (a `get` is pure), then kept current by an effect that tracks its dependencies.
export function computed<T>(fn: () => T): Signal<T> {
  const cell = signal(fn());
  effect(() => cell.set(fn()));
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

// Hash router: mount the active route's page module into `outlet`, swapping on hashchange. A guard is
// a () => boolean reading a store signal; when it flips (login/logout) the tracking effect re-runs, so
// the navbar and routes react to auth automatically.
export function route(outlet: Element, routes: { [path: string]: RouteDef }): void {
  const keys = Object.keys(routes);
  let mounted: string | null = null;        // path currently shown (don't re-mount on every auth tick)
  let disposePage: (() => void) | null = null;
  const render = (): void => {
    const path = (location.hash || '').replace(/^#/, '') || keys[0];
    const def = routes[path] || routes[keys[0]];
    if (def.guard && !def.guard()) {          // unauthorized → redirect (the hashchange re-triggers render)
      const to = '#' + (def.redirect ?? '');
      if (location.hash !== to) location.hash = def.redirect ?? '';
      return;
    }
    if (path === mounted) return;
    mounted = path;
    if (disposePage) disposePage();           // stop the previous page's effects → no stale-DOM crashes
    disposePage = null;
    outlet.replaceChildren();
    def.load().then((module: PageModule) => { injectCss(module.css); disposePage = scope(() => { module.mount(outlet); }); });
  };
  addEventListener('hashchange', () => { mounted = null; render(); });
  // track every guard signal so logging in/out re-renders the active route automatically.
  effect(() => { for (const key of keys) { const guard = routes[key].guard; if (guard) guard(); } render(); });
}
