'use client';

import { AgentContainerShell } from './agent-container-shell';
import { resolveAgentContainerProps } from './resolve-agent-container-props';
import type { IAgentContainerBlockProps } from './types';
import { useAgentContainerState } from './use-agent-container-state';

export function AgentContainerBlock(props: IAgentContainerBlockProps) {
  const block = resolveAgentContainerProps(props);
  const state = useAgentContainerState(block.teamRole);

  return <AgentContainerShell block={block} state={state} />;
}
