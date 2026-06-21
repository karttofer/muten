// Build: every src/**/*.ts → dist/**/*.js, MINIFIED, per-file (the module graph is preserved and the
// #engine/* imports stay intact, so package.json "imports" resolves them — no monolithic bundle that
// would bloat large apps). Type-checking is a separate `tsc` pass (see `npm run build`).
// Run via node's type stripping (it is the build bootstrap, so it can't compile itself): see package.json.
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const collect = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
};

await build({
  entryPoints: collect('src'),
  outdir: 'dist',
  outbase: 'src',
  format: 'esm',
  target: 'es2022',
  bundle: false,   // per-file: keep modules + #engine imports (resolved at runtime by package.json "imports")
  minify: true,
});
console.log('✓ dist/ built (minified, per-file ESM)');
