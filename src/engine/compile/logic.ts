// ============================================================================
// Logic — the non-DOM half of the compiler
// ============================================================================
// Everything that turns the IR's *behaviour* into JavaScript: reference resolution, expressions,
// action statements, and the state / action / effect declarations. It emits NO DOM — that is
// compile.ts. Both halves share one `CompileCtx` (the resolved state/stores/consts of a single
// screen), so `usedStores` is literally the SAME Set: whatever a ref or action reaches here,
// compile.ts turns into an `import` for that store domain.

import { Ek, StOp, BOp, UOp, Fmt } from '#engine/shared/vocab.js';
import { JS_BINOP } from '#engine/compile/helpers.js';
import type { CompileCtx, Expr, Stmt, Scope } from '#engine/shared/types.js';

export class Logic {
  constructor(private readonly ctx: CompileCtx) {}

  // ── reference resolution ───────────────────────────────────────────────────

  // is `member` a `kind` member (state | gets | actions) of the store domain `d`?
  private inStore(d: string, member: string, kind: 'state' | 'gets' | 'actions'): boolean {
    const slice = this.ctx.stores[d];
    return !!slice && (slice[kind] || []).includes(member);
  }

  // an action name → its callable. A store action `cart.add` → `__store_cart.add` (and the domain is
  // marked used); a local action stays as written; a missing name (no `->`) compiles to nothing.
  actionRef(name: string | undefined): string {
    if (!name) return '';
    const [domain, member] = name.split('.');
    if (member && this.inStore(domain, member, 'actions')) { this.ctx.usedStores.add(domain); return `__store_${domain}.${member}`; }
    return name;
  }

  // a bind/data target → its signal name. `@local` → `local`; a store field `cart.query` →
  // `__store_cart.query`. (validate has already guaranteed the bind exists.)
  bindSig(ref: string | undefined): string {
    if (typeof ref !== 'string') return '';
    if (ref.startsWith('@')) return ref.slice(1);
    const [domain, field] = ref.split('.');
    if (field && this.ctx.stores[domain]) { this.ctx.usedStores.add(domain); return `__store_${domain}.${field}`; }
    return ref;
  }

  // the uuid fields of an entity (each gets a fresh id when an item is pushed onto a list<Entity>).
  uuidFields(entityName: string): string[] {
    const entity = this.ctx.entities[entityName] || {};
    return Object.entries(entity).filter(([, type]) => type === 'uuid').map(([field]) => field);
  }

  // does a body contain a server write (create/update/delete)? — recursing into if-branches.
  private bodyHasWrite(body: Stmt[]): boolean {
    return body.some((st) => st.op === StOp.Create || st.op === StOp.Update || st.op === StOp.Delete || st.op === StOp.Request
      || (st.op === StOp.If && (this.bodyHasWrite(st.then || []) || this.bodyHasWrite(st.else || []))));
  }
  // actions that write → they become async and expose live `.pending` / `.error` signals. Memoized.
  private writeActionsSet: Set<string> | null = null;
  private writeActions(): Set<string> {
    if (!this.writeActionsSet) this.writeActionsSet = new Set(Object.entries(this.ctx.actions).filter(([, a]) => this.bodyHasWrite(a.body || [])).map(([n]) => n));
    return this.writeActionsSet;
  }

  // resolve a dotted reference to runtime JS, honouring scope:
  //   a lambda local stays bare · a query reads `.data` (or `.loading`/`.error`) · a local state
  //   reads `.get()` · a store member reads through its module · a const inlines · else it is an
  //   action input parameter passed straight through.
  resolveRef(name: string, scope: Scope): string {
    const [head, ...rest] = name.split('.');
    const tail = rest.length ? '.' + rest.join('.') : '';
    if (scope.locals.has(head)) return head + tail;
    if (this.ctx.params.has(head)) return head + tail;        // a route param: a local string injected at mount
    if (this.ctx.queryStates.has(head)) {
      if (rest[0] === 'loading' || rest[0] === 'error') return `${head}.get()${tail}`;
      return `${head}.get().data${tail}`;                 // @users → the data array; @users.length → its length
    }
    if (this.ctx.stateKeys.has(head)) return `${head}.get()` + tail;
    if (this.ctx.stores[head]) {
      const member = rest[0];
      const more = rest.length > 1 ? '.' + rest.slice(1).join('.') : '';
      if (this.inStore(head, member, 'state') || this.inStore(head, member, 'gets')) { this.ctx.usedStores.add(head); return `__store_${head}.${member}.get()${more}`; }
    }
    if (this.ctx.consts[head] !== undefined) return JSON.stringify(rest.length ? null : this.ctx.consts[head]); // scalar const, inlined
    if (this.writeActions().has(head) && (rest[0] === 'pending' || rest[0] === 'error')) { // a write action's live status
      return `${rest[0] === 'pending' ? '__pending_' : '__error_'}${head}.get()`;
    }
    return head + tail;                                    // an action input parameter (e.g. id)
  }

  // ── expressions ────────────────────────────────────────────────────────────

  // an expression AST → a JS expression string (recursive; precedence is already baked into the tree).
  compileExpr(node: Expr, scope: Scope): string {
    if (node.kind === Ek.Lit) return JSON.stringify(node.value);
    if (node.kind === Ek.Ref) return this.resolveRef(node.name, scope);
    if (node.kind === Ek.Call) return `${node.fn}(${node.args.map((a) => this.compileExpr(a, scope)).join(', ')})`; // a use'd JS function
    if (node.kind === Ek.Tern) return `(${this.compileExpr(node.cond, scope)} ? ${this.compileExpr(node.then, scope)} : ${this.compileExpr(node.else, scope)})`;
    if (node.kind === Ek.Un) {
      if (node.op === UOp.Not) return `!(${this.compileExpr(node.operand, scope)})`;
      throw new Error('unsupported unary operator');
    }
    if (node.kind === Ek.Bin) {
      const left = this.compileExpr(node.left, scope);
      const right = this.compileExpr(node.right, scope);
      if (node.op === BOp.Contains) return `__has(${left}, ${right})`; // list membership OR substring
      const js = JS_BINOP[node.op];
      if (js) return `(${left} ${js} ${right})`;
      throw new Error('unsupported operator: ' + node.op);
    }
    throw new Error('unsupported expression');
  }

  // ── action statements ──────────────────────────────────────────────────────

  // one mutation statement (in an action body or a .store effect) → JS line(s). `if` recurses.
  stmtLines(st: Stmt, scope: Scope, isAsync = false): string[] {
    const ctx = this.ctx;
    const out: string[] = [];
    if (st.op === StOp.If) {
      out.push(`if (${this.compileExpr(st.cond, scope)}) {`);
      for (const s of st.then || []) for (const l of this.stmtLines(s, scope, isAsync)) out.push('  ' + l);
      if (st.else) { out.push('} else {'); for (const s of st.else) for (const l of this.stmtLines(s, scope, isAsync)) out.push('  ' + l); }
      out.push('}');
      return out;
    }
    if (st.op === StOp.Reset) {
      out.push(`${st.target}.set(${JSON.stringify(ctx.state[st.target].initial ?? null)});`);
    } else if (st.op === StOp.Set) {
      out.push(`${st.target}.set(${this.compileExpr(st.arg, scope)});`);
    } else if (st.op === StOp.Push) {
      const elem = (ctx.state[st.target].type.match(/^list<(.+)>$/) || [])[1];
      const isEntity = elem && ctx.entities[elem]; // list<User> → entity; list<uuid>/list → scalar
      // a query-backed target carries { data, loading, error }, so we splice into `.data`, not the signal.
      const wrap = (value: string): string => ctx.queryStates.has(st.target)
        ? `${st.target}.set({ ...${st.target}.get(), data: [...${st.target}.get().data, ${value}] });`
        : `${st.target}.set([...${st.target}.get(), ${value}]);`;
      if (isEntity) { // entity list: copy the item + auto-fill any uuid fields
        out.push(`{ const __it = { ...${this.compileExpr(st.arg, scope)} };`);
        for (const field of this.uuidFields(elem)) out.push(`  if (__it.${field} === null || __it.${field} === undefined) __it.${field} = __id(); // auto uuid`);
        out.push(`  ${wrap('__it')} }`);
      } else { // scalar list (ids, numbers…): push the value as-is
        out.push(`${wrap(this.compileExpr(st.arg, scope))}`);
      }
    } else if (st.op === StOp.Remove) {
      const inner: Scope = { ...scope, locals: new Set([...scope.locals, st.param]) };
      const pred = this.compileExpr(st.pred, inner);
      out.push(ctx.queryStates.has(st.target)
        ? `${st.target}.set({ ...${st.target}.get(), data: ${st.target}.get().data.filter((${st.param}) => !(${pred})) });`
        : `${st.target}.set(${st.target}.get().filter((${st.param}) => !(${pred})));`);
    } else if (st.op === StOp.Create || st.op === StOp.Update || st.op === StOp.Delete) {
      // server CRUD on a source-backed list: POST/PUT/DELETE the item, then reflect the change in the list.
      const isQuery = ctx.queryStates.has(st.target);
      const cur = isQuery ? `${st.target}.get().data` : `${st.target}.get()`;
      const set = (data: string): string => isQuery ? `${st.target}.set({ ...${st.target}.get(), data: ${data} })` : `${st.target}.set(${data})`;
      const err = isQuery ? `.catch((__e) => ${st.target}.set({ ...${st.target}.get(), error: String(__e) }))` : '';
      const name = JSON.stringify(st.target);
      const value = this.compileExpr(st.arg, scope);
      if (isAsync) { // OPTIMISTIC: apply now (instant UI), reconcile with the server row on success, revert on failure.
        if (st.op === StOp.Create) out.push(`{ const __i = { ...${value} }; if (__i.id == null) __i.id = __id(); const __prev = ${cur}; ${set(`[...__prev, __i]`)}; try { const __r = await __write(${name}, 'POST', null, __i); ${set(`${cur}.map((__x) => __x.id === __i.id ? __r : __x)`)}; } catch (__e) { ${set('__prev')}; throw __e; } }`);
        else if (st.op === StOp.Update) out.push(`{ const __i = ${value}; const __prev = ${cur}; ${set(`__prev.map((__x) => __x.id === __i.id ? __i : __x)`)}; try { const __r = await __write(${name}, 'PUT', __i.id, __i); ${set(`${cur}.map((__x) => __x.id === __i.id ? __r : __x)`)}; } catch (__e) { ${set('__prev')}; throw __e; } }`);
        else out.push(`{ const __i = ${value}; const __prev = ${cur}; ${set(`__prev.filter((__x) => __x.id !== __i.id)`)}; try { await __write(${name}, 'DELETE', __i.id, null); } catch (__e) { ${set('__prev')}; throw __e; } }`);
      } else { // fire-and-forget (e.g. inside a .store effect): reflect on resolve, set the query error on failure
        if (st.op === StOp.Create) out.push(`{ const __i = ${value}; __write(${name}, 'POST', null, __i).then((__r) => ${set(`[...${cur}, __r]`)})${err}; }`);
        else if (st.op === StOp.Update) out.push(`{ const __i = ${value}; __write(${name}, 'PUT', __i.id, __i).then((__r) => ${set(`${cur}.map((__x) => __x.id === __i.id ? __r : __x)`)})${err}; }`);
        else out.push(`{ const __i = ${value}; __write(${name}, 'DELETE', __i.id, null).then(() => ${set(`${cur}.filter((__x) => __x.id !== __i.id)`)})${err}; }`);
      }
    } else if (st.op === StOp.Refetch) {
      // re-run a query with N query-string params (pagination / search / filters) → updates its signal.
      const pairs = Object.entries(st.params).map(([k, e]) => `${JSON.stringify(k)}: ${this.compileExpr(e, scope)}`).join(', ');
      out.push(`__refetch(${JSON.stringify(st.target)}, { ${pairs} }, ${st.target});`);
    } else if (st.op === StOp.Request) {
      // explicit non-REST request (escape hatch): build the url (with interpolation) + send the optional body.
      const url = typeof st.url === 'string' ? JSON.stringify(st.url)
        : st.url.parts.map((p) => typeof p === 'string' ? JSON.stringify(p) : `String(${this.compileExpr(p, scope)})`).join(' + ');
      const body = st.body ? this.compileExpr(st.body, scope) : 'null';
      out.push(isAsync ? `await __send(${url}, ${JSON.stringify(st.method)}, ${body});` : `__send(${url}, ${JSON.stringify(st.method)}, ${body}).catch(() => {});`);
    }
    return out;
  }

  // ── declarations (state / action / effect) ───────────────────────────────────

  // declared state → `signal(initial)` or `query(name)`. Exported when this is a .store slice.
  genState(): string {
    const exp = this.ctx.format === Fmt.Store ? 'export ' : '';
    const out: string[] = [];
    for (const [name, def] of Object.entries(this.ctx.state)) {
      if (typeof def.source === 'string' && def.source.startsWith('query:')) {
        out.push(`${exp}const ${name} = query(${JSON.stringify(def.source.slice('query:'.length))}); // async: ${name}.loading / .error / .data`);
      } else {
        out.push(`${exp}const ${name} = signal(${JSON.stringify(def.initial ?? null)});`);
      }
    }
    return out.join('\n  ');
  }

  // declared actions → functions. An action whose input names a state takes no parameter (it reads
  // that state directly). Exported for a .store slice so pages can import them.
  genActions(): string {
    const exp = this.ctx.format === Fmt.Store ? 'export ' : '';
    const decls: string[] = []; // .pending/.error signals for write actions, hoisted above the functions
    const out: string[] = [];
    for (const [name, action] of Object.entries(this.ctx.actions)) {
      const inputIsState = this.ctx.stateKeys.has(action.input);
      const scope: Scope = { locals: new Set(), input: action.input, inputIsState };
      const param = inputIsState ? '' : action.input;
      if (this.writeActions().has(name)) { // talks to the backend → async, with live .pending / .error
        decls.push(`${exp}const __pending_${name} = signal(false);`, `${exp}const __error_${name} = signal(null);`);
        out.push(`${exp}async function ${name}(${param}) {`);
        out.push(`  __pending_${name}.set(true); __error_${name}.set(null);`);
        out.push('  try {');
        for (const st of action.body || []) for (const l of this.stmtLines(st, scope, true)) out.push('    ' + l);
        out.push(`  } catch (__e) { __error_${name}.set(String(__e)); }`);
        out.push(`  __pending_${name}.set(false);`);
        out.push('}');
      } else {
        out.push(`${exp}function ${name}(${param}) {`);
        for (const st of action.body || []) for (const l of this.stmtLines(st, scope)) out.push('  ' + l);
        out.push('}');
      }
    }
    return [...decls, ...out].join('\n  ');
  }

  // .store reactive side-effects → effect(() => { … }), re-running when the state they read changes.
  genEffects(): string {
    const scope: Scope = { locals: new Set() };
    return this.ctx.effects.map((body) =>
      `effect(() => {\n${body.map((st) => this.stmtLines(st, scope).map((l) => '    ' + l).join('\n')).join('\n')}\n  });`).join('\n  ');
  }
}
