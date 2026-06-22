
<img width="157" height="157" alt="Group 21" src="https://github.com/user-attachments/assets/fe9a02e6-483d-4788-9286-142c1ddb7057" /> 
<br/>

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

## Capabilities

- **UI** — declarative primitives (layout, text, forms, tables, links), `when`/`each` control flow,
  `style()` layout tokens + `class()` look (toggle reactively: `class(active when isOpen)`), events on
  any element (`on(keydown: act)`).
- **State** — local `state`, app-global `store`, derived `get`, `action`s with `if/else`; fine-grained signals.
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

## What a muten app can do — three tiers

muten the *language* stays tiny on purpose; a muten *app* reaches the whole web platform through bounded,
analyzable escapes. Reach for the **lowest tier that works**:

**1 · Pure muten** — the declarative 80%, zero extra deps: pages + routing (params, guards, shell, `/404`) ·
`state`/`store`/`get` signals · `action`s with optimistic CRUD · `query` over REST `sources` (`refetch`,
multi-backend) · `Form` from an entity (with validation) · `DataTable`, `when`/`each`, reactive
`class(when …)`, `on(event: action)` · SSG + SEO. → a real **CRUD / SaaS / catalog / dashboard / content**
app is *100% muten*.

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

**Experimental:** full island **SSR** — `muten build` server-renders an island's HTML (first paint + SEO),
but client hydration of that island still needs its framework bundled (pair the SSG HTML with the Vite client build).

**Next, toward 1.0:**
- richer `Form` field types (`date` · `number` · `select` · `bool` · `textarea` · …) — completes the
  entity→form model, so more is pure-muten with *no* library.
- bounded aggregates in expressions (`sum` · `count`) — e.g. a cart total without an escape.
- keyed `each` (large-list perf); a live `source` (SSE / websocket) for real-time.

**By design (the moat, not a bug):** muten is declarative + bounded — no loops / `map` / `reduce` in the DSL
(use a `use` JS function), no widget primitives (use tier 2 / 3). The ceiling is what keeps it small and
analyzable; closing it would just make another general-purpose framework.
