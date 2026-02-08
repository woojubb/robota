import type { IOwnerPathSegment } from '@robota-sdk/agents';

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

export function extractPathInfo(ownerPath: IOwnerPathSegment[], contextLabel: string): IPathInfo {
    if (!Array.isArray(ownerPath) || ownerPath.length === 0) {
        throw new Error(`[PATH-ONLY] Missing context.ownerPath for ${contextLabel}`);
    }
    const segments: string[] = [];
    for (const seg of ownerPath) {
        const id = seg?.id;
        if (typeof id !== 'string' || id.length === 0) {
            throw new Error(`[PATH-ONLY] Invalid context.ownerPath (missing segment id) for ${contextLabel}`);
        }
        segments.push(id);
    }
    const nodeId = segments[segments.length - 1];
    const parentId = segments.length > 1 ? segments[segments.length - 2] : undefined;
    const rootId = segments[0];
    return { segments, nodeId, parentId, rootId };
}

