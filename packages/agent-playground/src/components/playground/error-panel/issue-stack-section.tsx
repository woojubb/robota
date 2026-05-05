import { Bug } from 'lucide-react';

import { Button } from '../../ui/button';
import { CopyButtonIcon } from './copy-button-icon';

interface IIssueStackSectionProps {
  stack: string;
  copyId: string;
  copiedText: string | null;
  onCopy: (text: string, id: string) => void;
}

export function IssueStackSection({ stack, copyId, copiedText, onCopy }: IIssueStackSectionProps) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
        <Bug className="w-4 h-4" />
        <span>Stack Trace</span>
      </h4>
      <div className="bg-muted p-3 rounded-lg relative max-h-32 overflow-y-auto">
        <pre className="text-xs font-mono">
          <code>{stack}</code>
        </pre>
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-2 right-2 h-6 w-6 p-0"
          onClick={() => onCopy(stack, copyId)}
        >
          <CopyButtonIcon isCopied={copiedText === copyId} className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
