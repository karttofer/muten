// Flatten: NESTED tree (authoring) -> FLAT IR addressable by ID.
//
// This materializes the design:
//   - author nested (locality, no symbol table)
//   - the system assigns IDs, deterministic, in pre-order (n1, n2, ...)
//   - mutations happen on the flat IR by ID (step 2), and it compiles
//
// IDs via a pre-order counter: stable as long as structural order doesn't change.
// (Migrate to path-based IDs later for stability under reorderings.)

import type { IR, IRNode, FlatNode, Doc } from '#engine/shared/types.js';

function flatten(tree: IRNode): { rootId: string; nodes: { [id: string]: FlatNode } } { // internal: only toDoc calls it
  const nodes: { [id: string]: FlatNode } = {};
  let counter = 0;

  const visit = (node: IRNode): string => {
    const id = 'n' + (++counter);
    const entry: FlatNode = { id, type: node.type, props: node.props || {}, children: [] };
    if (node.loc) entry.loc = node.loc;   // position in the .screen (inline diagnostics)
    if (node.args) entry.args = node.args; // unresolved part instance (live-lint without compose)
    nodes[id] = entry; // insert the parent before its children: the JSON reads top-down
    entry.children = (node.children || []).map(visit);
    return id;
  };

  const rootId = visit(tree);
  return { rootId, nodes };
}

// Canonical flat doc = the only thing that's validated, mutated and compiled.
// (the non-tree parts —screen/entities/state/actions— are already flat)
export function toDoc(ir: IR): Doc {
  const { rootId, nodes } = ir.tree ? flatten(ir.tree) : { rootId: undefined, nodes: {} };
  return { screen: ir.screen, entities: ir.entities, state: ir.state, actions: ir.actions, consts: ir.consts || {}, constraints: ir.constraints || {}, rootId, nodes };
}
