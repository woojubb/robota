/**
 * Remote Executor Injection for Robota Playground
 *
 * Transforms user code to automatically inject RemoteExecutor
 * for secure server-side execution without exposing actual API keys.
 */

import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundConfig } from './config-validation';
import { addPlaygroundSetup } from './remote-injection-setup';

// Re-export sandbox for external consumers
export { createPlaygroundSandbox } from './remote-injection-sandbox';

export interface IRemoteExecutor {
  readonly name: string;
  readonly version: string;
  executeChat(request: Record<string, TUniversalValue>): Promise<TUniversalValue>;
  executeChatStream?(request: Record<string, TUniversalValue>): AsyncIterable<TUniversalValue>;
  supportsTools(): boolean;
  validateConfig(): boolean;
  dispose?(): Promise<void>;
}

declare global {
  interface Window {
    __ROBOTA_PLAYGROUND_EXECUTOR__?: IRemoteExecutor;
    __ROBOTA_PLAYGROUND_CONFIG__?: IPlaygroundConfig;
  }
}

/**
 * Transform user code to inject RemoteExecutor into all AI providers
 */
export function injectRemoteExecutor(userCode: string, config: IPlaygroundConfig): string {
  let transformedCode = convertImportsToGlobals(userCode);
  transformedCode = removeApiKeyUsage(transformedCode);
  transformedCode = injectExecutorIntoProviders(transformedCode);
  transformedCode = addPlaygroundSetup(transformedCode, config);
  return transformedCode;
}

function convertImportsToGlobals(code: string): string {
  let t = code;

  t = replaceNamedImport(t, '@robota-sdk/agents', 'agents');
  t = t.replace(
    /import\s+OpenAI\s+from\s*['"]openai['"];?\s*/g,
    'const OpenAI = window.__ROBOTA_SDK__?.openai?.OpenAI || class MockOpenAI {};\n'
  );
  t = replaceNamedImport(t, 'openai', 'openai');
  t = replaceNamedImport(t, '@robota-sdk/openai', 'openai');
  t = replaceNamedImport(t, '@robota-sdk/anthropic', 'anthropic');
  t = replaceNamedImport(t, '@robota-sdk/google', 'google');

  t = t.replace(
    /import\s+Anthropic\s+from\s*['"]@anthropic-ai\/sdk['"];?\s*/g,
    'const Anthropic = window.__ROBOTA_SDK__?.anthropic?.Anthropic || class MockAnthropic {};\n'
  );

  t = replaceNamedImport(t, '@google/generative-ai', 'google');

  // Remove remaining imports
  t = t.replace(/import\s+.*?from\s*['"][^'"]*['"];?\s*/g, '// Import removed for playground execution\n');

  // Remove export statements
  t = t.replace(/export\s+default\s+(.+)/g, 'const __DEFAULT_EXPORT__ = $1');
  t = t.replace(/export\s+/g, '// Export removed - ');

  return t;
}

function replaceNamedImport(code: string, moduleName: string, sdkNamespace: string): string {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `import\\s*{\\s*([^}]+)\\s*}\\s*from\\s*['"]${escaped}['"];?\\s*`,
    'g'
  );
  return code.replace(pattern, (_match, imports) => {
    const importList = imports.split(',').map((imp: string) => imp.trim());
    return importList.map((imp: string) => {
      return `const ${imp} = window.__ROBOTA_SDK__?.${sdkNamespace}?.${imp} || class Mock${imp} {};`;
    }).join('\n') + '\n';
  });
}

function removeApiKeyUsage(code: string): string {
  return code
    .replace(/new OpenAI\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g, 'new OpenAI({ apiKey: "playground-mock-key" })')
    .replace(/new Anthropic\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g, 'new Anthropic({ apiKey: "playground-mock-key" })')
    .replace(/process\.env\.[A-Z_]*API_KEY/g, '"playground-mock-key"')
    .replace(/apiKey:\s*['"']sk-[^'"]*['"']/g, 'apiKey: "playground-mock-key"');
}

function injectExecutorIntoProviders(code: string): string {
  let t = code;
  t = injectExecutorIntoProvider(t, 'OpenAIProvider');
  t = injectExecutorIntoProvider(t, 'AnthropicProvider');
  t = injectExecutorIntoProvider(t, 'GoogleProvider');
  return t;
}

function injectExecutorIntoProvider(code: string, providerName: string): string {
  const pattern = new RegExp(`new ${providerName}\\(\\s*({[^}]*})\\s*\\)`, 'g');
  return code.replace(pattern, (match, configObj) => {
    if (configObj.includes('executor:')) return match;
    const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
      '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
    return `new ${providerName}(${newConfig})`;
  });
}

export function generateMockEnvironment(): Record<string, string> {
  return {
    OPENAI_API_KEY: 'playground-mock-openai-key',
    ANTHROPIC_API_KEY: 'playground-mock-anthropic-key',
    GOOGLE_AI_API_KEY: 'playground-mock-google-key',
    NODE_ENV: 'playground'
  };
}

export function requiresTransformation(code: string): boolean {
  return (
    code.includes('new OpenAIProvider') ||
    code.includes('new AnthropicProvider') ||
    code.includes('new GoogleProvider') ||
    code.includes('process.env.') ||
    /apiKey:\s*['"][^'"]*['"]/.test(code)
  );
}

export function previewTransformation(code: string, config: IPlaygroundConfig): {
  original: string;
  transformed: string;
  changes: string[];
} {
  const changes: string[] = [];
  const transformed = injectRemoteExecutor(code, config);
  if (code !== transformed) {
    changes.push('Added RemoteExecutor injection');
    changes.push('Replaced API keys with mock values');
    changes.push('Added playground configuration');
  }
  return { original: code, transformed, changes };
}

export function extractProviderInfo(code: string): {
  providers: string[];
  models: string[];
  hasTools: boolean;
  hasPlugins: boolean;
} {
  const providers: string[] = [];
  const models: string[] = [];

  if (code.includes('OpenAIProvider')) providers.push('openai');
  if (code.includes('AnthropicProvider')) providers.push('anthropic');
  if (code.includes('GoogleProvider')) providers.push('google');

  const modelMatches = code.match(/model:\s*['"]([^'"]+)['"]/g) || [];
  modelMatches.forEach(match => {
    const model = match.match(/['"]([^'"]+)['"]/)?.[1];
    if (model) models.push(model);
  });

  return {
    providers,
    models,
    hasTools: code.includes('addTool') || code.includes('createFunctionTool'),
    hasPlugins: code.includes('Plugin') && code.includes('new ')
  };
}
