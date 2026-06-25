// Parts: nesting (a part uses another) + param propagation through nesting.
import { parse } from '#engine/lang/parse.js';
import { compose } from '#engine/ir/compose.js';

let fails = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : 'x'} ${label}${ok ? '' : '   ← ' + extra}`);
  if (!ok) fails++;
};

// two parts: Outer instantiates Inner
const lib = parse('part Inner(txt: text) { Text $txt }\npart Outer(t: text) { Stack { Inner(txt: $t) } }');
const parts = {};
for (const [n, d] of Object.entries(lib.parts)) parts[n] = d;

// page that uses Outer
const page = parse('screen t\nPage { Outer(t: "hi") }');
const { tree, used } = compose(page.tree, parts);

const stack = tree.children?.[0];
check('Outer → Stack', stack?.type === 'Stack', stack?.type);
const text = stack?.children?.[0];
check('nested Inner → Text', text?.type === 'Text', text?.type);
check('param propagated to nested ("hi")', text?.props?.value === 'hi', JSON.stringify(text?.props));
check('used records both parts', used.includes('Outer') && used.includes('Inner'), used.join(','));

// reference substitution: OBJECT param ($char.field) + ACTION param ($onSave) resolve to the arg
const lib2 = parse('part Card(char: C, onSave: action) { Stack { Image "{$char.image}"  Button "x" -> $onSave($char.id) } }');
const card = compose(parse('screen t\neach items as c { Card(char: c, onSave: addFav) }').tree, { Card: lib2.parts.Card }).tree;
const inner = card.children?.[0];               // each → Stack (the inlined Card)
const img = inner?.children?.[0];
const btn = inner?.children?.[1];
check('object param: $char.image → c.image', img?.props?.src?.parts?.[0]?.name === 'c.image', JSON.stringify(img?.props?.src));
check('action param: $onSave → addFav', btn?.props?.action === 'addFav', btn?.props?.action);
check('action arg: $char.id → c.id', btn?.props?.arg?.name === 'c.id', JSON.stringify(btn?.props?.arg));

// reactive class with a $param condition: `class(x when $flag)` must substitute the $param (regression: was a passthrough → toggle dropped)
const boxCls = compose(parse('screen t\nPage { Box(flag: on) }').tree, { Box: parse('part Box(flag: bool) { Stack class(active when $flag) { Text "x" } }').parts.Box }).tree.children?.[0];
check('class($param cond) substituted: $flag → on', boxCls?.props?.class?.[0]?.cond?.name === 'on', JSON.stringify(boxCls?.props?.class));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL OK');
process.exit(fails ? 1 : 0);
