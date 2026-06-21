// BASE (the reset, incl. `.stack{flex-direction:column}`) must be injected ONCE — carried by the
// shell, NOT by every page. Otherwise a 2nd page's duplicate `.stack` lands after the 1st page's
// `.t-row`/`.t-grid` in the cascade and overrides them → layouts silently collapse to vertical.
import { parse } from '../engine/parse.js';
import { toDoc } from '../engine/flatten.js';
import { compileModule } from '../engine/compile.js';
import { mergeTheme } from '../engine/tokens.js';

const theme = mergeTheme({ base: '.stack{display:flex;flex-direction:column}' }); // base comes from the PROJECT theme

let f = 0;
const ok = (l, c) => { console.log((c ? '✓' : '✗') + ' ' + l); if (!c) f++; };

const page = parse('screen p\nStack style(row) { Text "x" }');
const shellTree = parse('shell { Stack style(row) { Text "x" } }').shell;

const pageCode = compileModule(toDoc(page), {}, '', {}, {}, { theme });                 // page → no base
const shellCode = compileModule(toDoc({ screen: 'shell', entities: {}, state: {}, actions: {}, tree: shellTree }), {}, '', {}, {}, { base: true, theme });

ok('page CSS omits BASE (.stack)', !pageCode.includes('.stack{display:flex'));
ok('page CSS still has its token (.t-row)', pageCode.includes('.t-row{'));
ok('shell CSS carries BASE (.stack) once', shellCode.includes('.stack{display:flex'));

console.log(f ? `\n${f} FAILURE(S)` : '\nALL OK');
process.exit(f ? 1 : 0);
