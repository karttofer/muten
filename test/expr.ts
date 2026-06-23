// Expression grammar (precedence) + when + text interpolation (parse-level).
import { parse } from '#engine/lang/parse.js';

let f = 0;
const c = (l, ok, e = '') => { console.log((ok ? '✓' : 'x') + ' ' + l + (ok ? '' : '   ← ' + e)); if (!ok) f++; };

// precedence: `a or b and c`  →  or(a, and(b, c))
{
  const when = parse('screen t\nPage { when a or b and c { Text "x" } }').tree.children[0];
  c('when → When node', when.type === 'When', when.type);
  const cond = when.props.cond;
  c('top op is or', cond.kind === 'bin' && cond.op === 'or', JSON.stringify(cond.op));
  c('right side is and', cond.right.op === 'and', cond.right?.op);
}

// comparison + unary not + parens: `not (x >= 3)`
{
  const cond = parse('screen t\nPage { when not (x >= 3) { Text "x" } }').tree.children[0].props.cond;
  c('not → unary', cond.kind === 'un' && cond.op === 'not', cond.kind);
  c('inner op is >=', cond.operand.op === '>=', cond.operand?.op);
}

// text interpolation: `"Hi, {user.name}!"`
{
  const v = parse('screen t\nPage { Text "Hi, {user.name}!" }').tree.children[0].props.value;
  c('Text value is interp', v.kind === 'interp', JSON.stringify(v));
  c('interp carries the ref', v.parts.some((p) => p.kind === 'ref' && p.name === 'user.name'), JSON.stringify(v.parts));
}

// inline object literal: `push({ title: name, qty: 1 })`
{
  const arg = parse('screen t\nstate { posts = [] : list<P> }\naction add mutates posts { posts.push({ title: name, qty: 1 }) }\nPage { Text "x" }').actions.add.body[0].arg;
  c('push arg is obj', arg.kind === 'obj', arg.kind);
  c('obj has 2 fields', arg.fields.length === 2, JSON.stringify(arg.fields?.length));
  c('field key + ref value', arg.fields[0].key === 'title' && arg.fields[0].value.kind === 'ref' && arg.fields[0].value.name === 'name', JSON.stringify(arg.fields[0]));
  c('field literal value', arg.fields[1].value.kind === 'lit' && arg.fields[1].value.value === 1, JSON.stringify(arg.fields[1]));
}

// in-place patch: `todos.patch(x => x.id == id, { done: true })`
{
  const st = parse('screen t\nstate { todos = [] : list<T> }\naction tog mutates todos <- id { todos.patch(x => x.id == id, { done: true }) }\nPage { Text "x" }').actions.tog.body[0];
  c('stmt op is patch', st.op === 'patch', st.op);
  c('patch param + pred', st.param === 'x' && st.pred.kind === 'bin', JSON.stringify([st.param, st.pred?.kind]));
  c('patch is obj literal', st.patch.kind === 'obj' && st.patch.fields[0].key === 'done', JSON.stringify(st.patch));
}

// list aggregate: `lines.count(c => c.done)` (method + lambda)
{
  const cond = parse('screen t\nstate { lines = [] : list<L> }\nPage { when lines.count(c => c.done) > 0 { Text "x" } }').tree.children[0].props.cond;
  const agg = cond.left;
  c('agg kind', agg.kind === 'agg', agg.kind);
  c('agg op/list/param', agg.op === 'count' && agg.list === 'lines' && agg.param === 'c', JSON.stringify([agg.op, agg.list, agg.param]));
  c('agg body is ref', agg.body.kind === 'ref' && agg.body.name === 'c.done', JSON.stringify(agg.body));
}

// list sort: `cs.sort(c => c.name)` (reuses the agg shape, op=sort)
{
  const list = parse('screen t\nstate { cs = [] : list<C> }\nPage { each cs.sort(c => c.name) as c { Text "x" } }').tree.children[0].props.list;
  c('sort is agg-shaped', list.kind === 'agg', list.kind);
  c('sort op/list/param', list.op === 'sort' && list.list === 'cs' && list.param === 'c', JSON.stringify([list.op, list.list, list.param]));
}

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
