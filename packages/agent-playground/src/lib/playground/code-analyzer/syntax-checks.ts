import type { IErrorInfo } from '../code-executor-types';

const MAX_SYNTAX_WARNINGS = 3;

export function checkSyntax(
  code: string,
  lines: string[],
  errors: IErrorInfo[],
  warnings: IErrorInfo[],
): void {
  checkInvalidImportSyntax(code, lines, errors);
  checkBracketBalance(code, errors);
  checkMissingSemicolons(lines, warnings);
}

function checkInvalidImportSyntax(code: string, lines: string[], errors: IErrorInfo[]): void {
  if (!code.includes('import') || code.includes('from')) {
    return;
  }

  const importLine = lines.findIndex((line) => line.includes('import') && !line.includes('from'));
  if (importLine === -1) {
    return;
  }

  errors.push({
    type: 'syntax',
    severity: 'error',
    message: 'Invalid import statement syntax',
    line: importLine + 1,
    code: lines[importLine],
    suggestions: [
      "Use: import { Agent } from '@robota/agents'",
      'Check import statement format',
      'Ensure proper module path',
    ],
    documentation: 'https://robota.dev/docs/getting-started',
  });
}

function checkBracketBalance(code: string, errors: IErrorInfo[]): void {
  const openBrackets = (code.match(/\{/g) ?? []).length;
  const closeBrackets = (code.match(/\}/g) ?? []).length;
  if (openBrackets === closeBrackets) {
    return;
  }

  errors.push({
    type: 'syntax',
    severity: 'error',
    message: 'Mismatched brackets - missing closing bracket',
    suggestions: [
      'Check for missing } brackets',
      'Ensure proper code block structure',
      'Use an IDE with bracket matching',
    ],
  });
}

function checkMissingSemicolons(lines: string[], warnings: IErrorInfo[]): void {
  const missingSemicolonLines = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => isPotentialSemicolonStatement(line));

  missingSemicolonLines.slice(0, MAX_SYNTAX_WARNINGS).forEach(({ line, index }) => {
    warnings.push({
      type: 'syntax',
      severity: 'warning',
      message: 'Missing semicolon',
      line: index + 1,
      code: line,
      suggestions: ['Add semicolon at the end of the statement'],
    });
  });
}

function isPotentialSemicolonStatement(line: string): boolean {
  return (
    line.length > 0 &&
    !line.endsWith(';') &&
    !line.endsWith('{') &&
    !line.endsWith('}') &&
    !line.startsWith('//') &&
    !line.startsWith('import') &&
    !line.startsWith('export') &&
    line.includes('=')
  );
}
