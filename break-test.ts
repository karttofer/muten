// Adversarial harness v2 — find FALSAS (oracle ✓ but broken), CRASHES, and expressiveness WALLS.
// Per snippet: parse → flatten → validate → compileModule → run SSR against the fake DOM.
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { validate } from '#engine/ir/validate.js';
import { compileModule, compile } from '#engine/compile/compile.js';
import { renderSsrBody } from '#engine/project/ssr.js';
import { Fmt } from '#engine/shared/vocab.js';

type Snip = { name: string; src: string };
const S: Snip[] = [
  // ── compiler/oracle correctness ──
  { name: 'each over scalar', src: `screen h\nstate { n = 0 : number }\nPage { each n as x { Text "x" } }` },
  { name: 'each over query.data direct', src: `screen h\nentity P { v number }\nstate { ps = query ps : list<P> }\nPage { each ps as p { Text "{p.v}" } }` },
  { name: 'self-referential get', src: `screen h\nstate { n = 0 : number }\nget g = g + 1\nPage { Text "{g}" }` },
  { name: 'mutual-recursive get', src: `screen h\nget a = b\nget b = a\nPage { Text "{a}" }` },
  { name: 'match on number (non-enum)', src: `screen h\nstate { n = 0 : number }\nPage { match n { 1 -> Text "a" } }` },
  { name: 'match on text', src: `screen h\nstate { s = "" : text }\nPage { match s { x -> Text "a" } }` },
  { name: 'contains list<number> vs text', src: `screen h\nstate { xs = [] : list<number>  q = "" : text }\nPage { when xs contains q { Text "x" } }` },
  { name: 'when on a list', src: `screen h\nstate { xs = [] : list<number> }\nPage { when xs { Text "x" } }` },
  { name: 'sort by on query', src: `screen h\nentity P { v number }\nstate { ps = query ps : list<P> }\nPage { each ps.sort by v as p { Text "{p.v}" } }` },
  { name: 'aggregate over query', src: `screen h\nentity P { v number }\nstate { ps = query ps : list<P> }\nPage { Text "{ps.sum by v}" }` },
  { name: 'nested each over scalar inner', src: `screen h\nentity P { v number }\nstate { ps = [] : list<P> }\nPage { each ps as p { each p.v as x { Text "y" } } }` },
  { name: 'interp an action name', src: `screen h\naction go { }\nPage { Text "{go}" }` },
  { name: 'Button -> a number', src: `screen h\nstate { n = 0 : number }\nPage { Button "x" -> n }` },
  { name: 'remove on a scalar', src: `screen h\nstate { n = 0 : number }\naction a mutates n { n.remove where id == 1 }\nPage { Button "x" -> a }` },
  { name: 'patch on a scalar', src: `screen h\nstate { n = 0 : number }\naction a mutates n { n.patch where id == 1 with { x: 1 } }\nPage { Button "x" -> a }` },
  { name: 'toggle on a number', src: `screen h\nstate { n = 0 : number }\naction a mutates n { n.toggle() }\nPage { Button "x" -> a }` },
  { name: 'push scalar to list<number>', src: `screen h\nstate { xs = [] : list<number> }\naction a mutates xs { xs.push("not a number") }\nPage { Button "x" -> a }` },
  { name: 'set list to scalar', src: `screen h\nstate { xs = [] : list<number> }\naction a mutates xs { xs.set(5) }\nPage { Button "x" -> a }` },
  { name: 'Form over entity with list field', src: `screen h\nentity P { tags list<text> }\nstate { d = {} : P  ps = [] : list<P> }\naction a(p: P) mutates ps { ps.push(p) }\nPage { Form bind(d) submit(a) "go" }` },
  { name: 'Form enum required', src: `screen h\nentity P { role admin | member required }\nstate { d = {} : P  ps = [] : list<P> }\naction a(p: P) mutates ps { ps.push(p) }\nPage { Form bind(d) submit(a) "go" }` },
  { name: 'DataTable over a scalar', src: `screen h\nstate { n = 0 : number }\nPage { DataTable @n columns(x) }` },
  { name: 'DataTable column not a field', src: `screen h\nentity P { name text }\nstate { ps = [] : list<P> }\nPage { DataTable @ps columns(name, ghost) }` },
  { name: 'query without source or mock', src: `screen h\nentity P { v number }\nstate { ps = query missing : list<P> }\nPage { each ps as p { Text "{p.v}" } }` },
  { name: 'create on non-source list', src: `screen h\nentity P { v number }\nstate { ps = [] : list<P> }\naction a(p: P) mutates ps { ps.create(p) }\nPage { Button "x" -> a }` },
  { name: 'guard on non-store bool', src: `screen h\nstate { ok = false : bool }\nPage { Text "x" }` },
  { name: 'param used as mutate target', src: `screen h\nparam id\naction a mutates id { id.set("x") }\nPage { Button "x" -> a }` },
  { name: 'deeply nested when (50)', src: `screen h\nstate { b = true : bool }\nPage { ` + 'when b { '.repeat(50) + 'Text "deep"' + ' }'.repeat(50) + ` }` },
  { name: 'Title level h9', src: `screen h\nPage { Title "x" h9 }` },
  { name: 'Image without alt', src: `screen h\nPage { Image "x.png" }` },
  { name: 'two args same field name', src: `screen h\nentity P { id number }\nstate { ps = [] : list<P> }\naction a mutates ps { ps.remove where id == id }\nPage { Button "x" -> a }` },
  { name: 'string with unclosed interp', src: `screen h\nstate { n = 0 : number }\nPage { Text "hi {n" }` },
  // ── expressiveness walls (can it even be expressed?) ──
  { name: 'WALL dynamic css value (style var)', src: `screen h\nstate { pct = 40 : number }\nPage { Stack style(w: "{pct}%") { Text "x" } }` },
  { name: 'WALL dynamic class value', src: `screen h\nstate { n = 2 : number }\nPage { Stack class("col-span-{n}") { Text "x" } }` },
  { name: 'WALL leave transition', src: `screen h\nstate { s = true : bool }\nPage { when s transition "fade" { Text "x" } }` },
  { name: 'WALL standalone Select', src: `screen h\nstate { v = "" : text }\nPage { Select bind(v) options(a, b) }` },
  { name: 'WALL when/else', src: `screen h\nstate { b = true : bool }\nPage { when b { Text "a" } else { Text "b" } }` },
];

let falsas = 0, crashes = 0, walls = 0, caught = 0, clean = 0;
const lines: string[] = [];
for (const { name, src } of S) {
  let validateOk = false, codes: string[] = [], broke: string | null = null, crashed = false;
  try {
    const doc = toDoc(parse(src));
    const v = validate(doc, {});
    validateOk = v.ok; codes = v.diagnostics.map((d) => d.code);
    if (validateOk) {
      try { compileModule(doc); } catch (e) { broke = 'compile: ' + (e instanceof Error ? e.message : e).toString().slice(0, 70); }
      if (!broke) { try { renderSsrBody(compile(doc, {}, '', {}, {}, { format: Fmt.Ssr })); } catch (e) { broke = 'runtime: ' + (e instanceof Error ? e.message : String(e)).slice(0, 70); } }
    }
  } catch (e) { crashed = true; broke = 'CRASH: ' + (e instanceof Error ? e.message : String(e)).slice(0, 70); }

  const isWall = name.startsWith('WALL');
  let v: string;
  if (crashed && !validateOk) { v = '💥 CRASH'; crashes++; }
  else if (validateOk && broke) { v = '🔴 FALSA — ' + broke; falsas++; }
  else if (isWall && !validateOk) { v = '🧱 WALL (rejected — can\'t express) [' + codes.join(',') + ']'; walls++; }
  else if (!validateOk) { v = '✅ caught [' + codes.join(',') + ']'; caught++; }
  else { v = isWall ? '🟢 EXPRESSIBLE (ok+runs)' : '🟢 clean'; clean++; }
  lines.push(`${v}  —  ${name}`);
}
console.log(lines.join('\n'));
console.log(`\n=== ${falsas} FALSAS · ${crashes} CRASHES · ${walls} walls · ${caught} caught · ${clean} clean (of ${S.length}) ===`);
