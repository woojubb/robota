import { GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import type { IDebugTreeNode } from './types';

interface ITreeDebugCardProps {
  debugTree: IDebugTreeNode[];
}

export function TreeDebugCard({ debugTree }: ITreeDebugCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center space-x-2">
          <GitBranch className="w-4 h-4" />
          <span>Hierarchical Tree</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
          {debugTree.length === 0 ? (
            <TreeEmptyState />
          ) : (
            <pre className="text-xs font-mono bg-gray-50 p-3 rounded border overflow-auto">
              {JSON.stringify(debugTree, null, 2)}
            </pre>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function TreeEmptyState() {
  return (
    <div className="text-center py-8 text-gray-500">
      <GitBranch className="w-8 h-8 mx-auto mb-2 text-gray-400" />
      <p>No execution blocks yet</p>
      <p className="text-xs text-gray-400 mt-1">Run some tools to see the tree structure</p>
    </div>
  );
}
