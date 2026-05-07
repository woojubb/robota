import { CheckCircle, Info, Play } from 'lucide-react';

export interface IAgentStatusIconProps {
  isActive: boolean;
  isExecuting: boolean;
}

export function AgentStatusIcon({ isActive, isExecuting }: IAgentStatusIconProps) {
  if (isExecuting) {
    return <Play className="h-3 w-3 text-green-500 animate-pulse" />;
  }

  if (isActive) {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }

  return <Info className="h-3 w-3 text-gray-400" />;
}
