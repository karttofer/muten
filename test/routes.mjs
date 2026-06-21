// Route table + guards: paths are line-scoped so a guard's `else /redirect` doesn't eat the
// next route's path (regression: greedy parsePath produced empty urls → "duplicate route").
import { parse } from '../engine/parse.js';

const ir = parse(`routes {
  /login   -> login   guard not auth.loggedIn else /catalog
  /register -> register guard not auth.loggedIn else /catalog
  /catalog -> catalog guard auth.loggedIn else /login
  /product -> product guard auth.loggedIn else /login
  /cart    -> cart    guard auth.loggedIn else /login
}`);

let f = 0;
const ok = (l, c, e = '') => { console.log((c ? '✓' : '✗') + ' ' + l + (c ? '' : '   ← ' + e)); if (!c) f++; };
const rs = ir.routes;

ok('5 routes', rs.length === 5, rs.length);
ok('urls not swallowed', rs.map((r) => r.url).join(',') === '/login,/register,/catalog,/product,/cart', rs.map((r) => r.url).join(','));
ok('redirects not greedy', rs.map((r) => r.redirect).join(',') === '/catalog,/catalog,/login,/login,/login', rs.map((r) => r.redirect).join(','));
ok('guest-guard negated (login/register)', rs[0].guardNeg === true && rs[1].guardNeg === true);
ok('protected-guard positive (catalog)', rs[2].guardNeg === false && rs[2].guard === 'auth.loggedIn');
ok('pages mapped', rs.map((r) => r.page).join(',') === 'login,register,catalog,product,cart');

// a Link to root (`-> /`) must not swallow the following node (parsePath adjacency)
const sh = parse('shell { Link "Home" -> /  Nav "Main" { Link "Docs" -> /docs } }').shell;
ok('Link -> / stays root', sh.children[0].props.to === '/', sh.children[0].props.to);
ok('node after root Link survives', sh.children[1].type === 'Nav', sh.children[1].type);
ok('non-root Link path intact', sh.children[1].children[0].props.to === '/docs', sh.children[1].children[0].props.to);

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
