# muten — the language identity

**One line.** muten is a **declarative UI language with a bounded, analyzable algebra for state and change — not a programming language.** You describe what the UI **is** and what **changes**; you never write **how**. Everything is verifiable by the compiler before it ever runs in a browser.

The asset to protect above all: muten does **not** look like another JS framework wearing a DSL. The day it does, it has lost.

---

## The trinity (the whole mental model)

Three citizens, and only three. Every concept in a page is one of them.

| | What it is | The rule |
|---|---|---|
| **`state`** | the mutable truth (local `state`, app-global `store`) | the only thing that can change |
| **`get` / derived** | read-only computations and **views** over state — filters, counts, selections, derived lists | **a query is a derived view, never an action.** Available at page level, not just in stores. |
| **`action`** | the **only** place state changes, through a fixed vocabulary of ops (`push`/`set`/`patch`/`remove`/`toggle`/`create`/`update`/`delete`) | not a script; it orchestrates ops, it doesn't compute |

The most common modeling mistake (and the source of most friction) is shoving a **query** into an `action` or into extra `state` because there was no clean way to *derive* it. The derived citizen fixes that: **derive what you read, mutate only in actions.**

```
state { tasks = [] : list<Task> }

get todo  = tasks where status == "todo"     # a derived VIEW, read-only, reactive
get doing = tasks where status == "doing"
get done  = tasks where status == "done"
get openCount = tasks.count where not done   # a derived NUMBER

action complete mutates tasks <- taskId {    # the ONLY mutation
  tasks.patch where id == taskId with { done: true }
}
```

`each todo as t { … }` reads cleaner than `each tasks as t where status == "todo"` repeated three times — for a person **and** for an AI. Readability is the point.

---

## One expression sub-language, identical everywhere

The **same** grammar in `when`, `where`, `{interpolation}`, `class(name when …)`, derived `get`s, and action conditions — no position behaves differently.

The entire expression vocabulary:
`==` `!=` `<` `>` `<=` `>=` · `and` `or` `not` · `contains` · `+ - * /` · ternary `c ? a : b` · parentheses · refs (`user.name`, `$item.x`) · the list reducers `sum` / `count` / `avg` / `min` / `max` · the list filter `… where …`.

That is all there is. If it works in `when`, it works in `{…}` and in `where`. (Inconsistent expressions are the single biggest cause of AI errors — one grammar, no exceptions.)

---

## The law — raise the floor, not the ceiling

Every real need earns a **declarative word**, never a functional escape inside the language. More vocabulary, never more programming.

| The need | NOT (functional / JS) | YES (declarative vocabulary) |
|---|---|---|
| filter a list | `.filter(…)` | `each … where …` · `get x = … where …` |
| any match? | `.some(…)` | `exists … where …` |
| all match? | `.every(…)` | `all … where …` |
| fold / total | `.reduce(…)` | `sum` · `count` · `avg` · `min` · `max` |
| transform | `.map(…)` | a derived `get`, or `use fn` if it's arbitrary |

There is **no** `.map` / `.filter` / `.reduce` / `.some` / `.every`, and **no** functions defined inside `.muten`. The moment you can chain `products.filter(…).map(…).reduce(…)`, muten is just JavaScript with extra steps.

When something genuinely needs arbitrary code, it **leaves the language**:
- `use fn from "./lib.ts"` — a typed JS function, called in any expression.
- `Custom` — a vanilla-JS widget (charts, maps, pickers).

The compiler still validates the **seam** (the values and actions crossing the border), so the oracle never loses coverage on the muten side. There is no framework-component escape: muten ships **zero framework runtime**.

---

## The litmus test for any future feature

It belongs in the language only if **all three** hold. Fail any one and it is an escape (`use` / `Custom`), not a feature.

1. **Readable at a glance** — an AI or a person knows exactly what it does without tracing logic.
2. **Fully oracle-verifiable** — `muten check` validates it end to end, not just the border.
3. **A word, not logic** — it adds *declarative vocabulary*, not a new way to write code.

This is the gatekeeper's bar. The question is never "does the grammar grow?" — it is **"can the oracle verify it of substance, and does it stay declarative?"**

---

## What muten is NOT (equally defining)

Not general-purpose. Not "a bit functional." Not JavaScript with a DSL skin. Not a place for algorithms (those are `use fn`). Not React / Vue / Svelte — no virtual DOM, no framework runtime, no tree-of-code components.

## Homogeneity — 100% patterns, no surprises

This is as defining as the trinity. An AI does not "learn" a language; it **predicts by pattern**. Where the pattern breaks, it fails. So muten has **one shape per thing** — learn one, predict all.

**The canonical shapes — the whole grammar reduces to these seven:**

| Thing | The one shape |
|---|---|
| Define | `kind name(params) { body }`  ·  or  `kind name = value` |
| Params & args | always `(name: value, …)` — parenthesized, named, many |
| Modifiers | always `name(args)` |
| Reference | a **bare name**, everywhere — no sigil |
| Expressions | one grammar in `when` / `where` / `{…}` / `class(… when …)` / `get` |
| Filter | `where <cond>` — the one filter: `each` / `get` / `remove` / `patch` / `count` / `exists` / `all` |
| Mutate | `target.op(args)` — predicate ops take a `where`, never a lambda |

**Decided — eliminated (they broke a pattern):**
- The **`@` sigil**. A reference is a bare name everywhere. (`@` worked in `bind` but not in `when` — exactly the surprise that breaks prediction.)
- The **`<-` action input**. Actions take `(name: Type, …)` params like everything else — multiple, named.
- **Lambdas (`x => …`) in list ops.** The item's fields are implicit in a clause: `where done`, `sum(points)`, `remove where id == x` — never `t => t.done`.
- **Bare calls / modifiers.** `Card(task: t, onDone: x)`, `bind(draft)`, `submit(add)` — not `Card task: t`, `bind @x`, `submit add`.
- (Already gone: framework islands, timer polling, and `.map`/`.filter`/`.reduce`/`.some`/`.every`.)

**Decided — kept and made homogeneous + the new floor:**
- The trinity `state` / `get` (now page-level, the derived citizen) / `action`.
- `where` everywhere a list is filtered; `exists … where` / `all … where` for any/all; `sum`/`count`/`avg`/`min`/`max` and `sort(expr)` for folds — all item-implicit, no lambda.
- Ops `push`/`set`/`patch`/`remove`/`toggle`/`create`/`update`/`delete`, all `target.op(args)`.
- Escapes `use fn from "./lib.ts"` and `Custom`, seam-checked.

**The single rule for naming an item:** only `each X as name { … }` names an item — a rendered sub-tree needs a handle and nesting needs distinct names. Everywhere else the item is implicit (`where done`, `sum(points)`). Two contexts, each 100% consistent.

**The test for any new syntax:** does it fit one of the seven shapes? If not, it does not ship. We add a *word* to an existing shape, never a new shape.

## The promise

**Less code, more app** — described declaratively, derived not duplicated, mutated through a small safe algebra, in one grammar with no surprises, and answered by the compiler before the browser ever sees it.
