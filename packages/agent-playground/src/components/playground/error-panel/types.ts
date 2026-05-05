export type TErrorPanelIssueType = 'syntax' | 'runtime' | 'api' | 'configuration' | 'import';
export type TErrorPanelSeverity = 'error' | 'warning' | 'info';

export interface IErrorPanelIssue {
  type: TErrorPanelIssueType;
  severity: TErrorPanelSeverity;
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  code?: string;
  suggestions?: string[];
  documentation?: string;
}

export interface IErrorPanelProps {
  errors: IErrorPanelIssue[];
  warnings: IErrorPanelIssue[];
  onFixSuggestion?: (fix: string) => void;
}
