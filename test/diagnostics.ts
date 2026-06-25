// Diagnostics: the compiler detects the error AND proposes the closest candidate.
import { parse } from '#engine/lang/parse.js';
import { toDoc } from '#engine/ir/flatten.js';
import { validate } from '#engine/ir/validate.js';
import { ParseError } from '#engine/shared/diagnostics.js';
import { mergeTheme } from '#engine/style/tokens.js';

let fails = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : 'x'} ${label}${ok ? '' : '   ← ' + extra}`);
  if (!ok) fails++;
};
const diagsOf = (src, ctx = {}) => validate(toDoc(parse(src)), ctx).diagnostics;

// 1. invalid style token → suggests the closest one + gives a position
{
  const d = diagsOf('screen t\nPage style(gap.mdd) { Text "x" }', { theme: mergeTheme({ space: { md: '16px' } }) }).find((x) => x.code === 'unknown-token');
  check('invalid token detected', !!d, 'no diagnostic');
  check('suggests "gap.md"', d?.suggestion === 'gap.md', d?.suggestion);
  check('has loc (line/col)', !!(d?.loc?.line), JSON.stringify(d?.loc));
}

// 2. @ref to a missing state → suggests the close state
{
  const d = diagsOf('screen t\nstate { search = "" : text }\nPage { SearchField bind @serch "x" }').find((x) => x.code === 'unknown-ref');
  check('invalid @ref detected', !!d, 'no diagnostic');
  check('suggests "@search"', d?.suggestion === '@search', d?.suggestion);
}

// 3. unknown node type → suggests the close primitive
{
  const d = diagsOf('screen t\nPage { DataTabel @x }').find((x) => x.code === 'unknown-type');
  check('unknown type detected', !!d, 'no diagnostic');
  check('suggests "DataTable"', d?.suggestion === 'DataTable', d?.suggestion);
}

// 4. mutation not declared in `mutates` → suggests the declared target
{
  const src = 'screen t\nstate { users = "" : text }\naction a mutates users <- x {\n  userss.reset()\n}\nPage { Text "x" }';
  const d = diagsOf(src).find((x) => x.code === 'undeclared-mutation');
  check('undeclared mutation detected', !!d, 'no diagnostic');
  check('suggests "users"', d?.suggestion === 'users', d?.suggestion);
}

// 5. syntax error → ParseError with position
{
  let err = null;
  try { parse('screen t\nPage style(  {'); } catch (e) { err = e; }
  check('throws ParseError', err instanceof ParseError, String(err));
  check('ParseError has loc', !!(err?.loc?.line), JSON.stringify(err?.loc));
}

// 6. field typo on an `each` ITEM variable → caught against the list's element entity, suggests the field
{
  const ent = 'entity User { name text  email email }';
  const list = `screen t\n${ent}\nstate { users = [] : list<User> }\n`;
  const bad = diagsOf(`${list}Page { each users as u { Text "{u.naem}" } }`).find((x) => x.code === 'unknown-member');
  check('each item field typo detected', !!bad, 'no diagnostic');
  check('suggests "name"', bad?.suggestion === 'name', bad?.suggestion);
  const ok = diagsOf(`${list}Page { each users as u { Text "{u.name}" } }`);
  check('correct each item field is clean (no false positive)', ok.length === 0, JSON.stringify(ok.map((d) => d.message)));
}

// 7. field typo on an entity-typed STATE, and member access on a scalar (which has no fields at all)
{
  const stTypo = diagsOf('screen t\nentity User { name text }\nstate { user = {} : User }\nPage { Text "{user.naem}" }').find((x) => x.code === 'unknown-member');
  check('entity-state field typo detected', stTypo?.suggestion === 'name', stTypo?.suggestion);
  const scalar = diagsOf('screen t\nstate { count = 0 : number }\nPage { Text "{count.foo}" }').find((x) => x.code === 'unknown-member');
  check('member access on a scalar detected', !!scalar, 'no diagnostic');
}

// 8. type-mismatch (initial value vs declared type), action member typo, and the structured `fix` for auto-apply
{
  const tm = diagsOf('screen t\nstate { count = "" : number }\nPage { Text "x" }').find((x) => x.code === 'type-mismatch');
  check('init/type mismatch detected', !!tm, 'no diagnostic');
  const am = diagsOf('screen t\nstate { x = 0 : number }\naction go mutates x <- v { x.set(v) }\nPage { when go.pendng { Text "x" } }').find((x) => x.code === 'unknown-member');
  check('action member typo → suggests pending', am?.suggestion === 'pending', am?.suggestion);
  const fx = diagsOf('screen t\nstate { search = "" : text }\nPage { SearchField bind @serch "x" }').find((x) => x.code === 'unknown-ref');
  check('diagnostic carries a fix {from,to}', fx?.fix?.from === '@serch' && fx?.fix?.to === '@search', JSON.stringify(fx?.fix));
  check('diagnostic carries `related` (declaration loc)', !!fx?.related?.line, JSON.stringify(fx?.related));
}

// 9. `contains` on a list of ENTITIES (objects) with a scalar → always-false; the oracle catches it (was blind)
{
  const d = diagsOf('screen t\nentity F { symbol text }\nstate { favs = [] : list<F>  sym = "" : text }\nget x = favs contains sym').find((x) => x.code === 'contains-entity');
  check('list<Entity> contains scalar detected', !!d, 'no diagnostic');
  const okScalar = diagsOf('screen t\nstate { favs = [] : list<text>  sym = "" : text }\nget x = favs contains sym');
  check('list<scalar> contains is clean (no false positive)', okScalar.every((x) => x.code !== 'contains-entity'), JSON.stringify(okScalar.map((d) => d.code)));
}

// 10. aggregate/sort OVER a derived `get` resolves the element's fields (was blind: `lt` ignored gets)
{
  const store = 'entity O { amount number  stage text }\nstate { opps = query opps : list<O> }\nmock { opps: [{ amount: 5, stage: "won" }] }\n';
  const clean = diagsOf(store + 'get won = opps.data where stage == "won"\nget wonValue = won.sum by amount', { kind: 'store' });
  check('sum over a get resolves item fields', clean.every((x) => x.code !== 'unknown-ref'), JSON.stringify(clean.map((d) => d.code)));
  const chain = diagsOf(store + 'get a = opps.data where stage == "won"\nget b = a.sortDesc by amount\nget c = b.avg by amount', { kind: 'store' });
  check('chained gets (filter->sort->avg) resolve', chain.every((x) => x.code !== 'unknown-ref'), JSON.stringify(chain.map((d) => d.code)));
  const typo = diagsOf(store + 'get won = opps.data where stage == "won"\nget bad = won.sum by nope', { kind: 'store' }).find((x) => x.code === 'unknown-ref');
  check('still flags a real field typo in the projection', !!typo, 'no diagnostic — over-permissive');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL OK');
process.exit(fails ? 1 : 0);
