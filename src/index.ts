// Public API: the programmatic surface of the framework.
// Consumers: host apps via `import { buildApp } from 'muten'`, and embedders
// using the compiler pipeline directly. Everything under #engine is internal
// and may change between versions.

export { buildApp } from './build.js';
export { lintApp } from './lint.js';

// pure compiler pipeline (advanced / embedding use)
export { parse } from '#engine/lang/parse.js';
export { toDoc } from '#engine/ir/flatten.js';
export { validate } from '#engine/ir/validate.js';
export { compile } from '#engine/compile/compile.js';
export { load, loadAllParts } from '#engine/project/load.js';
