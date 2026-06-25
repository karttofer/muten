// Interactivity: reactive `class(name when cond)` → a classList.toggle effect; `on(event: action)` on any
// element → addEventListener. Static classes stay in the className; conditionals are toggled at runtime.
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { compileModule } from '#engine/compile/compile.js';

let f = 0;
const ok = (l, c, e = '') => { console.log((c ? '✓' : '✗') + ' ' + l + (c ? '' : '   ← ' + e)); if (!c) f++; };

const js = compileModule(toDoc(parse(`screen s
state { open = false : bool }
action toggle mutates open <- x { open.set(not open) }
Page {
  Stack class(panel, active when open) on(mouseenter: toggle) { Text "menu" }
  Button "x" -> toggle
}`)));
ok('static class stays in className', js.includes('"mu-stack panel"'));
ok('reactive class → classList.toggle effect (condition computed once)', js.includes('const __on = !!(open.get());') && js.includes('.classList.toggle("active", __on)'));
ok('on(event: action) → addEventListener', js.includes('.addEventListener("mouseenter", () => toggle())'));

// two separate class() modifiers MERGE (regression: a second class() used to overwrite, silently dropping the first)
const mergeJs = compileModule(toDoc(parse('screen s\nstate { d = false : bool }\nPage class("chat-app") class(dark when d) { Text "x" }')));
ok('multiple class() merge: static kept', mergeJs.includes('chat-app'));
ok('multiple class() merge: reactive kept', mergeJs.includes('.classList.toggle("dark", __on)'));

// MULTI-TOKEN reactive class: `class("a b c" when cond)` must toggle EACH token separately — classList.toggle
// throws on a token with spaces, so a single toggle("a b c") passes lint but blows up the render at runtime.
const multiJs = compileModule(toDoc(parse('screen s\nstate { on = false : bool }\nPage class("ring-2 ring-primary ring-inset" when on) { Text "x" }')));
ok('multi-token reactive class: per-token toggles', multiJs.includes('.classList.toggle("ring-2", __on)') && multiJs.includes('.classList.toggle("ring-primary", __on)') && multiJs.includes('.classList.toggle("ring-inset", __on)'));
ok('multi-token reactive class: NO multi-token toggle (would throw at runtime)', !multiJs.includes('toggle("ring-2 ring-primary'));

// a conditional class inside `each` resolves against the item local
const eachJs = compileModule(toDoc(parse(`screen s
entity T { label text  done bool }
state { items = query items : list<T> }
sources { items: { url: "/x" } }
Page { each items as it { Text "{it.label}" class(done when it.done) } }`)));
ok('conditional class in each uses the item (reactive row signal)', eachJs.includes('const __on = !!(it.get().done);') && eachJs.includes('.classList.toggle("done", __on)'));

// dynamic navigation: `-> /product/{p.id}` → an interpolated href (reuses the Text interpolation machinery)
const navJs = compileModule(toDoc(parse(`screen s
entity P { id text  title text }
state { items = query items : list<P> }
sources { items: { url: "/x" } }
Page { each items as p { Link "{p.title}" -> "/product/{p.id}" } }`)));
ok('dynamic link → interpolated href', navJs.includes(`"/product/" + String(p.get().id ?? '')`));

// a static path on a dynamic page stays a plain string href (no regression in the JS path)
const staticJs = compileModule(toDoc(parse(`screen s
state { open = false : bool }
action t mutates open <- x { open.set(not open) }
Page { Link "Home" -> "/about"  Button "x" -> t }`)));
ok('static link → plain href', staticJs.includes('.href = "/about"'));

// synthetic on(enter: action) on an input → a keydown listener firing only on Enter (no Custom for "Enter to send")
const enterJs = compileModule(toDoc(parse(`screen s
state { d = "" : text }
action go mutates d { d.reset() }
Page { SearchField bind(d) on(enter: go) "x" }`)));
ok('on(enter:) → keydown + Enter check', enterJs.includes("if (e.key === 'Enter') go()"));
ok('SearchField wires on()', enterJs.includes(".addEventListener('keydown'"));

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
