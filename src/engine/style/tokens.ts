// theme emission: turns theme.muten's VALUES into CSS, AGNOSTICALLY. The core knows NO styling library.
// Styling itself is `class()` (Tailwind utilities, or your own CSS in styles.css). This module only emits the
// theme values as :root CSS custom properties (the default) or, via a plugin adapter, a library's own format.

import type { ThemeRaw, ThemeAdapter } from '#engine/shared/types.js';

// ── theme.muten -> CSS, AGNOSTICALLY ──────────────────────────────────────────────────────────────
// theme.muten holds the VALUES (agnostic). By default the engine emits them as plain CSS custom
// properties on :root — universal, any CSS setup (your styles.css / Tailwind) consumes them via var(--…).
// A muten styling PLUGIN may pass an `adapter` (pure data) to render a library's own format; the engine
// ships none and never expects a specific library.
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
