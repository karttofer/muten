// refs: the SINGLE semantic resolver. validate (the oracle) and compile (the emitter) both consult
// these, so "what exists" and "what type is behind a list" can never drift between lint and runtime.
// Before this, the same resolution lived TWICE (validate's refListType / compile's listElemType) and a
// gap in one but not the other = the classic "lint passes, runtime ReferenceErrors" (the two-layer bug).
import type { Expr, Entity, StateDef, Stmt } from '#engine/shared/types.js';
import { Ek, StOp } from '#engine/shared/vocab.js';

/** The per-document facts both sides hold (from a Doc or a CompileCtx — same underlying data). */
export interface RefFacts {
  state: { [name: string]: StateDef };
  gets: { [name: string]: Expr };
  entities: { [name: string]: Entity };
  storeEntities?: { [domainDotMember: string]: Entity };  // element entity of a CROSS-STORE list ("orders.items" -> Order), so aggregates over a store list resolve their item fields
}

/** Every name muten can resolve a HEAD to, besides lexical scope. Built identically from a Doc or a
 *  CompileCtx so the "is this a real thing?" question has ONE answer. */
export interface KnownHeads {
  stateKeys: Set<string>;
  gets: Set<string>;
  stores: Set<string>;
  consts: Set<string>;
  routeParams: Set<string>;
  actions: Set<string>;
}

/** Is `head` something muten KNOWS about — a lexical local (the caller's `inScope` covers each-vars,
 *  item fields and action params), or a declared state/get/store/const/route-param/action? The ONE
 *  predicate behind every `unknown-ref`, so the linter and the emitter agree on what exists. */
export function isKnownHead(head: string, inScope: (h: string) => boolean, h: KnownHeads): boolean {
  return inScope(head)
    || h.stateKeys.has(head) || h.gets.has(head) || h.stores.has(head)
    || h.consts.has(head) || h.routeParams.has(head) || h.actions.has(head);
}

/** The declared/derived type tag behind a head: a state's type, or the list type a `get` resolves to
 *  (a `where`-filter / sort over another list/get). '' when unresolvable. Cycle-guarded. */
export function headType(head: string, f: RefFacts, seen: Set<string> = new Set()): string {
  const st = f.state[head]?.type;
  if (st) return st;                                  // state — a query's `.data` is the same list type
  const body = f.gets[head];
  if (body !== undefined && !seen.has(head)) { seen.add(head); return exprListType(body, f, seen); }
  return '';
}

/** The list type an expression produces, when it produces one (Ref / where-filter / sort preserve it).
 *  Exported for the linter's `getListType`; recurses through `headType`. */
export function exprListType(e: Expr | undefined, f: RefFacts, seen: Set<string>): string {
  if (!e) return '';
  if (e.kind === Ek.Ref) return headType(e.name.split('.')[0], f, seen);
  if (e.kind === Ek.Filter) return headType(e.list.split('.')[0], f, seen);                                  // a `where`-filter preserves the element type
  if (e.kind === Ek.Agg && (e.op === 'sort' || e.op === 'sortDesc' || e.op === 'take')) return headType(e.list.split('.')[0], f, seen); // sort/take return a list of the SAME element type
  return '';
}

/** The ELEMENT entity behind a list head ('' when not a list-of-entity). */
export function elementType(head: string, f: RefFacts, seen: Set<string> = new Set()): string {
  const t = headType(head, f, seen);
  return t.startsWith('list<') ? t.slice(5, -1) : '';
}

/** Bare-referenceable fields of a list's element, for an item-implicit `where`/`by` scope:
 *  `list<Task>` -> { id, ...Task fields }; a non-entity element (list<uuid>) -> just `id`. */
export function elementFields(elementTypeName: string, f: RefFacts): Set<string> {
  const entity = f.entities[elementTypeName];
  return new Set(['id', ...(entity ? Object.keys(entity) : [])]);
}

/** The element ENTITY (field -> type) behind a list REFERENCE — page-local (`tasks` -> Task) OR cross-store
 *  (`orders.items` -> the store's Order). undefined if not a list-of-entity. The ONE resolver both the
 *  linter (to bind an aggregate's item fields) and the emitter (to emit `__it.<field>`) use, so a
 *  cross-store aggregate can never lint-pass-then-runtime-break on a field. */
export function listElementEntity(listRef: string, f: RefFacts): Entity | undefined {
  const local = elementType(listRef.split('.')[0], f);
  if (local && f.entities[local]) return f.entities[local];
  return f.storeEntities?.[listRef];
}

/** Item-implicit field names for a list ref (id + the element's fields), page-local or cross-store. */
export function listElementFields(listRef: string, f: RefFacts): Set<string> {
  const ent = listElementEntity(listRef, f);
  return new Set(['id', ...(ent ? Object.keys(ent) : [])]);
}

// the head names an expression READS (the signals an effect would track on running it).
function exprRefs(e: Expr, acc: Set<string>): void {
  switch (e.kind) {
    case Ek.Ref: acc.add(e.name.split('.')[0]); break;
    case Ek.Un: exprRefs(e.operand, acc); break;
    case Ek.Bin: exprRefs(e.left, acc); exprRefs(e.right, acc); break;
    case Ek.Tern: exprRefs(e.cond, acc); exprRefs(e.then, acc); exprRefs(e.else, acc); break;
    case Ek.Call: for (const a of e.args) exprRefs(a, acc); break;
    case Ek.Obj: for (const fld of e.fields) exprRefs(fld.value, acc); break;
    case Ek.Agg: acc.add(e.list.split('.')[0]); break;
    case Ek.Filter: acc.add(e.list.split('.')[0]); break;
  }
}

/** Targets a body updates FROM THEIR OWN VALUE at the TOP LEVEL — `x.set(x + 1)`, `x.push(…x…)`,
 *  `x.toggle(x…)`. In an effect (or a store action an effect calls) these self-trigger forever: an effect
 *  re-runs on every signal it reads, so writing a signal it reads loops (the page hangs, silently). Only
 *  top-level statements are scanned — a write GUARDED by `if {…}` usually converges, so it isn't flagged. */
export function selfUpdateTargets(body: Stmt[]): string[] {
  const out: string[] = [];
  for (const st of body) {
    if (!('target' in st) || !st.target) continue;
    if ((st.op === StOp.Set || st.op === StOp.Push || st.op === StOp.Toggle) && 'arg' in st && st.arg) {
      const reads = new Set<string>();
      exprRefs(st.arg, reads);
      if (reads.has(st.target)) out.push(st.target);
    }
  }
  return out;
}
