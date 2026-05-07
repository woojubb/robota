import type { IErrorInfo } from '../code-executor-types';

const ENV_VAR_PATTERN = /process\.env\.(\w+)/g;

export function checkEnvironmentUsage(code: string, warnings: IErrorInfo[]): void {
  extractEnvVars(code).forEach((envVar) => {
    warnings.push({
      type: 'configuration',
      severity: 'info',
      message: `Environment variable ${envVar} is used`,
      suggestions: [
        `Set ${envVar} in your environment`,
        'Create .env file with your API keys',
        'Check environment variable configuration',
      ],
    });
  });
}

function extractEnvVars(code: string): string[] {
  const envVars: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ENV_VAR_PATTERN.exec(code)) !== null) {
    envVars.push(match[1]);
  }

  return envVars;
}
