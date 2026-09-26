import { PROVIDER_PACKAGES, toPackageName } from '../../provider-packages';
import type { IErrorInfo } from '../code-executor-types';

const PLUGIN_NAMES = ['LoggingPlugin', 'UsagePlugin', 'PerformancePlugin'];

export function checkImports(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]): void {
  checkRobotaImport(code, errors);
  checkOpenAiClientImport(code, errors);
  checkProviderImport(code, 'OpenAIProvider', PROVIDER_PACKAGES.openai, errors);
  checkProviderImport(code, 'AnthropicProvider', PROVIDER_PACKAGES.anthropic, errors);
  checkProviderImport(code, 'GoogleProvider', PROVIDER_PACKAGES.google, errors);
  checkCoreUtilityImports(code, warnings);
}

function checkRobotaImport(code: string, errors: IErrorInfo[]): void {
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
}

function checkOpenAiClientImport(code: string, errors: IErrorInfo[]): void {
  if (code.includes('new OpenAI(') && !code.includes("import OpenAI from 'openai'")) {
    errors.push({
      type: 'import',
      severity: 'error',
      message: 'Missing OpenAI client import',
      suggestions: ["Add: import OpenAI from 'openai'", 'Install package: npm install openai'],
    });
  }
}

function checkProviderImport(
  code: string,
  providerName: string,
  importPath: string,
  errors: IErrorInfo[],
): void {
  if (code.includes(providerName) && !code.includes(`from '${importPath}'`)) {
    errors.push({
      type: 'import',
      severity: 'error',
      message: `Missing ${providerName} import`,
      suggestions: [
        `Add: import { ${providerName} } from '${importPath}'`,
        `Install package: npm install ${toPackageName(importPath)}`,
      ],
    });
  }
}

function checkCoreUtilityImports(code: string, warnings: IErrorInfo[]): void {
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

  PLUGIN_NAMES.forEach((pluginName) => {
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
