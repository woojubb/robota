import { Card } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import { AgentContainerDetails } from './agent-container-details';
import { AgentContainerHeader } from './agent-container-header';
import type { IAgentContainerState } from './agent-container-state';
import {
  getAgentContainerDetailsProps,
  getAgentContainerHeaderProps,
} from './agent-container-shell-props';
import { getAgentCardClassName } from './card-class-name';
import type { IResolvedAgentContainerBlockProps } from './types';

export interface IAgentContainerShellProps {
  block: IResolvedAgentContainerBlockProps;
  state: IAgentContainerState;
}

export function AgentContainerShell({ block, state }: IAgentContainerShellProps) {
  return (
    <Card
      className={getAgentCardClassName(block)}
      draggable={block.draggable}
      onDragStart={block.onDragStart}
      onDragOver={block.onDragOver}
      onDrop={block.onDrop}
    >
      <Collapsible open={state.isExpanded} onOpenChange={state.onExpandedChange}>
        <CollapsibleTrigger asChild>
          <AgentContainerHeader {...getAgentContainerHeaderProps(block, state)} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <AgentContainerDetails {...getAgentContainerDetailsProps(block, state)} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
