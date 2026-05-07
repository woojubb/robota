import { Zap } from 'lucide-react';

interface IToolContainerEmptyStateProps {
  isEditable: boolean;
}

export function ToolContainerEmptyState({ isEditable }: IToolContainerEmptyStateProps) {
  return (
    <div className="text-center py-6 text-xs text-gray-500">
      <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p>No tools configured</p>
      {isEditable && <p className="mt-1">Click "Add Tool" to get started</p>}
    </div>
  );
}
