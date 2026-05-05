import type { IErrorInfo } from '../code-executor-types';
import type { IAnalyzeCodeResult } from './types';

const MAX_SYNTAX_WARNINGS = 3;

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

function checkSyntax(
  code: string,
  lines: string[],
  errors: IErrorInfo[],
  warnings: IErrorInfo[],
): void {
  if (code.includes('import') && !code.includes('from')) {
    const importLine = lines.findIndex((line) => line.includes('import') && !line.includes('from'));
    if (importLine !== -1) {
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
  }

  const openBrackets = (code.match(/\{/g) ?? []).length;
  const closeBrackets = (code.match(/\}/g) ?? []).length;
  if (openBrackets !== closeBrackets) {
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

  const missingSemicolonLines = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(
      ({ line }) =>
        line.length > 0 &&
        !line.endsWith(';') &&
        !line.endsWith('{') &&
        !line.endsWith('}') &&
        !line.startsWith('//') &&
        !line.startsWith('import') &&
        !line.startsWith('export') &&
        line.includes('='),
    );

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

function checkImports(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]): void {
  if (!code.includes('Robota') && !code.includes("from '@robota-sdk/agent-core'")) {
    errors.push({
      type: 'import',
      severity: 'error',
      message: 'Missing Robota import from @robota-sdk/agent-core',
      line: 1,
      suggestions: [
        "Add: import { Robota } from '@robota-sdk/agent-core'",
        'Install package: npm install @robota-sdk/agent-core',
      ],
      documentation: 'https://robota.dev/docs/agents',
    });
  }

  if (code.includes('new OpenAI(') && !code.includes("import OpenAI from 'openai'")) {
    errors.push({
      type: 'import',
      severity: 'error',
      message: 'Missing OpenAI client import',
      suggestions: ["Add: import OpenAI from 'openai'", 'Install package: npm install openai'],
    });
  }

  checkProviderImport(code, 'OpenAIProvider', '@robota-sdk/agent-provider-openai', errors);
  checkProviderImport(code, 'AnthropicProvider', '@robota-sdk/agent-provider-anthropic', errors);
  checkProviderImport(code, 'GoogleProvider', '@robota-sdk/agent-provider-google', errors);

  if (code.includes('createFunctionTool') && !code.includes("from '@robota-sdk/agent-core'")) {
    warnings.push({
      type: 'import',
      severity: 'warning',
      message: 'createFunctionTool should be imported from @robota-sdk/agent-core',
      suggestions: [
        "Add createFunctionTool to import: import { Robota, createFunctionTool } from '@robota-sdk/agent-core'",
      ],
    });
  }

  const pluginNames = ['LoggingPlugin', 'UsagePlugin', 'PerformancePlugin'];
  pluginNames.forEach((pluginName) => {
    if (code.includes(pluginName) && !code.includes("from '@robota-sdk/agent-core'")) {
      warnings.push({
        type: 'import',
        severity: 'warning',
        message: `${pluginName} should be imported from @robota-sdk/agent-core`,
        suggestions: [
          `Add ${pluginName} to import: import { Robota, ${pluginName} } from '@robota-sdk/agent-core'`,
        ],
      });
    }
  });
}

function checkProviderImport(
  code: string,
  providerName: string,
  packageName: string,
  errors: IErrorInfo[],
): void {
  if (code.includes(providerName) && !code.includes(`from '${packageName}'`)) {
    errors.push({
      type: 'import',
      severity: 'error',
      message: `Missing ${providerName} import`,
      suggestions: [
        `Add: import { ${providerName} } from '${packageName}'`,
        `Install package: npm install ${packageName}`,
      ],
    });
  }
}

function checkAgentConfig(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]): void {
  if (!code.includes('new Robota(')) {
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
    return;
  }

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

function checkEnvironmentUsage(code: string, warnings: IErrorInfo[]): void {
  const envVarPattern = /process\.env\.(\w+)/g;
  const envVars: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = envVarPattern.exec(code)) !== null) {
    envVars.push(match[1]);
  }

  envVars.forEach((envVar) => {
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
