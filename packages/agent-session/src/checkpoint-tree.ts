/**
 * SELFHOST-007 — neutral checkpoint tree (branching time-travel).
 *
 * A pure, I/O-free branch-tree over opaque checkpoint-node ids — git-for-a-session with no file I/O,
 * no persistence, and no retention/prune policy. It lives beside the storage-neutral persistence
 * primitive (`SessionStore`/`ISessionRecord`): same neutral-mechanism class (opaque payloads, no
 * product policy). The agent-framework checkpoint store consumes it over the existing one-way
 * `agent-framework → agent-session` edge; the reverse edge would be a cycle and is forbidden.
 *
 * Model: each node is `{ id, parentId }` (root has no `parentId`). Adding a checkpoint appends a child
 * of the active head. Forking moves the active head to a PAST node so the next append DIVERGES — the
 * original descendants stay reachable (a sibling branch). A "branch" is a leaf (a node with no
 * children); `switch` moves the active head to any existing node.
 */

export interface ICheckpointNode {
  id: string;
  /** Parent checkpoint id; absent for the root. */
  parentId?: string;
}

export class CheckpointTree {
  private readonly nodes = new Map<string, ICheckpointNode>();
  /** Child adjacency (parentId → child ids in insertion order) for O(1) leaf/branch queries. */
  private readonly children = new Map<string, string[]>();
  private activeId: string | undefined;

  /**
   * Build a tree from explicit `{ id, parentId }` edges (e.g. reconstructed from persisted checkpoint
   * manifests). Nodes may arrive in any order — parents are linked by id. The active head is left at
   * the given `activeId` (or undefined). This is the delegation entry point a consumer store uses to
   * answer navigation queries (`listBranches`/`ancestors`) without the tree owning any persistence.
   */
  static fromNodes(nodes: ICheckpointNode[], activeId?: string): CheckpointTree {
    const tree = new CheckpointTree();
    // First pass: register every node so parent links resolve regardless of arrival order.
    for (const node of nodes) {
      if (tree.nodes.has(node.id)) throw new Error(`CheckpointTree: duplicate node "${node.id}"`);
      tree.nodes.set(node.id, node.parentId === undefined ? { id: node.id } : { ...node });
    }
    // Second pass: build child adjacency in the provided order.
    for (const node of nodes) {
      if (node.parentId !== undefined) {
        const siblings = tree.children.get(node.parentId) ?? [];
        siblings.push(node.id);
        tree.children.set(node.parentId, siblings);
      }
    }
    tree.activeId = activeId;
    return tree;
  }

  /**
   * Append a checkpoint as a child of the current active head and make it the new active head.
   * The first append (no active head) becomes the root. Ids must be unique.
   */
  addCheckpoint(id: string): void {
    if (this.nodes.has(id)) throw new Error(`CheckpointTree: duplicate checkpoint id "${id}"`);
    const parentId = this.activeId;
    this.nodes.set(id, parentId === undefined ? { id } : { id, parentId });
    if (parentId !== undefined) {
      const siblings = this.children.get(parentId) ?? [];
      siblings.push(id);
      this.children.set(parentId, siblings);
    }
    this.activeId = id;
  }

  /**
   * Fork from a PAST checkpoint: move the active head to `fromId` so the next `addCheckpoint` diverges
   * into a sibling branch, leaving `fromId`'s original descendants reachable. Returns `fromId`.
   */
  fork(fromId: string): string {
    if (!this.nodes.has(fromId)) throw new Error(`CheckpointTree: unknown checkpoint "${fromId}"`);
    this.activeId = fromId;
    return fromId;
  }

  /** Move the active head to an existing node (typically a branch leaf). */
  switch(nodeId: string): void {
    if (!this.nodes.has(nodeId)) throw new Error(`CheckpointTree: unknown checkpoint "${nodeId}"`);
    this.activeId = nodeId;
  }

  /** The current active head id (undefined for an empty tree). */
  activeLeaf(): string | undefined {
    return this.activeId;
  }

  /** All branch tips (leaf nodes with no children), in insertion order. */
  listBranches(): string[] {
    const leaves: string[] = [];
    for (const id of this.nodes.keys()) {
      if ((this.children.get(id)?.length ?? 0) === 0) leaves.push(id);
    }
    return leaves;
  }

  /**
   * The chain from `id` up to (and including) the root — nearest first. Empty if `id` is unknown. Only
   * REGISTERED nodes are included: a dangling `parentId` (edge to a node not in the tree — possible on
   * manifest drift/corruption) terminates the walk rather than emitting a phantom id.
   */
  ancestors(id: string): string[] {
    const chain: string[] = [];
    let cursor: string | undefined = id;
    while (cursor !== undefined && this.nodes.has(cursor)) {
      chain.push(cursor);
      cursor = this.nodes.get(cursor)!.parentId;
    }
    return chain;
  }

  /** Whether a checkpoint id exists in the tree. */
  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** The number of checkpoints in the tree. */
  get size(): number {
    return this.nodes.size;
  }
}
