/**
 * Leaf type module for {@link IAssemblyState}.
 *
 * Split out of `index.ts` so `assembly-serializer.ts` can depend on this type without importing
 * back from `index.ts` (which re-exports `generateAgentCode` from `assembly-serializer.ts`) — that
 * previously created an import cycle between the two.
 */
export interface IAssemblyState {
  agent: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
  tools: string[];
  skills: string[];
  permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  maxTurns?: number;
}
