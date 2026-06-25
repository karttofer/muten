// theme.muten -> CSS, AGNOSTICALLY. The core default is plain `:root` custom properties (no styling
// library). A muten styling PLUGIN may pass an adapter (pure data) to render ANY library's own format.
import { emitTheme } from '#engine/style/tokens.js';

let fails = 0;
const ok = (label: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : 'x'} ${label}${cond ? '' : '   ← ' + extra}`); if (!cond) fails++; };

const theme = { colors: { primary: '#6366f1', 'base-100': '#1a1d23' }, space: { md: '1rem' }, scheme: { mode: 'dark' } };

// default (no adapter): generic :root custom properties, library-neutral — the engine knows no library.
const def = emitTheme(theme);
ok('default emits :root', def.startsWith(':root {'), def);
ok('color var', def.includes('--color-primary: #6366f1;'));
ok('hyphenated key passes through', def.includes('--color-base-100: #1a1d23;'));
ok('space var', def.includes('--space-md: 1rem;'));
ok('scheme/target are meta, not vars', !def.includes('--scheme-') && !def.includes('--target-'));
ok('NO library syntax in the engine output', !def.includes('@plugin') && !def.includes('@theme'));

// a plugin-provided adapter (pure data): the engine renders ANY format from it — no library name in core.
const adapter = { prefix: { colors: '--color-' }, blocks: [{ open: '@plugin "x/theme" {', close: '}', attrs: { name: 'app', 'color-scheme': '$scheme' }, sections: ['colors'] }] };
const viaAdapter = emitTheme(theme, adapter);
ok('adapter: uses its wrapper', viaAdapter.includes('@plugin "x/theme" {'));
ok('adapter: attrs rendered', viaAdapter.includes('name: app;'));
ok('adapter: $scheme resolved from theme', viaAdapter.includes('color-scheme: dark;'));
ok('adapter: prefixed var', viaAdapter.includes('--color-primary: #6366f1;'));

ok('empty theme -> empty', emitTheme({}) === '');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL OK');
process.exit(fails ? 1 : 0);
