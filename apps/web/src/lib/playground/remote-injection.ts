/**
 * Remote Executor Injection for Robota Playground
 * 
 * This module transforms user code to automatically inject RemoteExecutor
 * for secure server-side execution without exposing actual API keys.
 */

// Import RemoteExecutor dynamically for web environment
// Dynamic import to avoid build issues with SSR
interface RemoteExecutorInterface {
  readonly name: string;
  readonly version: string;
  executeChat(request: any): Promise<any>;
  executeChatStream?(request: any): AsyncIterable<any>;
  supportsTools(): boolean;
  validateConfig(): boolean;
  dispose?(): Promise<void>;
}

export interface PlaygroundConfig {
  serverUrl: string;
  userApiKey: string;
  enableWebSocket?: boolean;
}

/**
 * Global playground executor instance
 * This is injected into the sandbox environment
 */
declare global {
  interface Window {
    __ROBOTA_PLAYGROUND_EXECUTOR__?: RemoteExecutorInterface;
    __ROBOTA_PLAYGROUND_CONFIG__?: PlaygroundConfig;
  }
}

/**
 * Transform user code to inject RemoteExecutor into all AI providers
 * 
 * @param userCode - Original user code from the playground editor
 * @param config - Playground configuration with server details
 * @returns Transformed code with RemoteExecutor injection
 */
export function injectRemoteExecutor(userCode: string, config: PlaygroundConfig): string {
  // Convert ES6 imports to global variables for browser execution
  let transformedCode = convertImportsToGlobals(userCode);

  // Remove actual API key usage for security
  transformedCode = removeApiKeyUsage(transformedCode);

  // Inject executor into provider constructors
  transformedCode = injectExecutorIntoProviders(transformedCode);

  // Add playground configuration and mock libraries
  transformedCode = addPlaygroundSetup(transformedCode, config);

  return transformedCode;
}

/**
 * Convert ES6 imports to global variable assignments for browser execution
 */
function convertImportsToGlobals(code: string): string {
  let transformedCode = code;

  // Handle @robota-sdk/agents imports first (most important)
  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@robota-sdk\/agents['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.agents?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  // Handle OpenAI imports (both default and named)
  transformedCode = transformedCode.replace(
    /import\s+OpenAI\s+from\s*['"]openai['"];?\s*/g,
    'const OpenAI = window.__ROBOTA_SDK__?.openai?.OpenAI || class MockOpenAI {};\n'
  );

  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]openai['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.openai?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  // Handle @robota-sdk provider imports
  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@robota-sdk\/openai['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.openai?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@robota-sdk\/anthropic['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.anthropic?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@robota-sdk\/google['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.google?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  // Handle Anthropic SDK imports
  transformedCode = transformedCode.replace(
    /import\s+Anthropic\s+from\s*['"]@anthropic-ai\/sdk['"];?\s*/g,
    'const Anthropic = window.__ROBOTA_SDK__?.anthropic?.Anthropic || class MockAnthropic {};\n'
  );

  // Handle Google AI imports
  transformedCode = transformedCode.replace(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@google\/generative-ai['"];?\s*/g,
    (match, imports) => {
      const importList = imports.split(',').map((imp: string) => imp.trim());
      const assignments = importList.map((imp: string) => {
        return `const ${imp} = window.__ROBOTA_SDK__?.google?.${imp} || class Mock${imp} {};`;
      }).join('\n');
      return assignments + '\n';
    }
  );

  // Remove any remaining import statements
  transformedCode = transformedCode.replace(
    /import\s+.*?from\s*['"][^'"]*['"];?\s*/g,
    '// Import removed for playground execution\n'
  );

  // Remove export statements and convert to assignments
  transformedCode = transformedCode.replace(
    /export\s+default\s+(.+)/g,
    'const __DEFAULT_EXPORT__ = $1'
  );

  transformedCode = transformedCode.replace(
    /export\s+/g,
    '// Export removed - '
  );

  return transformedCode;
}

/**
 * Remove direct API key usage from code for security
 */
function removeApiKeyUsage(code: string): string {
  return code
    // Remove OpenAI client API key
    .replace(
      /new OpenAI\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g,
      'new OpenAI({ apiKey: "playground-mock-key" })'
    )
    // Remove Anthropic client API key
    .replace(
      /new Anthropic\(\s*{\s*apiKey:\s*['"'][^'"]*['"]\s*}\s*\)/g,
      'new Anthropic({ apiKey: "playground-mock-key" })'
    )
    // Remove environment variable API key usage
    .replace(
      /process\.env\.[A-Z_]*API_KEY/g,
      '"playground-mock-key"'
    )
    // Remove direct string API keys
    .replace(
      /apiKey:\s*['"']sk-[^'"]*['"']/g,
      'apiKey: "playground-mock-key"'
    );
}



/**
 * Inject executor into AI provider constructors
 */
function injectExecutorIntoProviders(code: string): string {
  let transformedCode = code;

  // OpenAI Provider injection
  transformedCode = transformedCode.replace(
    /new OpenAIProvider\(\s*({[^}]*})\s*\)/g,
    (match, configObj) => {
      // Parse existing config and add executor
      if (configObj.includes('executor:')) {
        return match; // Already has executor
      }

      // Add executor to config
      const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
        '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
      return `new OpenAIProvider(${newConfig})`;
    }
  );

  // Anthropic Provider injection
  transformedCode = transformedCode.replace(
    /new AnthropicProvider\(\s*({[^}]*})\s*\)/g,
    (match, configObj) => {
      if (configObj.includes('executor:')) {
        return match;
      }

      const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
        '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
      return `new AnthropicProvider(${newConfig})`;
    }
  );

  // Google Provider injection
  transformedCode = transformedCode.replace(
    /new GoogleProvider\(\s*({[^}]*})\s*\)/g,
    (match, configObj) => {
      if (configObj.includes('executor:')) {
        return match;
      }

      const newConfig = configObj.slice(0, -1) + (configObj.trim().endsWith(',') ? '' : ',') +
        '\n    executor: window.__ROBOTA_PLAYGROUND_EXECUTOR__\n  }';
      return `new GoogleProvider(${newConfig})`;
    }
  );

  return transformedCode;
}

/**
 * Add playground setup including configuration and mock SDK
 */
function addPlaygroundSetup(code: string, config: PlaygroundConfig): string {
  const setupCode = `
// Playground setup (auto-injected)
if (typeof window !== 'undefined') {
  // Setup Robota SDK mock
  window.__ROBOTA_SDK__ = window.__ROBOTA_SDK__ || {
    agents: {
      // Support both Agent and Robota class names
      Agent: class MockAgent {
        constructor(options) { 
          this.options = options;
          this.name = options?.name || 'MockAgent';
          console.log('Mock Agent created with options:', options);
        }
        setSystemMessage(message) { 
          console.log('System message set:', message);
          return this;
        }
        async run(input, options) {
          console.log('Agent.run() called with input:', input);
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            try {
              const response = await window.__ROBOTA_PLAYGROUND_EXECUTOR__.executeChat({
                messages: [{ role: 'user', content: input }],
                provider: this.options?.defaultModel?.provider || 'openai',
                model: this.options?.defaultModel?.model || 'gpt-3.5-turbo'
              });
              return response.content;
            } catch (error) {
              console.error('Remote execution failed:', error);
              return 'Error: Remote execution failed';
            }
          }
          return \`Mock response to: \${input}\`;
        }
        async* runStream(input, options) {
          console.log('Agent.runStream() called with input:', input);
          const response = await this.run(input, options);
          const words = response.split(' ');
          for (const word of words) {
            yield word + ' ';
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        getStats() {
          return {
            name: this.name,
            conversationCount: 1,
            uptime: Date.now(),
            tools: []
          };
        }
        getHistory() {
          return [];
        }
        async destroy() {
          console.log('Agent destroyed');
        }
      },
      Robota: class MockRobota {
        constructor(options) { 
          this.options = options;
          this.name = options?.name || 'MockRobota';
          console.log('Mock Robota created with options:', options);
        }
        async run(input, options) {
          console.log('Robota.run() called with input:', input);
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            try {
              const response = await window.__ROBOTA_PLAYGROUND_EXECUTOR__.executeChat({
                messages: [{ role: 'user', content: input }],
                provider: this.options?.defaultModel?.provider || 'openai',
                model: this.options?.defaultModel?.model || 'gpt-3.5-turbo'
              });
              return response.content;
            } catch (error) {
              console.error('Remote execution failed:', error);
              return 'Error: Remote execution failed';
            }
          }
          return \`Mock response to: \${input}\`;
        }
        async* runStream(input, options) {
          console.log('Robota.runStream() called with input:', input);
          const response = await this.run(input, options);
          const words = response.split(' ');
          for (const word of words) {
            yield word + ' ';
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        getStats() {
          return {
            name: this.name,
            conversationCount: 1,
            uptime: Date.now(),
            tools: this.options?.tools?.map(t => t.name) || []
          };
        }
        getHistory() {
          return [];
        }
        async destroy() {
          console.log('Robota destroyed');
        }
      },
      createFunctionTool: (name, description, schema, handler) => {
        console.log('Function tool created:', name, description);
        return { 
          name, 
          description, 
          schema,
          handler,
          execute: handler
        };
      },
      LoggingPlugin: class MockLoggingPlugin {
        constructor(options) {
          console.log('Logging plugin created:', options);
        }
      },
      UsagePlugin: class MockUsagePlugin {
        constructor(options) {
          console.log('Usage plugin created:', options);
        }
      },
      PerformancePlugin: class MockPerformancePlugin {
        constructor(options) {
          console.log('Performance plugin created:', options);
        }
      }
    },
    openai: {
      OpenAIProvider: class MockOpenAIProvider {
        constructor(options) { 
          this.name = 'openai';
          this.options = options;
          console.log('Mock OpenAI Provider created');
        }
        async chat(messages) {
          console.log('OpenAI chat called with messages:', messages);
          return 'Mock OpenAI response';
        }
      },
      OpenAI: class MockOpenAI {
        constructor(options) {
          this.apiKey = options?.apiKey;
          console.log('Mock OpenAI client created');
        }
        chat = {
          completions: {
            create: async (params) => {
              console.log('OpenAI API call:', params);
              return {
                choices: [{
                  message: {
                    content: 'Mock OpenAI API response'
                  }
                }]
              };
            }
          }
        };
      }
    },
    anthropic: {
      AnthropicProvider: class MockAnthropicProvider {
        constructor(options) { 
          this.name = 'anthropic';
          this.options = options;
          console.log('Mock Anthropic Provider created');
        }
      },
      Anthropic: class MockAnthropic {
        constructor(options) {
          this.apiKey = options?.apiKey;
          console.log('Mock Anthropic client created');
        }
        messages = {
          create: async (params) => {
            console.log('Anthropic API call:', params);
            return {
              content: [{
                text: 'Mock Anthropic API response'
              }]
            };
          }
        };
      }
    },
    google: {
      GoogleProvider: class MockGoogleProvider {
        constructor(options) { 
          this.name = 'google';
          this.options = options;
          console.log('Mock Google Provider created');
        }
      },
      GoogleGenerativeAI: class MockGoogleGenerativeAI {
        constructor(apiKey) {
          this.apiKey = apiKey;
          console.log('Mock Google Generative AI client created');
        }
        getGenerativeModel(config) {
          return {
            generateContent: async (prompt) => {
              console.log('Google AI API call:', prompt);
              return {
                response: {
                  text: () => 'Mock Google AI API response'
                }
              };
            }
          };
        }
      }
    }
  };

  // Setup playground configuration
  window.__ROBOTA_PLAYGROUND_CONFIG__ = ${JSON.stringify(config, null, 2)};
}
`;

  return setupCode + '\n' + code;
}

/**
 * Create a sandbox environment for secure code execution
 */
export function createPlaygroundSandbox(config: PlaygroundConfig): {
  execute: (code: string) => Promise<{ result: any; logs: string[] }>;
  cleanup: () => void;
} {
  // Capture console output
  const capturedLogs: string[] = [];

  // Create isolated context
  const sandbox = {
    console: {
      log: (...args: any[]) => {
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        capturedLogs.push(message);
        console.log('[Playground]', ...args); // Still show in browser console
      },
      error: (...args: any[]) => {
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        capturedLogs.push(`ERROR: ${message}`);
        console.error('[Playground]', ...args);
      },
      warn: (...args: any[]) => {
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        capturedLogs.push(`WARN: ${message}`);
        console.warn('[Playground]', ...args);
      }
    },
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    fetch: window.fetch.bind(window),
    URL,
    Date,
    Math,
    JSON,
    Promise,
    // Mock process.env for playground
    process: {
      env: {
        OPENAI_API_KEY: 'playground-mock-key',
        ANTHROPIC_API_KEY: 'playground-mock-key',
        GOOGLE_API_KEY: 'playground-mock-key'
      }
    },
    // Playground-specific globals
    __ROBOTA_PLAYGROUND_CONFIG__: config,
    __ROBOTA_PLAYGROUND_EXECUTOR__: null as RemoteExecutorInterface | null
  };

  return {
    execute: async (code: string) => {
      try {
        // Clear previous logs
        capturedLogs.length = 0;

        // Use the global executor if available
        if (typeof window !== 'undefined' && window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
          sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = window.__ROBOTA_PLAYGROUND_EXECUTOR__;
        } else {
          // Fallback mock executor
          sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = {
            name: 'mock-remote',
            version: '1.0.0',
            executeChat: async () => ({ role: 'assistant', content: 'Mock response', timestamp: new Date() }),
            executeChatStream: async function* () { yield { role: 'assistant', content: 'Mock', timestamp: new Date() }; },
            supportsTools: () => true,
            validateConfig: () => true,
            dispose: async () => { }
          } as RemoteExecutorInterface;
        }

        // Transform code for playground execution
        const transformedCode = injectRemoteExecutor(code, config);

        // Wrap code in async IIFE for top-level await support
        const wrappedCode = `
          (async () => {
            ${transformedCode}
          })()
        `;

        // Execute in sandbox context
        const func = new Function(...Object.keys(sandbox), `return ${wrappedCode}`);
        const result = await func(...Object.values(sandbox));

        return {
          result,
          logs: [...capturedLogs] // Return copy of captured logs
        };

      } catch (error) {
        console.error('Playground execution error:', error);
        throw error;
      }
    },
    cleanup: () => {
      if (sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__) {
        sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__.dispose?.();
        sandbox.__ROBOTA_PLAYGROUND_EXECUTOR__ = null;
      }
      capturedLogs.length = 0;
    }
  };
}

/**
 * Generate mock environment variables for playground
 */
export function generateMockEnvironment(): Record<string, string> {
  return {
    OPENAI_API_KEY: 'playground-mock-openai-key',
    ANTHROPIC_API_KEY: 'playground-mock-anthropic-key',
    GOOGLE_AI_API_KEY: 'playground-mock-google-key',
    NODE_ENV: 'playground'
  };
}

/**
 * Check if code requires transformation for playground
 */
export function requiresTransformation(code: string): boolean {
  return (
    code.includes('new OpenAIProvider') ||
    code.includes('new AnthropicProvider') ||
    code.includes('new GoogleProvider') ||
    code.includes('process.env.') ||
    /apiKey:\s*['"][^'"]*['"]/.test(code)
  );
}

/**
 * Preview transformed code for debugging
 */
export function previewTransformation(code: string, config: PlaygroundConfig): {
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

  return {
    original: code,
    transformed,
    changes
  };
}

/**
 * Extract provider information from code
 */
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