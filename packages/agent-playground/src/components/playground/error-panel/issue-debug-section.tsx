import { Button } from '../../ui/button';
import { CopyButtonIcon } from './copy-button-icon';

interface IIssueDebugSectionProps {
  debugInfo: string;
  copyId: string;
  copiedText: string | null;
  onCopy: (text: string, id: string) => void;
}

export function IssueDebugSection({
  debugInfo,
  copyId,
  copiedText,
  onCopy,
}: IIssueDebugSectionProps) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">Debug Information</h4>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onCopy(debugInfo, copyId)}
        className="flex items-center space-x-2"
      >
        <CopyButtonIcon isCopied={copiedText === copyId} className="w-4 h-4" />
        <span>Copy Debug Info</span>
      </Button>
    </div>
  );
}
