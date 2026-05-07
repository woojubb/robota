import { CardContent } from '../../ui/card';
import { getCommonFixes, generateDebugInfo } from './error-panel-utils';
import { IssueCodeSection } from './issue-code-section';
import { IssueDebugSection } from './issue-debug-section';
import { IssueDocumentationLink } from './issue-documentation-link';
import { IssueStackSection } from './issue-stack-section';
import { IssueSuggestionsSection } from './issue-suggestions-section';
import type { IErrorPanelIssue } from './types';

interface IIssueDetailsProps {
  issue: IErrorPanelIssue;
  issueIndex: number;
  copiedText: string | null;
  onCopy: (text: string, id: string) => void;
  onFixSuggestion?: (fix: string) => void;
}

export function IssueDetails({
  issue,
  issueIndex,
  copiedText,
  onCopy,
  onFixSuggestion,
}: IIssueDetailsProps) {
  const suggestions = issue.suggestions || getCommonFixes(issue);

  return (
    <CardContent className="pt-0 space-y-4">
      {issue.code && (
        <IssueCodeSection
          code={issue.code}
          copyId={`code-${issueIndex}`}
          copiedText={copiedText}
          onCopy={onCopy}
        />
      )}
      {issue.stack && (
        <IssueStackSection
          stack={issue.stack}
          copyId={`stack-${issueIndex}`}
          copiedText={copiedText}
          onCopy={onCopy}
        />
      )}
      <IssueSuggestionsSection suggestions={suggestions} onFixSuggestion={onFixSuggestion} />
      {issue.documentation && <IssueDocumentationLink documentation={issue.documentation} />}
      <IssueDebugSection
        debugInfo={generateDebugInfo(issue)}
        copyId={`debug-${issueIndex}`}
        copiedText={copiedText}
        onCopy={onCopy}
      />
    </CardContent>
  );
}
