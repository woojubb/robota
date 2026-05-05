import type { IAgentContainerBlockProps, IResolvedAgentContainerBlockProps } from './types';

export function resolveAgentContainerProps(
  props: IAgentContainerBlockProps,
): IResolvedAgentContainerBlockProps {
  return {
    ...props,
    className: props.className ?? '',
    draggable: props.draggable ?? false,
    isActive: props.isActive ?? false,
    isExecuting: props.isExecuting ?? false,
    isLeader: props.isLeader ?? false,
    priority: props.priority ?? 0,
    teamRole: props.teamRole ?? 'assistant',
  };
}
