// Public API — the programmatic surface of the framework.
//
//   import { buildApp } from 'muten'                        // compile an app folder to static HTML
//   import { compile, parse, validate } from 'muten'        // drive the compiler directly (embedding)
//
// Everything under #engine is internal and may change between versions; depend on these exports.

export { buildApp } from './build.js';
export { lintApp } from './lint.js';

// the pure compiler pipeline (advanced / embedding use)
export { parse } from '#engine/lang/parse.js';
export { toDoc } from '#engine/ir/flatten.js';
export { validate } from '#engine/ir/validate.js';
export { compile } from '#engine/compile/compile.js';
export { load, loadAllParts } from '#engine/project/load.js';
