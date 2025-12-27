/**
 * Shared path information extracted from explicit `context.ownerPath`.
 *
 * IMPORTANT:
 * - Path-only linking: relationships must be derived from explicit fields only.
 * - This type is shared across workflow handlers to enforce SSOT.
 */
export interface IPathInfo {
    segments: string[];
    nodeId: string;
    parentId?: string;
    rootId?: string;
}


