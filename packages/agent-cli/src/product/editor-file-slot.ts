import type { IEditorFileAccess } from '@robota-sdk/agent-tools';

/**
 * Where the session's file tools find an editor's file access. The tools are built at startup, while
 * an editor that offers its file system connects later and can go away, so they ask at each call.
 */
export interface IEditorFileSlot {
  readonly current: () => IEditorFileAccess | undefined;
  readonly set: (access: IEditorFileAccess | undefined) => void;
}

export function createEditorFileSlot(): IEditorFileSlot {
  let access: IEditorFileAccess | undefined;
  return {
    current: () => access,
    set: (next) => {
      access = next;
    },
  };
}
