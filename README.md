
<img width="157" height="157" alt="Group 21" src="https://github.com/user-attachments/assets/fe9a02e6-483d-4788-9286-142c1ddb7057" /> 
<br/>

## ALPHA - STILL ON DEVELOPMENT
Muten is still under active development. We are currently in the alpha stage and are working on training models with Muten. Please keep in mind that improvements are being made gradually, and version 1.0 has not been released yet.

An **AI-first** frontend framework. You write `.muten` files; muten compiles them to vanilla JS
with fine-grained signals — **no virtual DOM, no framework runtime to ship**. The language is small,
semantic and analyzable on purpose: an AI (or a person) can **locate and mutate** an app cheaply.

```sh
npm create muten@latest my-app   # scaffold a new app (cross-platform: Windows + macOS)
cd my-app && npm install && npm run dev
```

## Why muten

For an AI the cost of working on a codebase is **context + mistakes + edit-radius**. muten is built to cut
all three *by construction* — these are properties of how it compiles, not marketing:

- **Almost nothing to ship** — no virtual DOM, no framework runtime. The *same* todo app, scaffolded by each
  framework's official CLI and built, ships **~2.8 KB gzip** of JS in muten vs **~14 KB (Svelte) · ~24 KB (Vue)
  · ~59 KB (React)** — **5–21× less** (a static page ships *zero*). Source is the most compact too (445 B), on
  par with Svelte. *(Reproducible: the `bench/` folder + `node bench.mjs` in the source repo.)*
- **A deterministic oracle** — `muten check --json` validates every page at compile time (unknown
  state/action/part, bad style token, illegal mutation) in milliseconds, no browser — a feedback loop the
  others don't have. A *bounded* language is what makes that possible.
- **The whole app as data** — `app.map.json` is a compact index of routes + structure an agent reads first,
  instead of grepping a component tree.
- **Small edit radius** — the UI is declarative, so a change is usually a few lines in one file.

The trade is deliberate: a small, analyzable language an AI can hold in its head — not a general-purpose one it can't.

## muten vs React / Vue / Svelte — the honest version

They are general-purpose: they build *anything*, with huge ecosystems and a deep talent pool. That power has a
price an AI (and your refactors) pay on every change — a large surface to keep in context (hooks, reactivity rules,
lifecycle, the build graph), edits that ripple across components, and a runtime that ships to the browser. **For a
human team building a big, bespoke product, that trade is usually worth it — use React/Vue/Svelte there.**

muten makes the *opposite* trade on purpose, and it only wins on its own terms:

- **The whole language fits in context** — no hooks-vs-effects, no re-render rules to reason about; far fewer ways
  to be wrong.
- **A compiler that answers before the browser does** — `muten check` validates every page (unknown ref, illegal
  mutation, type mismatch, "did you mean…?") in milliseconds, no run. That loop is the single biggest reason
  AI-written muten works on the *first* try more often.
- **Small edit radius + app-as-data** — a change is a few lines in one file; `app.map.json` hands an agent the
  whole app instead of a component tree to grep.
- **Almost nothing ships** — no VDOM, no framework runtime (~2.8 KB gzip for a todo app vs 14–59 KB).

**Where we're honest about the cost:** muten is small by design, so it can't express everything; the ecosystem is
young, there is one maintainer, and it's pre-1.0. It shines when an **AI builds and maintains the app** and the app
is the declarative 80% — CRUD, dashboards, catalogs, content, internal tools. It is **not** the right tool for a
hand-crafted, highly-custom UI that needs the full React ecosystem, and it doesn't pretend to be. The honest rule of
thumb: *let muten do the structure and the data; couple in other tech for the rest* (next section).

## Capabilities

- **UI** — declarative primitives (layout, text, forms, tables, links), `when`/`each` control flow,
  `style()` layout tokens + `class()` look (toggle reactively: `class(active when isOpen)`), events on
  any element (`on(keydown: act)`).
- **State** — local `state`, app-global `store`, derived `get`, `action`s with `if/else`; fine-grained signals.
  A page `action` can **call a store action** (`cart.add(d)  draft.reset()`) — store + local work in one handler.
- **Lists** — bounded, analyzable list operations (no raw `map`/`reduce`): inline objects (`list.push({ a: x })`),
  in-place edit (`list.patch(x => x.id == id, { done: not x.done })`), filtered render (`each xs as x where cond`),
  aggregates (`list.sum(x => x.price * x.qty)` · `count` · `avg` · `min` · `max`), and `sort`/`sortDesc(x => key)`.
- **Data** — `query` states backed by `sources` (full HTTP: method, headers, body, nested `at`); one `api`
  block for base URL + auth (named clients for several backends); CRUD writes (`create`/`update`/`delete` —
  optimistic, with `.pending`/`.error`); `refetch(q: …, page: …)` for search/pagination; a `post`/`put`/`delete`
  escape for non-REST APIs.
- **Routing** — real-path URLs, params (`/product/:id` → `param id`), guards, a `/404` catch-all.
- **SEO / SSR** — `muten build` pre-renders every route to real HTML (static pages ship zero JS; data-driven
  pages are fetched at build), with per-page `meta { title … description … }` (`og:*` auto-derived).
- **Interop, lowest-tier first** — style native HTML + CSS libs with `class()`; mount **vanilla JS** libs
  (charts, maps, date-pickers) via `Custom`; pull JS logic into expressions with `use fmt from "./lib.ts"`;
  and only when you need a real **Svelte/React** component (e.g. shadcn) reach for an **island**
  (`use X from "react:./X.jsx"` — code-split, lazy `client:visible`). See *Three tiers* below.
- **AI-native** — `lint == build`, one source of truth per concept, and the full language reference ships
  inside every scaffolded app under `.claude/` (an AGENTS guide + a Claude skill).

## How muten couples with the rest of the web — three tiers

muten the *language* stays tiny on purpose; a muten *app* reaches the whole web platform through **bounded,
analyzable escapes**. The point: you never *fight* the language to do something it doesn't have — you drop to the
right tier, and the compiler still checks the seam. Reach for the **lowest tier that works**:

**1 · Pure muten** — the declarative 80%, zero extra deps: pages + routing (params, guards, shell, `/404`) ·
`state`/`store`/`get` signals · `action`s with `if/else`, optimistic CRUD, and **store-action composition** ·
the **list toolkit** (inline objects · `patch` in-place edit · `each…where` filter · `sum`/`count`/`avg`/`min`/`max`
aggregates · `sort`/`sortDesc`) · `query` over REST `sources` (`refetch`, multi-backend) · `Form` from an entity
(text/number/email/bool/enum + validation) · `DataTable`, `when`/`each`, reactive `class(when …)`,
`on(event: action)` · SSG + SEO. → a real **CRUD / SaaS / catalog / dashboard / content** app is *100% muten*.

**2 · muten + the platform** — the web, *no framework runtime*: native HTML (`<input type="date">`,
`<dialog>`, `<details>`) styled with `class()` · CSS component libs (Tailwind, DaisyUI) · **vanilla JS via
`Custom`** (charts → chart.js, maps → Leaflet, date-picker → flatpickr, rich-text → Quill, drag-drop →
SortableJS, grids → Tabulator) · web components · `use fmt from "./lib.ts"` for any JS logic (zod, date-fns).
→ almost every "hard widget" lands here, **without React**.

**3 · Svelte / React island** — only when the component *is* a framework component (e.g. **shadcn/ui**, a
React-only lib) with no native/vanilla equivalent. Ships that framework's runtime (lazy, code-split via
`client:visible`); props ↓ + events ↑ wire it to muten state. The narrow last resort, not the default.

> "Not expressible in pure muten" usually means **tier 2 (platform)**, rarely **tier 3 (React)** — and every
> escape is *bounded* (the oracle still checks the border), so the language never grows into a UI kit.

**The mechanism — and the honest caveat.** Each escape keeps the AI-first guarantee because the compiler still
validates the *seam*: the `@state` props and `action` callbacks crossing into a `Custom`/island, and the call site
of a `use` function (an undeclared one is a `check` error). So coupling in chart.js, zod, or a shadcn island never
costs you the oracle on the muten side. The caveat to be clear about: a `use` function or an island ships real JS,
and the standalone `muten build` (static HTML, for the pure-muten content) does **not** bundle it — those deploy
through **`vite build`** (the same path the dev server runs). Rule of thumb: *pure-muten static content →
`muten build`; the moment you add `use`/islands/shared cross-page state → a normal `vite build`.* The dev server
(`npm run dev`) handles all tiers either way.

## The app, by convention

```
my-app/
├─ src/
│  ├─ app.muten            # the ROOT: routes (+ optional persistent shell)
│  ├─ pages/
│  │  └─ home/home.muten   # a page; the folder name is its route target
│  ├─ parts/               # reusable .muten components (object + action params)
│  └─ components/          # host-written Custom JS (the escape hatch)
├─ theme.muten             # the project's token scale (md=16px, breakpoints, …)
└─ src/styles.css          # the look (muten ships structure + layout; the skin is yours)
```

`src/app.muten` is the single source of truth the AI reads first:

```
routes {
  / -> home
}
```

## CLI

```sh
muten build [dir]            # compile → ./dist/<route>/index.html (+ app.map.json)
muten check [dir] [--json]   # parse + validate every page, no compile — the deterministic ORACLE
                             #   --json → structured diagnostics (code + loc + "did you mean…?") in ms, no browser
muten map   [dir] [--json]   # emit app.map.json COLD (no build) — the app graph an AI reads FIRST
```

`check` and `map` are the AI-first feedback loop: an agent asks the compiler "is this valid, and what
did I mean?" (`check --json`) and "what's the whole app?" (`map`) without running a browser. `lint` is an
alias of `check`.

`build`/`lint` default to the current directory; pass a path to target another. The `muten` bin ships
with the app (it's a dependency). To scaffold a *new* app, use `npm create muten@latest` (the separate
[`create-muten`](https://www.npmjs.com/package/create-muten) scaffolder).

## Dev server (Vite)

The Vite plugin gives a Muten app a dev server + HMR + client-side routing while authoring stays the
DSL. `npm create muten` wires it up; `npm run dev` runs it.

```js
// vite.config.mjs
import muten from '@muten/core/vite-plugin-muten.js';
export default { plugins: [muten()] };  // theme.muten is auto-loaded
```

## Programmatic API

```js
import { buildApp, compile, parse, validate, toDoc } from '@muten/core';

await buildApp('./my-app');               // same as `muten build ./my-app`
const html = compile(toDoc(parse(src)));  // drive the compiler directly (embedding)
```

## Architecture

The compiler is a straight pipeline of small, single-purpose stages:

```
.muten ─[lang]→ IR ─[ir: compose]→ tree ─[ir: flatten]→ Doc ─[ir: validate]→ ✓ ─[compile]→ JS
```

The source is TypeScript under `src/`, organized by **domain** — each has its own README:

| Domain | Role |
|---|---|
| [`src/engine/shared`](src/engine/shared/README.md) | contracts: types, the vocabulary (no magic strings), diagnostics |
| [`src/engine/lang`](src/engine/lang/README.md) | front-end: `.muten` text → IR (lexer · grammar · parser · manifest) |
| [`src/engine/ir`](src/engine/ir/README.md) | IR transforms + validation (compose · flatten · validate) |
| [`src/engine/compile`](src/engine/compile/README.md) | back-end: Doc → runnable JS (DOM + logic + emit + helpers) |
| [`src/engine/style`](src/engine/style/README.md) | the styling token vocabulary (the engine ships no values) |
| [`src/engine/project`](src/engine/project/README.md) | filesystem + whole-app awareness (load · analyze · routes · styles) |

The runtime (the only thing shipped to the browser), the Vite plugin, the CLI and the build/lint
orchestration also live in `src/`. See [`src/engine/README.md`](src/engine/README.md) for the
file-level conventions (≤500 lines, honest types, data-table dispatch, no magic strings).

## Build

`npm run build` = `tsc` (strict type-check) + `esbuild` → `dist/**/*.js`, **minified, per-file**
(modules preserved, so nothing bundles into a heavy monolith). `dist/` is generated — edit `src/`.

## Styling & escape hatch

muten imposes no theme. A page lays itself out with `style(…)` tokens (analyzable, resolved against
`theme.muten`) and skins itself via `class("…")` (your CSS / Tailwind / anything). For behavior the
primitives can't express, drop to a `Custom` component (`src/components/<Name>.js`).

## Islands — Svelte & React

When a page needs a genuinely interactive widget or a framework UI lib muten can't express, mount a real
Svelte/React component as an **island**. The `svelte:` / `react:` prefix on `use … from` is the only marker;
the component file is plain Svelte/React and owns its own tooling.

```
screen home

use Counter from "svelte:./Counter.svelte"   # a Svelte island
use Likes   from "react:./Likes.jsx"          # a React island

state { total = 10 : number }
action setTotal mutates total <- n { total.set(n) }

Page style(padding.xl, gap.md) {
  Counter(start: @total, onChange: setTotal)               # props ↓ as signals, events ↑ to actions
  Likes(start: @total, onLike: setTotal) client:visible    # code-split, hydrated when scrolled into view
  Text "muten state ← islands: {total}"
}
```

`prop: @state` sends a value **down** (a React island re-renders when the signal changes; Svelte mounts once);
`onX: action` sends a callback that fires a muten action — that's how an island writes **back** to muten state.
No `client:` directive = hydrate on load. Add the framework's Vite plugin next to `muten()`:

```js
// vite.config.mjs
import muten from '@muten/core/vite-plugin-muten.js';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import react from '@vitejs/plugin-react';
export default { plugins: [muten(), svelte(), react()] };
```

## Status & roadmap (honest)

**Pre-1.0 — the core is solid, the edges are young.** Build real apps with it; don't bet a critical
production system on it yet (small ecosystem, one maintainer, not yet battle-tested).

**Solid today:** the language + compiler, the `check` / `build` / `map` CLI + oracle, the Vite plugin + dev
server + HMR, the VS Code extension (live-lint + autocomplete), Svelte & React islands, the reproducible benchmark.
The bounded list toolkit — inline objects, `patch`, `each…where`, aggregates (`sum`/`count`/`avg`/`min`/`max`),
`sort`/`sortDesc`, and page→store action composition — so a real CRUD/dashboard app is pure muten, no JS escape.
`Form` fields cover `text` · `number` (coerced) · `email` · `bool` (checkbox) · `enum` (select), with validation.

**Experimental:** full island **SSR** — `muten build` server-renders an island's HTML (first paint + SEO),
but client hydration of that island still needs its framework bundled (pair the SSG HTML with the Vite client build).

**Next, toward 1.0:**
- a `date`/`textarea` `Form` field type; number formatting (`round` / currency) in expressions.
- keyed `each` (large-list perf); a live `source` (SSE / websocket) for real-time.
- richer SSG for stateful multi-page apps (today a shared `.store` across pages deploys via `vite build`, not the
  static `muten build`).

**By design (the moat, not a bug):** muten is declarative + bounded. The list toolkit (`patch` · `sort` · the
aggregates · `each…where`) gives the *common* list jobs without exposing raw `map`/`reduce` — anything past that
(an arbitrary transform) is a `use` JS function, and a real framework widget is a tier 2/3 escape. The ceiling is
what keeps it small and analyzable; closing it would just make another general-purpose framework.
