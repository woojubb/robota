import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { CardHeader, CardTitle } from '../../ui/card';
import { ERROR_TYPE_CONFIG, SEVERITY_CONFIG } from './error-panel-config';
import type { IErrorPanelIssue } from './types';

interface IIssueHeaderProps {
  issue: IErrorPanelIssue;
  isExpanded: boolean;
}

export function IssueHeader({ issue, isExpanded }: IIssueHeaderProps) {
  const ErrorIcon = ERROR_TYPE_CONFIG[issue.type].icon;
  const SeverityIcon = SEVERITY_CONFIG[issue.severity].icon;
  const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <CardHeader className="pb-2 hover:bg-muted/50 transition-colors">
      <div className="flex items-start space-x-3">
        <SeverityIcon className={`w-5 h-5 mt-0.5 ${SEVERITY_CONFIG[issue.severity].color}`} />
        <div className="flex-1 text-left">
          <div className="flex items-center space-x-2 mb-1">
            <Badge variant="outline" className="text-xs">
              <ErrorIcon className="w-3 h-3 mr-1" />
              {ERROR_TYPE_CONFIG[issue.type].label}
            </Badge>
            {issue.line && (
              <Badge variant="secondary" className="text-xs">
                Line {issue.line}
              </Badge>
            )}
          </div>
          <CardTitle className="text-sm font-medium">{issue.message}</CardTitle>
        </div>
        <ToggleIcon className="w-4 h-4 text-muted-foreground" />
      </div>
    </CardHeader>
  );
}
