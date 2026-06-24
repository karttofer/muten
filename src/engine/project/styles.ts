// styles: resolves the per-page stylesheet colocated with its .muten file.
// Convention: same name, different extension (home.muten -> home.css or home.scss).
// Injected after the engine's token CSS so it wins via the cascade.
// .scss requires the optional `sass` package; .css is zero-dependency. Consumed by load.ts.

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { ResolvedStyles } from '#engine/shared/types.js';

export async function resolveStyles(screenPath: string): Promise<ResolvedStyles> {
  const scss = screenPath.replace(/\.muten$/, '.scss');
  const css = screenPath.replace(/\.muten$/, '.css');

  if (existsSync(scss)) {
    const sass = await import('sass').catch(() => {
      throw new Error(`To compile ${basename(scss)} install sass:  npm i -D sass`);
    });
    return { css: sass.compile(scss).css, from: basename(scss) };
  }
  if (existsSync(css)) return { css: readFileSync(css, 'utf8'), from: basename(css) };
  return { css: '', from: null };
}
