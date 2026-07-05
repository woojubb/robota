/**
 * Workspace layout (FLOW-007).
 *
 * A configurable, injectable description of where a dag/workflows product keeps its on-disk state.
 * The workspace folder name and workflow-file extension are a **per-product option**, not a hardcoded
 * constant — the composition root of each product (the dag-cli assembly, the `/workflows` command
 * factory, …) injects an `IWorkspaceLayout`, and the shared persistence/runtime machinery consumes it.
 *
 * Pure data (no `fs`/`path` dependency); path computation belongs to the runtime layer that consumes
 * this — dag-core stays platform-agnostic.
 */
export interface IWorkspaceLayout {
  /** Workspace root directory, relative to the project dir (e.g. `.workflows`). */
  readonly root: string;
  /** Workflow-definition file extension (e.g. `.json`). Definitions live flat under `root`. */
  readonly workflowExt: string;
}

/** Default layout: a `.workflows/` workspace with flat `.json` workflow definitions. */
export const DEFAULT_WORKSPACE_LAYOUT: IWorkspaceLayout = {
  root: '.workflows',
  workflowExt: '.json',
};
