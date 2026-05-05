import type { IErrorInfo } from '../code-executor-types';
import type { IAnalyzeCodeResult } from './types';

const REQUIRED_PROVIDER_ENV_VARS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_API_KEY'],
};

export function validateEnvironment(provider: string): IAnalyzeCodeResult {
  const errors: IErrorInfo[] = [];
  const warnings: IErrorInfo[] = [];

  const requiredVars = REQUIRED_PROVIDER_ENV_VARS[provider] ?? [];
  requiredVars.forEach((envVar) => {
    warnings.push({
      type: 'configuration',
      severity: 'warning',
      message: `${envVar} should be set in environment`,
      suggestions: [
        `Add ${envVar}=your_key_here to .env file`,
        'Check API key configuration',
        'Verify environment variables are loaded',
      ],
      documentation: `https://robota.dev/docs/providers/${provider}`,
    });
  });

  return { errors, warnings };
}
