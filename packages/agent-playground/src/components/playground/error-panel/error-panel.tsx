'use client';

import { ScrollArea } from '../../ui/scroll-area';
import { ErrorIssueCard } from './error-issue-card';
import { ErrorPanelEmptyState } from './error-panel-empty-state';
import { ErrorPanelSummary } from './error-panel-summary';
import { sortIssuesBySeverity } from './error-panel-utils';
import type { IErrorPanelProps } from './types';
import { useErrorPanelState } from './use-error-panel-state';

export function ErrorPanel({ errors, warnings, onFixSuggestion }: IErrorPanelProps) {
  const { copiedText, expandedItems, copyToClipboard, toggleExpanded } = useErrorPanelState();
  const allIssues = sortIssuesBySeverity([...errors, ...warnings]);

  if (allIssues.length === 0) {
    return <ErrorPanelEmptyState />;
  }

  return (
    <div className="space-y-4">
      <ErrorPanelSummary errorCount={errors.length} warningCount={warnings.length} />
      <ScrollArea className="max-h-96">
        <div className="space-y-3">
          {allIssues.map((issue, index) => (
            <ErrorIssueCard
              key={index}
              issue={issue}
              issueIndex={index}
              isExpanded={expandedItems.has(index)}
              copiedText={copiedText}
              onCopy={copyToClipboard}
              onToggleExpanded={toggleExpanded}
              onFixSuggestion={onFixSuggestion}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
