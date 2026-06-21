// Flat-IR (doc) validator — emits STRUCTURED DIAGNOSTICS.
//
// Since it knows the whole vocabulary (types, tokens, state, ops, parts) AND the
// scope of `each` items, every error is specific and proposes the closest candidate
// ("did you mean ...?"). Editor/AI consumable. Runs on the same doc that gets compiled.

import { resolveToken, SUGGESTED, defaultTheme, isKnownTokenShape } from './tokens.js';
import { diag, closest } from './diagnostics.js';
import { PRIMITIVE_NAMES, ACTION_OPS, PRIMITIVES } from './manifest.js';

const KNOWN_TYPES = new Set(PRIMITIVE_NAMES); // from the manifest (single source)
const REF_PROPS = ['bind', 'data']; // props whose value is @state
const KNOWN_OPS = new Set(ACTION_OPS);

// collect the variable names referenced by an expression AST
function collectRefs(e, acc = []) {
  if (!e || typeof e !== 'object') return acc;
  if (e.kind === 'ref') acc.push(e.name);
  else if (e.kind === 'un') collectRefs(e.operand, acc);
  else if (e.kind === 'bin') { collectRefs(e.left, acc); collectRefs(e.right, acc); }
  else if (e.kind === 'tern') { collectRefs(e.cond, acc); collectRefs(e.then, acc); collectRefs(e.else, acc); }
  return acc;
}

// ctx.parts = known part names in the project (to suggest and validate instances)
export function validate(doc, ctx = {}) {
  const D = [];
  if (!doc || typeof doc !== 'object') {
    return { ok: false, diagnostics: [diag('bad-doc', 'doc must be an object')] };
  }

  const stateKeys = new Set(Object.keys(doc.state || {}));
  const storeDomains = new Set(ctx.stores || []); // app-global store slices (cart.total, cart.add)
  const constNames = new Set(Object.keys(doc.consts || {})); // compile-time constants
  const nodes = doc.nodes || {};

  // state types: a `list` must declare its element type (north star: know what's inside)
  const SCALARS = ['text', 'number', 'bool', 'uuid', 'email', 'string'];
  const entityNames = Object.keys(doc.entities || {});
  for (const [name, def] of Object.entries(doc.state || {})) {
    const t = def.type;
    if (t === 'list') {
      D.push(diag('untyped-list', `state "${name}" is an untyped "list" — declare the element type, e.g. list<uuid> or list<User>`, { loc: def.loc, suggestion: 'list<uuid>' }));
    } else if (typeof t === 'string' && t.startsWith('list<')) {
      const elem = t.slice(5, -1);
      if (!SCALARS.includes(elem) && !entityNames.includes(elem)) {
        D.push(diag('unknown-type', `list element "${elem}" is not a known entity or scalar type`, { loc: def.loc, suggestion: closest(elem, [...entityNames, ...SCALARS]) }));
      }
    }
  }

  const checkRef = (value, node) => {
    if (typeof value === 'string' && value.startsWith('@')) {
      const name = value.slice(1).split('.')[0];
      if (!stateKeys.has(name)) {
        const near = closest(name, [...stateKeys]);
        D.push(diag('unknown-ref', `"@${name}" is not a declared state`, { loc: node.loc, suggestion: near ? '@' + near : null }));
      }
    }
  };

  // validate the variables an expression uses against (item scope ∪ state)
  const checkExpr = (expr, node, scope) => {
    for (const ref of collectRefs(expr)) {
      const head = ref.split('.')[0];
      if (scope.has(head) || stateKeys.has(head) || storeDomains.has(head) || constNames.has(head)) continue;
      const near = closest(head, [...stateKeys, ...scope]);
      D.push(diag('unknown-ref', `"${head}" is not a known state or item variable here`, { loc: node.loc, suggestion: near }));
    }
  };

  const seen = new Set();
  const walk = (id, scope) => {
    const n = nodes[id];
    if (!n) { D.push(diag('missing-node', `node ${id} does not exist`)); return; }
    if (seen.has(id)) { D.push(diag('dup-node', `${id} is referenced twice`, { loc: n.loc })); return; }
    seen.add(id);

    if (!KNOWN_TYPES.has(n.type)) {
      if (n.args) {
        D.push(diag('unknown-part', `"${n.type}" is not a known part`, { loc: n.loc, suggestion: closest(n.type, ctx.parts || []) }));
      } else {
        D.push(diag('unknown-type', `"${n.type}" is not a known primitive`, { loc: n.loc, suggestion: closest(n.type, [...KNOWN_TYPES]) }));
      }
    } else {
      // required props from the manifest (the ones NOT ending in "?")
      const spec = (PRIMITIVES[n.type] || {}).props || {};
      for (const [pname, hint] of Object.entries(spec)) {
        if (!String(hint).endsWith('?') && !(pname in (n.props || {}))) {
          D.push(diag('missing-prop', `${n.type} is missing the required "${pname}"`, { loc: n.loc }));
        }
      }
    }

    const props = n.props || {};
    for (const rp of REF_PROPS) if (rp in props) checkRef(props[rp], n);
    if (Array.isArray(props.style)) {
      const theme = ctx.theme || defaultTheme;
      const hasValues = Object.keys(theme.space || {}).length > 0; // a real project theme is present
      for (const t of props.style) {
        if (!isKnownTokenShape(t)) {
          // STRICT vocabulary: the family/atom must be one Muten accepts (engine = source of truth)
          D.push(diag('unknown-token', `"${t}" is not an accepted style token`, { loc: n.loc, suggestion: closest(t, SUGGESTED) }));
        } else if (hasValues && resolveToken(t, theme) === null) {
          // family is valid but the scale step isn't defined in THIS project's theme
          D.push(diag('unknown-token', `"${t}": that step isn't in your theme scale`, { loc: n.loc, suggestion: closest(t, SUGGESTED) }));
        }
      }
    }
    // expression references (when condition, each list, reactive Text/Image interpolation)
    if (n.type === 'When' && props.cond) checkExpr(props.cond, n, scope);
    if (n.type === 'Each' && props.list) checkExpr(props.list, n, scope);
    const interps = [];
    if ((n.type === 'Text' || n.type === 'Title' || n.type === 'Span') && props.value) interps.push(props.value);
    if (n.type === 'Image') { if (props.src) interps.push(props.src); if (props.alt) interps.push(props.alt); }
    for (const ip of interps) if (ip && ip.kind === 'interp') for (const part of ip.parts) if (part && part.kind) checkExpr(part, n, scope);

    // children inherit the scope; an `each` adds its item variable
    const childScope = (n.type === 'Each' && props.as) ? new Set([...scope, props.as]) : scope;
    for (const c of n.children || []) walk(c, childScope);
  };
  if (doc.rootId) walk(doc.rootId, new Set());
  else if (ctx.kind !== 'store') D.push(diag('no-root', 'the doc is missing a rootId'));

  // .store slice: validate each `get` expression's refs against the slice's own state
  if (ctx.kind === 'store') {
    for (const [name, expr] of Object.entries(doc.gets || {})) {
      for (const ref of collectRefs(expr)) {
        const head = ref.split('.')[0];
        if (!stateKeys.has(head)) D.push(diag('unknown-ref', `get "${name}": "${head}" is not a state of this store`, { suggestion: closest(head, [...stateKeys]) }));
      }
    }
  }

  // Actions: the body may only mutate what's declared in `mutates`, with known ops.
  for (const [name, a] of Object.entries(doc.actions || {})) {
    const declared = new Set(a.mutates || []);
    const checkStmt = (st) => {
      if (st.op === 'if') { for (const s of (st.then || [])) checkStmt(s); for (const s of (st.else || [])) checkStmt(s); return; } // recurse into branches
      if (!KNOWN_OPS.has(st.op)) {
        D.push(diag('unknown-op', `action "${name}" uses unknown op "${st.op}"`, { suggestion: closest(st.op, [...KNOWN_OPS]) }));
      }
      if (st.target && !declared.has(st.target)) {
        D.push(diag('undeclared-mutation', `action "${name}" mutates "${st.target}" but only declares mutates(${[...declared].join(', ') || '∅'})`, { suggestion: closest(st.target, [...declared]) }));
      }
    };
    for (const st of a.body || []) checkStmt(st);
  }

  return { ok: D.length === 0, diagnostics: D };
}
