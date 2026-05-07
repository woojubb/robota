import { GitBranch } from 'lucide-react';

import { Card } from '../../ui/card';

export function EmptyExecutionTree() {
  return (
    <Card className="p-8">
      <div className="text-center space-y-2">
        <GitBranch className="w-12 h-12 mx-auto text-gray-400" />
        <h3 className="text-lg font-medium text-gray-500">No Executions</h3>
        <p className="text-sm text-gray-400">
          Real-time execution blocks will appear here as tools run
        </p>
      </div>
    </Card>
  );
}
