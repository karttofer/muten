// Islands: `use X from "svelte:./X.svelte"` mounts a foreign-framework component as a node `X(prop: @s)`.
// Generic adapter glue (svelte/react) is emitted inline; props flow down (events/SSR are v2). The oracle
// validates the node + border; the component is opaque.
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { validate } from '#engine/ir/validate.js';
import { compileModule, compile } from '#engine/compile/compile.js';
import { renderSsrBody } from '#engine/project/ssr.js';
import { Fmt } from '#engine/shared/vocab.js';

let f = 0;
const ok = (l: string, c: boolean, e = '') => { console.log((c ? '✓' : '✗') + ' ' + l + (c ? '' : '  ← ' + e)); if (!c) f++; };

// ── Svelte island ──
const doc = toDoc(parse(`screen s
use Counter from "svelte:./Counter.svelte"
state { n = 0 : number }
Page { Counter(value: @n) }`));
const js = compileModule(doc);
ok('svelte: dynamic component import (code-split)', js.includes('import("./Counter.svelte")'));
ok('svelte: dynamic framework import', js.includes(`import('svelte')`));
ok('svelte: hydrate-or-mount glue', js.includes('hasChildNodes() ? __s.hydrate : __s.mount'));
ok('svelte: mounted with props (value: signal snapshot)', js.includes('"value": n.get()'));
ok('validate accepts the island node', validate(doc).diagnostics.every((d) => d.code !== 'unknown-part'), JSON.stringify(validate(doc).diagnostics));

// ── React island (same contract, different adapter) ──
const rjs = compileModule(toDoc(parse(`screen s
use Widget from "react:./W.jsx"
Page { Widget() }`)));
ok('react: dynamic framework imports', rjs.includes(`import('react-dom/client')`) && rjs.includes(`import('react')`));
ok('react: hydrate-or-mount glue', rjs.includes('hydrateRoot(') && rjs.includes('createRoot('));
ok('react: reactive props (render in effect)', rjs.includes('effect(() => __root.render('));

// ── a logic `use` (no adapter prefix) stays a named function import, NOT an island ──
const ljs = compileModule(toDoc(parse(`screen s
use fmt from "./util.js"
state { d = "" : text }
Page { Text "{fmt(d)}" }`)));
ok('logic use stays a named import', ljs.includes('import { fmt } from "./util.js"') && !ljs.includes('__island_fmt'));

// ── events ↑: an arg whose value is an action becomes a callback that calls it; data args stay snapshots ──
const ev = compileModule(toDoc(parse(`screen s
use Counter from "svelte:./Counter.svelte"
state { n = 0 : number }
action bump mutates n <- x { n.set(x) }
Page { Counter(start: @n, onChange: bump) }`)));
ok('event ↑: action arg → callback wrapper', ev.includes('"onChange": (...__a) =>') && ev.includes('bump'));
ok('data arg stays a snapshot prop', ev.includes('"start": n.get()'));

// ── directives: client:visible / client:idle wrap the mount in a lazy hydrator ──
const vis = compileModule(toDoc(parse(`screen s
use Counter from "svelte:./Counter.svelte"
state { n = 0 : number }
Page { Counter(value: @n) client:visible }`)));
ok('client:visible → IntersectionObserver wrap', vis.includes('__onVisible(') && vis.includes('IntersectionObserver'));
const idle = compileModule(toDoc(parse(`screen s
use Counter from "svelte:./Counter.svelte"
Page { Counter() client:idle }`)));
ok('client:idle → requestIdleCallback wrap', idle.includes('__onIdle(') && idle.includes('requestIdleCallback'));
ok('no directive → mounts immediately (no lazy wrap)', js.includes('import("./Counter.svelte")') && !js.includes('__onVisible'));

// ── full SSR: a page with an island pre-renders the muten content AND collects each island (with its prop
// snapshot) for the build to server-render, leaving a marker the build replaces with the island's HTML ──
const ssrDoc = toDoc(parse(`screen s
use Counter from "svelte:./Counter.svelte"
state { n = 0 : number }
Page { Title "Hello SSR" Counter(value: @n) client:visible }`));
const ssrIslands: { adapter: string; path: string; props: { [k: string]: unknown } }[] = [];
const ssrHtml = renderSsrBody(compile(ssrDoc, {}, '', {}, {}, { format: Fmt.Ssr }), ssrIslands);
ok('full SSR: muten content pre-renders around the island', ssrHtml.includes('Hello SSR'));
ok('full SSR: island collected for server-render', ssrIslands.length === 1 && ssrIslands[0].adapter === 'svelte' && ssrIslands[0].path === './Counter.svelte');
ok('full SSR: marker left where the island HTML goes', ssrHtml.includes('<!--mi:0-->'));
ok('full SSR: prop snapshot captured', ssrIslands[0].props.value === 0);

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
