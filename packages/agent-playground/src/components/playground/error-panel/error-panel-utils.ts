import type { IErrorPanelIssue, TErrorPanelSeverity } from './types';

const SEVERITY_ORDER: Record<TErrorPanelSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

const COMMON_FIXES: Record<IErrorPanelIssue['type'], string[]> = {
  syntax: [
    'Check for missing semicolons or brackets',
    'Verify proper string quotation marks',
    'Ensure proper function syntax',
    'Check for typos in variable names',
  ],
  import: [
    'Verify package is installed: npm install @robota/agents',
    'Check import statement syntax',
    'Ensure module exists and is exported',
    'Check for typos in module names',
  ],
  api: [
    'Verify API key is set in environment variables',
    'Check network connectivity',
    'Verify API endpoint is correct',
    'Check rate limits and quotas',
  ],
  configuration: [
    'Check environment variables are set',
    'Verify configuration object syntax',
    'Ensure required fields are provided',
    'Check configuration values are valid',
  ],
  runtime: [
    'Check for null or undefined values',
    'Verify async/await usage',
    'Check function parameters',
    'Look for type mismatches',
  ],
};

export function sortIssuesBySeverity(issues: IErrorPanelIssue[]): IErrorPanelIssue[] {
  return [...issues].sort((left, right) => {
    return SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity];
  });
}

export function getCommonFixes(error: IErrorPanelIssue): string[] {
  return COMMON_FIXES[error.type];
}

export function buildIssueLocation(error: IErrorPanelIssue): string {
  if (!error.line) return 'Unknown';
  return `Line ${error.line}${error.column ? `, Column ${error.column}` : ''}`;
}

export function generateDebugInfo(error: IErrorPanelIssue): string {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    error: {
      type: error.type,
      severity: error.severity,
      message: error.message,
      location: buildIssueLocation(error),
      stack: error.stack,
    },
  };

  return JSON.stringify(debugInfo, null, 2);
}
