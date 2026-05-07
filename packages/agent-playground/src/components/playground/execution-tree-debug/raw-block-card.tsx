import { Badge } from '../../ui/badge';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';
import { createRawBlockDebugData, getRawBlockBadgeVariant } from './execution-tree-debug-data';

interface IRawBlockCardProps {
  block: IRealTimeBlockMessage;
  index: number;
}

export function RawBlockCard({ block, index }: IRawBlockCardProps) {
  const metadata = block.blockMetadata;

  return (
    <div className="border rounded p-2 text-xs">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className="text-xs">
          #{index + 1}
        </Badge>
        <Badge variant={getRawBlockBadgeVariant(metadata.visualState)} className="text-xs">
          {metadata.visualState}
        </Badge>
      </div>
      <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">
        {JSON.stringify(createRawBlockDebugData(block), null, 2)}
      </pre>
    </div>
  );
}
