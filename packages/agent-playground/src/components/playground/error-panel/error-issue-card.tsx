import { Card } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import { SEVERITY_CONFIG } from './error-panel-config';
import { IssueDetails } from './issue-details';
import { IssueHeader } from './issue-header';
import type { IErrorPanelIssue } from './types';

interface IErrorIssueCardProps {
  issue: IErrorPanelIssue;
  issueIndex: number;
  isExpanded: boolean;
  copiedText: string | null;
  onCopy: (text: string, id: string) => void;
  onToggleExpanded: (index: number) => void;
  onFixSuggestion?: (fix: string) => void;
}

export function ErrorIssueCard({
  issue,
  issueIndex,
  isExpanded,
  copiedText,
  onCopy,
  onToggleExpanded,
  onFixSuggestion,
}: IErrorIssueCardProps) {
  return (
    <Card
      className={`${SEVERITY_CONFIG[issue.severity].borderColor} ${
        SEVERITY_CONFIG[issue.severity].bgColor
      }`}
    >
      <Collapsible>
        <CollapsibleTrigger className="w-full" onClick={() => onToggleExpanded(issueIndex)}>
          <IssueHeader issue={issue} isExpanded={isExpanded} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <IssueDetails
            issue={issue}
            issueIndex={issueIndex}
            copiedText={copiedText}
            onCopy={onCopy}
            onFixSuggestion={onFixSuggestion}
          />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
