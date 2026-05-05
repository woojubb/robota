import type { IErrorInfo } from '../code-executor-types';
import { checkAgentConfig } from './configuration-checks';
import { checkEnvironmentUsage } from './environment-usage';
import { checkImports } from './import-checks';
import { checkSyntax } from './syntax-checks';
import type { IAnalyzeCodeResult } from './types';

export function analyzeCode(code: string): IAnalyzeCodeResult {
  const errors: IErrorInfo[] = [];
  const warnings: IErrorInfo[] = [];
  const lines = code.split('\n');

  checkSyntax(code, lines, errors, warnings);
  checkImports(code, errors, warnings);
  checkAgentConfig(code, errors, warnings);
  checkEnvironmentUsage(code, warnings);

  return { errors, warnings };
}
