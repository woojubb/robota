import { AlertCircle, CheckCircle, Info } from 'lucide-react';

import { Badge } from '../../ui/badge';

interface IAgentStatusIndicatorProps {
  isActive: boolean;
  isExecuting: boolean;
  isValid: boolean;
}

export function AgentStatusIndicator({
  isActive,
  isExecuting,
  isValid,
}: IAgentStatusIndicatorProps) {
  if (isExecuting) {
    return (
      <Badge variant="default" className="text-xs">
        Running
      </Badge>
    );
  }

  if (isActive) {
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  }

  if (!isValid) {
    return <AlertCircle className="h-4 w-4 text-red-500" />;
  }

  return <Info className="h-4 w-4 text-blue-500" />;
}
