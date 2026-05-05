import { AlertTriangle } from 'lucide-react';

import { Button } from '../../ui/button';
import { CopyButtonIcon } from './copy-button-icon';

interface IIssueCodeSectionProps {
  code: string;
  copyId: string;
  copiedText: string | null;
  onCopy: (text: string, id: string) => void;
}

export function IssueCodeSection({ code, copyId, copiedText, onCopy }: IIssueCodeSectionProps) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
        <AlertTriangle className="w-4 h-4" />
        <span>Code Context</span>
      </h4>
      <div className="bg-muted p-3 rounded-lg relative">
        <pre className="text-sm font-mono overflow-x-auto">
          <code>{code}</code>
        </pre>
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-2 right-2 h-6 w-6 p-0"
          onClick={() => onCopy(code, copyId)}
        >
          <CopyButtonIcon isCopied={copiedText === copyId} className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
