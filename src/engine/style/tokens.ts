// tokens: layout + typography vocabulary for the engine (compile pipeline, style stage).
// Owns which token families/atoms exist and what CSS each maps to. No values: scales and
// breakpoint pixels come from the project's theme.muten; reset/base lives in the project's
// stylesheet. Consumed by resolveToken, validate, and the linter.

import type { Theme, ThemeScale, ThemeRaw, ThemeAdapter, FamilyFn } from '#engine/shared/types.js';

// Fixed keyword -> CSS maps: token semantics, not theme-configurable values. Map (not Record)
// for clean .get()/.has() without index-signature holes.
const JUSTIFY = new Map<string, string>([
  ['start', 'flex-start'], ['center', 'center'], ['end', 'flex-end'],
  ['between', 'space-between'], ['around', 'space-around'], ['evenly', 'space-evenly'],
]);
const ITEMS = new Map<string, string>([
  ['start', 'flex-start'], ['center', 'center'], ['end', 'flex-end'],
  ['stretch', 'stretch'], ['baseline', 'baseline'],
]);
const ATOMS = new Map<string, string>([
  ['row', 'display:flex;flex-direction:row'], ['column', 'display:flex;flex-direction:column'],
  ['wrap', 'flex-wrap:wrap'], ['grid', 'display:grid'], ['grow', 'flex:1'],
  ['center', 'align-items:center'], ['between', 'justify-content:space-between'],
  ['bold', 'font-weight:700'], ['italic', 'font-style:italic'],
]); // tokens with NO modifier (common layout keywords)

// Named scale step (from the project's theme table) or a literal number -> px.
const len = (m: string, table: ThemeScale): string | null => table[m] ?? (/^\d+$/.test(m) ? m + 'px' : null);
const axis = (m: string, prop: string, sp: ThemeScale): string | null => {
  if (m.startsWith('x.')) { const v = len(m.slice(2), sp); return v ? `${prop}-left:${v};${prop}-right:${v}` : null; }
  if (m.startsWith('y.')) { const v = len(m.slice(2), sp); return v ? `${prop}-top:${v};${prop}-bottom:${v}` : null; }
  const v = len(m, sp); return v ? `${prop}:${v}` : null;
};

// family -> (modifier, theme) -> css | null. Keys are the accepted vocabulary (source of truth).
const FAMILIES: { [family: string]: FamilyFn } = {
  gap:     (m, t) => { const v = len(m, t.space); return v ? `gap:${v}` : null; },
  padding: (m, t) => axis(m, 'padding', t.space),
  margin:  (m, t) => axis(m, 'margin', t.space),
  cols:    (m)    => m === 'auto' ? 'grid-template-columns:repeat(auto-fill,minmax(160px,1fr))' : (/^\d+$/.test(m) ? `grid-template-columns:repeat(${m},1fr)` : null),
  rows:    (m)    => /^\d+$/.test(m) ? `grid-template-rows:repeat(${m},1fr)` : null,
  text:    (m, t) => { const v = len(m, t.font); return v ? `font-size:${v}` : null; },
  weight:  (m, t) => { const v = t.weight[m] ?? (/^\d+$/.test(m) ? m : null); return v ? `font-weight:${v}` : null; },
  leading: (m, t) => { const v = t.leading[m] ?? (/^[\d.]+$/.test(m) ? m : null); return v ? `line-height:${v}` : null; },
  align:   (m)    => ['left', 'center', 'right', 'justify'].includes(m) ? `text-align:${m}` : null,
  justify: (m)    => { const v = JUSTIFY.get(m); return v ? `justify-content:${v}` : null; },
  items:   (m)    => { const v = ITEMS.get(m); return v ? `align-items:${v}` : null; },
  width:   (m) => m === 'full' ? 'width:100%' : (/^\d+$/.test(m) ? `width:${m}px` : null),   // full or literal px, not the spacing scale
  height:  (m) => m === 'full' ? 'height:100%' : (/^\d+$/.test(m) ? `height:${m}px` : null),
};

// Source of truth for strict validation and autocomplete.
export const FAMILY_NAMES = Object.keys(FAMILIES);
export const ATOM_NAMES = [...ATOMS.keys()];
export const BREAKPOINT_NAMES = ['sm', 'md', 'lg', 'xl']; // accepted prefixes; px values live in the theme

// The engine ships no values: empty scales the project fills. No reset here — that lives in the
// project's stylesheet (CSS belongs with CSS, not in a Muten string).
export const defaultTheme: Theme = { space: {}, font: {}, weight: {}, leading: {}, breakpoints: {} };

// Merge a project theme over the empty defaults, per scale.
export function mergeTheme(theme: { [scale: string]: ThemeScale } = {}): Theme {
  return {
    space:       { ...(theme.space || {}) },
    font:        { ...(theme.font || {}) },
    weight:      { ...(theme.weight || {}) },
    leading:     { ...(theme.leading || {}) },
    breakpoints: { ...(theme.breakpoints || {}) },
  };
}

// ── theme.muten -> CSS, AGNOSTICALLY. The core knows NO styling library ──────────────────────────
// theme.muten holds the VALUES (agnostic). By default the engine emits them as plain CSS custom
// properties on :root — universal, any CSS setup consumes them; the engine has zero per-library code.
// A muten styling PLUGIN may pass an `adapter` (pure data) to render a library's own format (the plugin
// supplies the wrapper block); the engine ships none and never expects a specific library.
const GENERIC_PREFIX: { [section: string]: string } = {
  colors: '--color-', space: '--space-', radius: '--radius-', font: '--font-',
  weight: '--weight-', leading: '--leading-', breakpoints: '--breakpoint-', size: '--size-',
};
const META_SECTIONS = new Set(['scheme', 'target']); // config, not CSS vars

export function emitTheme(theme: ThemeRaw = {}, adapter?: ThemeAdapter): string {
  if (adapter) { // a plugin's library-specific format: walk its blocks, map values × prefix (still no library name here)
    const out: string[] = [];
    for (const block of adapter.blocks) {
      const lines: string[] = [];
      for (const [k, v] of Object.entries(block.attrs || {})) lines.push(`  ${k}: ${v === '$scheme' ? (theme.scheme?.mode ?? 'light') : v};`);
      for (const section of block.sections) {
        const prefix = adapter.prefix[section] ?? `--${section}-`;
        for (const [key, val] of Object.entries(theme[section] || {})) lines.push(`  ${prefix}${key}: ${val};`);
      }
      if (lines.length) out.push(`${block.open}\n${lines.join('\n')}\n${block.close}`);
    }
    return out.length ? out.join('\n\n') + '\n' : '';
  }
  // default: plain CSS custom properties, library-neutral.
  const lines = Object.entries(theme).filter(([s]) => !META_SECTIONS.has(s))
    .flatMap(([s, scale]) => Object.entries(scale).map(([k, v]) => `  ${GENERIC_PREFIX[s] ?? `--${s}-`}${k}: ${v};`));
  return lines.length ? `:root {\n${lines.join('\n')}\n}\n` : '';
}

// Token -> CSS declarations using the project's theme, or null if the token is invalid/unresolved.
export function resolveToken(t: string, theme: Theme = defaultTheme): string | null {
  const c = t.indexOf(':');
  if (c > 0 && theme.breakpoints[t.slice(0, c)]) return resolveToken(t.slice(c + 1), theme); // recurse without the breakpoint prefix
  const atom = ATOMS.get(t);
  if (atom) return atom;
  const d = t.indexOf('.');
  if (d < 0) return null;
  const fam = FAMILIES[t.slice(0, d)];
  return fam ? (fam(t.slice(d + 1), theme) || null) : null;
}

// Is the token's shape in the accepted vocabulary? (family/atom known, independent of theme values)
export function isKnownTokenShape(t: string): boolean {
  const c = t.indexOf(':');
  const base = c > 0 && BREAKPOINT_NAMES.includes(t.slice(0, c)) ? t.slice(c + 1) : t;
  if (ATOMS.has(base)) return true;
  const d = base.indexOf('.');
  return d > 0 && FAMILY_NAMES.includes(base.slice(0, d));
}

// Token -> CSS class name: padding.x.md -> t-padding-x-md, md:cols.3 -> t-md-cols-3
export const tokenClass = (t: string): string => 't-' + t.replace(/[.:]/g, '-');

// Curated list for autocomplete and highlight (validation accepts the full open set via the vocabulary).
export const SUGGESTED = [
  'row', 'column', 'wrap', 'grid', 'grow', 'center', 'between', 'bold', 'italic',
  'gap.sm', 'gap.md', 'gap.lg', 'padding.md', 'padding.lg', 'padding.x.md', 'padding.y.md', 'margin.md',
  'cols.2', 'cols.3', 'cols.auto', 'rows.2',
  'text.sm', 'text.md', 'text.lg', 'text.xl', 'weight.medium', 'weight.bold', 'leading.normal',
  'align.left', 'align.center', 'align.right', 'justify.center', 'justify.between', 'items.center', 'items.start',
  'width.full', 'height.full',
  'md:row', 'md:cols.2', 'md:cols.3', 'lg:cols.4', // responsive: any token can be prefixed with sm:/md:/lg:/xl:
];
