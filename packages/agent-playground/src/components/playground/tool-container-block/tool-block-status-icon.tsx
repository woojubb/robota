import { AlertCircle, CheckCircle, Info } from 'lucide-react';

interface IToolBlockStatusIconProps {
  hasErrors: boolean;
  isEnabled: boolean;
}

export function ToolBlockStatusIcon({ hasErrors, isEnabled }: IToolBlockStatusIconProps) {
  if (hasErrors) return <AlertCircle className="h-3 w-3 text-red-500" />;
  if (isEnabled) return <CheckCircle className="h-3 w-3 text-green-500" />;
  return <Info className="h-3 w-3 text-gray-400" />;
}
