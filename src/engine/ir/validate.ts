// validate — structured diagnostics over the flat Doc (the validation stage of the pipeline).
//
// Because it knows the WHOLE vocabulary (types, tokens, state, ops, parts) and the scope of each
// `each` item, every error is specific and proposes the closest candidate ("did you mean …?"). The
// same Doc that compiles is the one validated, so the editor and the build never disagree. Consumed
// by the live linter, the CLI's `muten lint`, and the Vite plugin.

import { resolveToken, SUGGESTED, defaultTheme, isKnownTokenShape } from '#engine/style/tokens.js';
import { diag, closest } from '#engine/shared/diagnostics.js';
import { PRIMITIVE_NAMES, ACTION_OPS, PRIMITIVES } from '#engine/lang/manifest.js';
import { Nt, Ek, StOp } from '#engine/shared/vocab.js';
import type { Doc, FlatNode, ValidateCtx, ValidateResult, Diagnostic, Expr, Stmt, StringPropValue, Loc } from '#engine/shared/types.js';

const KNOWN_TYPES = new Set<string>([...PRIMITIVE_NAMES, Nt.Shell]); // manifest primitives + the Shell wrapper (app.muten root)
const REF_PROPS: Array<'bind' | 'data'> = ['bind', 'data']; // props whose value is @state
const KNOWN_OPS = new Set<string>(ACTION_OPS);
const SCALARS = ['text', 'number', 'bool', 'uuid', 'email', 'string'];

// collect the variable names referenced by an expression AST
function collectRefs(e: Expr, acc: string[] = []): string[] {
  if (e.kind === Ek.Ref) acc.push(e.name);
  else if (e.kind === Ek.Un) collectRefs(e.operand, acc);
  else if (e.kind === Ek.Bin) { collectRefs(e.left, acc); collectRefs(e.right, acc); }
  else if (e.kind === Ek.Tern) { collectRefs(e.cond, acc); collectRefs(e.then, acc); collectRefs(e.else, acc); }
  else if (e.kind === Ek.Call) { for (const a of e.args) collectRefs(a, acc); } // args' refs; the fn is checked separately
  return acc;
}

// collect the names of `use`'d functions called in an expression (the fn of each call, recursively)
function collectCalls(e: Expr, acc: string[] = []): string[] {
  if (e.kind === Ek.Call) { acc.push(e.fn); for (const a of e.args) collectCalls(a, acc); }
  else if (e.kind === Ek.Un) collectCalls(e.operand, acc);
  else if (e.kind === Ek.Bin) { collectCalls(e.left, acc); collectCalls(e.right, acc); }
  else if (e.kind === Ek.Tern) { collectCalls(e.cond, acc); collectCalls(e.then, acc); collectCalls(e.else, acc); }
  return acc;
}

// ctx.parts = known part names in the project (to suggest and validate instances)
export function validate(doc: Doc, ctx: ValidateCtx = {}): ValidateResult {
  const D: Diagnostic[] = [];

  const stateKeys = new Set(Object.keys(doc.state || {}));
  const storeDomains = new Set(ctx.stores || []); // app-global store slices (cart.total, cart.add)
  const constNames = new Set(Object.keys(doc.consts || {})); // compile-time constants
  const paramNames = new Set(doc.params || []);              // route params (`param id`)
  const actionNames = new Set(Object.keys(doc.actions || {})); // for `action.pending` / `action.error` refs
  const isIslandFrom = (from: string) => /^(svelte|react):/.test(from); // adapter-prefixed `use` = a component island
  const externs = new Set((doc.imports || []).filter((i) => !isIslandFrom(i.from)).flatMap((i) => i.names)); // logic functions callable in exprs
  const islandNames = new Set((doc.imports || []).filter((i) => isIslandFrom(i.from)).flatMap((i) => i.names)); // foreign-framework components used as nodes
  const nodes = doc.nodes || {};

  // a `use`'d function call must reference a declared import (the seam to JS stays bounded + checkable)
  const checkCalls = (expr: Expr, loc?: Loc | null): void => {
    for (const fn of collectCalls(expr)) {
      if (!externs.has(fn)) D.push(diag('unknown-function', `"${fn}" is not a use'd function`, { loc, suggestion: closest(fn, [...externs]), from: fn }));
    }
  };

  // CLOSED member sets → catch typos in a dotted ref. A query state exposes {loading,error,data} + (if it's
  // entity-typed) its fields; a store exposes its state/gets/actions (threaded in by lintApp, cross-file).
  const queryMembers = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(doc.state || {})) {
    if (!def.source?.startsWith('query:')) continue;
    const allowed = new Set(['loading', 'error', 'data']);
    const entity = doc.entities?.[def.type];
    if (entity) { allowed.add('id'); for (const f of Object.keys(entity)) allowed.add(f); }
    queryMembers.set(name, allowed);
  }
  const storeMemberMap = new Map<string, Set<string>>();
  for (const [d, ms] of Object.entries(ctx.storeMembers || {})) storeMemberMap.set(d, new Set(ms));
  const checkMember = (head: string, member: string, node: FlatNode): void => {
    const q = queryMembers.get(head);
    if (q) { if (!q.has(member)) D.push(diag('unknown-member', `"${member}" is not a member of query "${head}"`, { loc: node.loc, suggestion: closest(member, [...q]), from: member })); return; }
    const s = storeMemberMap.get(head);
    if (s && !s.has(member)) D.push(diag('unknown-member', `"${member}" is not a member of store "${head}"`, { loc: node.loc, suggestion: closest(member, [...s]), from: member }));
  };

  // ── state types: a `list` must declare its element (the north star — always know what's inside) ──
  const entityNames = Object.keys(doc.entities || {});
  for (const [name, def] of Object.entries(doc.state || {})) {
    const t = def.type;
    if (t === 'list') {
      D.push(diag('untyped-list', `state "${name}" is an untyped "list" — declare the element type, e.g. list<uuid> or list<User>`, { loc: def.loc, suggestion: 'list<uuid>' }));
    } else if (t.startsWith('list<')) {
      const elem = t.slice(5, -1);
      if (!SCALARS.includes(elem) && !entityNames.includes(elem)) {
        D.push(diag('unknown-type', `list element "${elem}" is not a known entity or scalar type`, { loc: def.loc, suggestion: closest(elem, [...entityNames, ...SCALARS]), from: elem }));
      }
    } else if (def.initial !== undefined && def.initial !== null) {
      // a scalar state's initial value must match its declared type (e.g. `count = "" : number` is wrong)
      const want = t === 'number' ? 'number' : t === 'bool' ? 'boolean' : (['text', 'string', 'email', 'uuid'].includes(t) ? 'string' : '');
      if (want && typeof def.initial !== want) {
        D.push(diag('type-mismatch', `state "${name}" is typed "${t}" but its initial value is a ${typeof def.initial}`, { loc: def.loc }));
      }
    }
  }

  // an `each` item carries the element type of its list (an entity name), so a field typo on the loop var
  // is caught exactly like one on @state — `each users as u { Text "{u.naem}" }` → "naem" not a field of User.
  const entityFieldSet = (type: string): Set<string> | null => {
    const ent = doc.entities?.[type];
    return ent ? new Set(['id', ...Object.keys(ent)]) : null;
  };
  const listElem = (e: Expr | undefined): string => { // the element TYPE of `each <list>` (entity or scalar; '' if unresolved)
    if (!e || e.kind !== Ek.Ref) return '';
    const t = doc.state?.[e.name.split('.')[0]]?.type || '';
    return t.startsWith('list<') ? t.slice(5, -1) : '';
  };

  const checkRef = (value: string | undefined, node: FlatNode): void => {
    if (typeof value === 'string' && value.startsWith('@')) {
      const name = value.slice(1).split('.')[0];
      if (!stateKeys.has(name)) {
        const near = closest(name, [...stateKeys]);
        D.push(diag('unknown-ref', `"@${name}" is not a declared state`, { loc: node.loc, suggestion: near ? '@' + near : null, from: '@' + name, related: near ? doc.state?.[near]?.loc ?? null : null }));
      }
    }
  };

  // an action ref (`-> action`, `submit action`): a bare name must be a declared action. Dotted (store
  // action, `cart.add`) and $param (part callback) refs resolve elsewhere (cross-file / compose) — skip.
  const checkAction = (value: string | undefined, node: FlatNode): void => {
    if (!value || value.startsWith('$')) return;
    if (value.includes('.')) { const dot = value.indexOf('.'); checkMember(value.slice(0, dot), value.slice(dot + 1).split('.')[0], node); return; } // store action (cart.add)
    if (!actionNames.has(value)) {
      D.push(diag('unknown-action', `"${value}" is not a declared action`, { loc: node.loc, suggestion: closest(value, [...actionNames]), from: value }));
    }
  };

  // validate the variables an expression uses against (item scope ∪ state). `scope` maps an in-scope item
  // variable to its entity type ('' if not an entity list), so we can field-check the loop var too.
  const checkExpr = (expr: Expr, node: FlatNode, scope: Map<string, string>): void => {
    checkCalls(expr, node.loc); // `use`'d function calls must be declared
    for (const ref of collectRefs(expr)) {
      const dot = ref.indexOf('.');
      const head = dot === -1 ? ref : ref.slice(0, dot);
      if (!(scope.has(head) || stateKeys.has(head) || storeDomains.has(head) || constNames.has(head) || paramNames.has(head) || actionNames.has(head))) {
        D.push(diag('unknown-ref', `"${head}" is not a known state or item variable here`, { loc: node.loc, suggestion: closest(head, [...stateKeys, ...scope.keys()]), from: head }));
        continue;
      }
      if (dot === -1) continue;
      const member = ref.slice(dot + 1).split('.')[0];
      // the head's element/value type: an `each` item (scope) or a state cell. Field-check entities; a scalar
      // has no fields at all; everything else (query / store / list) falls back to the closed member-set check.
      const t = scope.has(head) ? (scope.get(head) || '') : (doc.state?.[head]?.type || '');
      const fields = entityFieldSet(t);
      if (fields) {
        if (!fields.has(member)) D.push(diag('unknown-member', `"${member}" is not a field of ${t} (${scope.has(head) ? 'item' : 'state'} "${head}")`, { loc: node.loc, suggestion: closest(member, [...fields]), from: member }));
      } else if (SCALARS.includes(t)) {
        D.push(diag('unknown-member', `"${head}" is a ${t} — it has no field "${member}"`, { loc: node.loc }));
      } else if (actionNames.has(head) && !stateKeys.has(head)) {
        const am = new Set(['pending', 'error']); // an async action exposes only .pending / .error
        if (!am.has(member)) D.push(diag('unknown-member', `action "${head}" exposes only .pending / .error, not "${member}"`, { loc: node.loc, suggestion: closest(member, [...am]), from: member }));
      } else {
        checkMember(head, member, node); // typo'd query/store member
      }
    }
  };

  // ── the node tree: known type · required props · valid style tokens · resolvable expression refs ──
  const seen = new Set<string>();
  const walk = (id: string, scope: Map<string, string>): void => {
    const n = nodes[id];
    if (!n) { D.push(diag('missing-node', `node ${id} does not exist`)); return; }
    if (seen.has(id)) { D.push(diag('dup-node', `${id} is referenced twice`, { loc: n.loc })); return; }
    seen.add(id);

    if (islandNames.has(n.type)) {
      // a foreign-framework island (use X from "svelte:…") used as a node — valid; its internals are opaque
    } else if (!KNOWN_TYPES.has(n.type)) {
      if (n.args) {
        D.push(diag('unknown-part', `"${n.type}" is not a known part`, { loc: n.loc, suggestion: closest(n.type, [...(ctx.parts || []), ...islandNames]), from: n.type }));
      } else {
        D.push(diag('unknown-type', `"${n.type}" is not a known primitive`, { loc: n.loc, suggestion: closest(n.type, [...KNOWN_TYPES]), from: n.type }));
      }
    } else {
      // required props from the manifest (the ones NOT ending in "?")
      const prim = PRIMITIVES[n.type];
      const spec = prim ? prim.props : {};
      for (const [pname, hint] of Object.entries(spec)) {
        if (!hint.endsWith('?') && !(pname in (n.props || {}))) {
          D.push(diag('missing-prop', `${n.type} is missing the required "${pname}"`, { loc: n.loc }));
        }
      }
    }

    const props = n.props || {};
    for (const rp of REF_PROPS) if (rp in props) checkRef(props[rp], n);
    if (props.action) checkAction(props.action, n);
    if (props.submit) checkAction(props.submit, n);
    if (Array.isArray(props.style)) {
      const theme = ctx.theme || defaultTheme;
      const hasValues = Object.keys(theme.space || {}).length > 0; // a real project theme is present
      for (const t of props.style) {
        if (!isKnownTokenShape(t)) {
          // STRICT vocabulary: the family/atom must be one Muten accepts (engine = source of truth)
          D.push(diag('unknown-token', `"${t}" is not an accepted style token`, { loc: n.loc, suggestion: closest(t, SUGGESTED), from: t }));
        } else if (hasValues && resolveToken(t, theme) === null) {
          // family is valid but the scale step isn't defined in THIS project's theme
          D.push(diag('unknown-token', `"${t}": that step isn't in your theme scale`, { loc: n.loc, suggestion: closest(t, SUGGESTED), from: t }));
        }
      }
    }
    // expression references (when condition, each list, reactive Text/Image interpolation)
    if (n.type === Nt.When && props.cond) checkExpr(props.cond, n, scope);
    if (n.type === Nt.Each && props.list) checkExpr(props.list, n, scope);
    const interps: StringPropValue[] = [];
    if ((n.type === Nt.Text || n.type === Nt.Title || n.type === Nt.Span) && props.value) interps.push(props.value);
    if (n.type === Nt.Image) { if (props.src) interps.push(props.src); if (props.alt) interps.push(props.alt); }
    if (n.type === Nt.Link && props.to) interps.push(props.to);
    if (props.label) interps.push(props.label); // Link/Button/RowAction labels interpolate too
    for (const ip of interps) {
      if (typeof ip === 'object' && 'kind' in ip && ip.kind === Ek.Interp) {
        for (const part of ip.parts) if (typeof part !== 'string') checkExpr(part, n, scope);
      }
    }

    // children inherit the scope; an `each` adds its item variable, typed with the list's element entity
    const childScope = (n.type === Nt.Each && props.as)
      ? new Map([...scope, [props.as, listElem(props.list)] as [string, string]])
      : scope;
    for (const c of n.children || []) walk(c, childScope);
  };
  if (doc.rootId) walk(doc.rootId, new Map());
  else if (ctx.kind !== 'store') D.push(diag('no-root', 'the doc is missing a rootId'));

  // ── .store gets: each `get` expression resolves against the slice's own state ──
  if (ctx.kind === 'store') {
    for (const [name, expr] of Object.entries(doc.gets || {})) {
      checkCalls(expr); // `use`'d functions in a store's get
      for (const ref of collectRefs(expr)) {
        const head = ref.split('.')[0];
        if (!stateKeys.has(head)) D.push(diag('unknown-ref', `get "${name}": "${head}" is not a state of this store`, { suggestion: closest(head, [...stateKeys]), from: head }));
      }
    }
  }

  // ── actions: a body may only mutate what `mutates` declares, with known ops ──
  for (const [name, a] of Object.entries(doc.actions || {})) {
    const declared = new Set(a.mutates || []);
    const checkStmt = (st: Stmt): void => {
      if (st.op === StOp.If) { checkCalls(st.cond); for (const s of (st.then || [])) checkStmt(s); for (const s of (st.else || [])) checkStmt(s); return; } // recurse into branches
      if (!KNOWN_OPS.has(st.op)) {
        D.push(diag('unknown-op', `action "${name}" uses unknown op "${st.op}"`, { suggestion: closest(st.op, [...KNOWN_OPS]), from: st.op }));
      }
      if ('target' in st && st.target && !declared.has(st.target)) {
        D.push(diag('undeclared-mutation', `action "${name}" mutates "${st.target}" but only declares mutates(${[...declared].join(', ') || '∅'})`, { suggestion: closest(st.target, [...declared]), from: st.target }));
      }
      if ('arg' in st && st.arg) checkCalls(st.arg); // a use'd function called in the statement's value
    };
    for (const st of a.body || []) checkStmt(st);
  }

  return { ok: D.length === 0, diagnostics: D };
}
