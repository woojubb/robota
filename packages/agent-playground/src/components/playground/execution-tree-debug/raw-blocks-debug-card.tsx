import { Code } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { ScrollArea } from '../../ui/scroll-area';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';
import { RawBlockCard } from './raw-block-card';

interface IRawBlocksDebugCardProps {
  rawBlocks: IRealTimeBlockMessage[];
}

export function RawBlocksDebugCard({ rawBlocks }: IRawBlocksDebugCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center space-x-2">
          <Code className="w-4 h-4" />
          <span>Raw Blocks ({rawBlocks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
          {rawBlocks.length === 0 ? (
            <RawBlocksEmptyState />
          ) : (
            <div className="space-y-3">
              {rawBlocks.map((block, index) => (
                <RawBlockCard key={block.blockMetadata.id} block={block} index={index} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function RawBlocksEmptyState() {
  return (
    <div className="text-center py-8 text-gray-500">
      <Code className="w-8 h-8 mx-auto mb-2 text-gray-400" />
      <p>No blocks collected</p>
    </div>
  );
}
