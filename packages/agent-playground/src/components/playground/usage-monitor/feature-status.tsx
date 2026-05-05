import { AlertTriangle, CheckCircle } from 'lucide-react';

export interface IFeatureStatusProps {
  label: string;
  isEnabled: boolean;
  className?: string;
}

export function FeatureStatus({ label, isEnabled, className }: IFeatureStatusProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {isEnabled ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-gray-400" />
      )}
      <span className="text-xs">{label}</span>
    </div>
  );
}
