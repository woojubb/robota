import type { IErrorInfo } from '../code-executor-types';

export function checkAgentConfig(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]): void {
  if (!hasRobotaInstance(code)) {
    addMissingRobotaInstanceError(errors);
    return;
  }

  checkRequiredConfigKeys(code, errors);
  checkRecommendedConfigKeys(code, warnings);
}

function hasRobotaInstance(code: string): boolean {
  return code.includes('new Robota(');
}

function addMissingRobotaInstanceError(errors: IErrorInfo[]): void {
  errors.push({
    type: 'configuration',
    severity: 'error',
    message: 'No Robota instance found',
    suggestions: [
      'Create agent: const robota = new Robota({ name: "MyAgent", aiProviders: [...], defaultModel: {...} })',
      'Check Robota configuration syntax',
    ],
    documentation: 'https://robota.dev/docs/agents/configuration',
  });
}

function checkRequiredConfigKeys(code: string, errors: IErrorInfo[]): void {
  if (!code.includes('aiProviders:')) {
    errors.push({
      type: 'configuration',
      severity: 'error',
      message: 'Missing aiProviders configuration',
      suggestions: [
        'Add aiProviders to Robota config',
        'Example: aiProviders: [new OpenAIProvider({ apiKey: "your-api-key" })]',
      ],
    });
  }

  if (!code.includes('defaultModel:')) {
    errors.push({
      type: 'configuration',
      severity: 'error',
      message: 'Missing defaultModel configuration',
      suggestions: [
        'Add defaultModel to Robota config',
        'Example: defaultModel: { provider: "openai", model: "gpt-3.5-turbo" }',
      ],
    });
  }
}

function checkRecommendedConfigKeys(code: string, warnings: IErrorInfo[]): void {
  if (!code.includes('name:')) {
    warnings.push({
      type: 'configuration',
      severity: 'warning',
      message: 'Missing agent name',
      suggestions: ['Add name to Robota config', 'Example: name: "MyAgent"'],
    });
  }

  if (!code.includes('destroy()') && !code.includes('await robota.destroy()')) {
    warnings.push({
      type: 'configuration',
      severity: 'warning',
      message: 'Missing cleanup call',
      suggestions: [
        'Add cleanup: await robota.destroy()',
        'Call destroy() to properly clean up resources',
      ],
    });
  }
}
