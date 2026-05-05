import { cn } from '../../../lib/utils';

export interface IAgentCardClassNameOptions {
  isActive: boolean;
  isExecuting: boolean;
  isLeader: boolean;
  draggable: boolean;
  className: string;
}

export function getAgentCardClassName(options: IAgentCardClassNameOptions): string {
  return cn(
    'relative transition-all duration-200 border',
    options.isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300',
    options.isExecuting && 'bg-green-50 border-green-300',
    options.isLeader && 'border-yellow-400 bg-yellow-50',
    options.draggable && 'cursor-move',
    options.className,
  );
}
