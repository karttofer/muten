import type { Value } from '#engine/shared/types.js';

// ── `sources` semantics — defined ONCE ───────────────────────────────────────────────────────────
// A query's data source is a bare URL, or an object describing a complete HTTP request. These pure rules
// are the single source of truth: the build imports them (SSG fetch + the app graph), and the browser
// data layer inlines them VERBATIM via Function.prototype.toString() (see compile/emit.ts) — so the
// build-time fetch and the runtime fetch can never drift apart.
//
// Security: a header value ships to the client like any client-side fetch. Use public API keys or a
// per-user token set at runtime — never a server secret hardcoded here.

export interface SourceRequest {
  url: string;
  method: string;                  // upper-cased; defaults to GET
  headers: { [k: string]: string };
  body: string | null;             // JSON-serialized request body (POST/PUT/PATCH), else null
  at: string | null;               // JSON path to the array within the response (e.g. "data")
}

// Normalize a raw source descriptor (a URL string, or a request object) into a complete request, applied
// against the app-wide `api` config. Two shapes of `api` (app.muten):
//   • flat   `api { base, headers }`           → the one and only backend
//   • named  `api { shop: {…}, cms: {…} }`     → many backends; a source picks one with `{ api: "shop" }`
//                                                 (no pick → the client literally named `default`)
// A source's own url/headers win over the client's; an ABSOLUTE url ignores `base`, a RELATIVE one joins it.
// Self-contained on purpose: the runtime inlines this via toString(), so no helper may escape its body.
export function sourceRequest(src: Value, api: Value = {}): SourceRequest {
  const str = (v: Value | undefined): string => (typeof v === 'string' ? v : '');
  const obj = (v: Value | undefined): { [k: string]: Value } => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const apiObj = obj(api);
  const s = obj(src);
  // flat config (`base`/`headers` at top) is the lone client; otherwise it's a map keyed by client name.
  const flat = 'base' in apiObj || 'headers' in apiObj;
  const client = obj(flat ? apiObj : apiObj[str(s.api) || 'default']);
  const base = typeof client.base === 'string' ? client.base : '';
  const join = (u: string): string => {
    if (!u) return base;                                              // no url → the bare base
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.indexOf('//') === 0) return u; // absolute (scheme:// or //host)
    if (!base) return u;                                              // relative but no base → as-is
    return base.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');    // join, collapsing the slash seam
  };
  const headers: { [k: string]: string } = {};
  const collect = (h: Value | undefined): void => { for (const [k, v] of Object.entries(obj(h))) if (typeof v === 'string') headers[k] = v; };
  collect(client.headers);                                            // client defaults first…
  if (typeof src === 'string') return { url: join(src), method: 'GET', headers, body: null, at: null };
  collect(s.headers);                                                 // …then per-source headers override
  const hasBody = s.body !== undefined && s.body !== null;
  return { url: join(str(s.url)), method: (str(s.method) || 'GET').toUpperCase(), headers, body: hasBody ? JSON.stringify(s.body) : null, at: str(s.at) || null };
}

// Pick the row array out of a fetched JSON response: walk the dotted `at` path (e.g. "data.posts" for
// GraphQL / nested envelopes) when set, else the response IS the array.
export function sourceRows(json: Value, at: string | null): Value[] {
  let picked: Value = json;
  if (at) for (const key of at.split('.')) picked = picked !== null && typeof picked === 'object' && !Array.isArray(picked) ? picked[key] : null;
  return Array.isArray(picked) ? picked : [];
}
