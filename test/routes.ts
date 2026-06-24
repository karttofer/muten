// Route table + guards: paths are quoted string literals, so a guard's `else "/redirect"` is its
// own token and can't eat the next route's path. Numeric paths like "/404" are just strings.
import { parse } from '#engine/lang/parse.js';

const ir = parse(`routes {
  "/login"    -> login    guard not auth.loggedIn else "/catalog"
  "/register" -> register guard not auth.loggedIn else "/catalog"
  "/catalog"  -> catalog  guard auth.loggedIn else "/login"
  "/product"  -> product  guard auth.loggedIn else "/login"
  "/cart"     -> cart     guard auth.loggedIn else "/login"
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

// paths are quoted strings now, so `-> "/"` is one token and can't swallow the next node
const sh = parse('shell { Link "Home" -> "/"  Nav "Main" { Link "Docs" -> "/docs" } }').shell;
ok('Link -> / stays root', sh.children[0].props.to === '/', sh.children[0].props.to);
ok('node after root Link survives', sh.children[1].type === 'Nav', sh.children[1].type);
ok('non-root Link path intact', sh.children[1].children[0].props.to === '/docs', sh.children[1].children[0].props.to);

// numeric paths as strings: the `/404` catch-all (runtime falls back to routes['/404']) + `/page/2`
const nr = parse(`routes {
  "/"       -> home
  "/page/2" -> page2
  "/404"    -> notfound
}`).routes;
ok('numeric segments parse', nr.map((r) => r.url).join(',') === '/,/page/2,/404', nr.map((r) => r.url).join(','));
ok('/404 catch-all route present', nr.some((r) => r.url === '/404'));

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
