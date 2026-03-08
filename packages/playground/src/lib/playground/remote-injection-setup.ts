/**
 * Playground setup code generation for remote injection
 */

import type { IPlaygroundConfig } from './config-validation';

/**
 * Add playground setup including configuration and mock SDK
 */
export function addPlaygroundSetup(code: string, config: IPlaygroundConfig): string {
  const setupCode = `
// Playground setup (auto-injected)
if (typeof window !== 'undefined') {
  // Setup Robota SDK bridge to real executor
  window.__ROBOTA_SDK__ = window.__ROBOTA_SDK__ || {
    agents: {
      Agent: class PlaygroundAgentBridge {
        constructor(options) {
          this.options = options;
          this.name = options?.name || 'PlaygroundAgent';
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            window.__ROBOTA_PLAYGROUND_EXECUTOR__.createAgent(options).catch(() => {});
          }
        }
        setSystemMessage(message) {
          if (this.options?.defaultModel) {
            this.options.defaultModel.systemMessage = message;
          }
          return this;
        }
        async run(input, options) {
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            try {
              const result = await window.__ROBOTA_PLAYGROUND_EXECUTOR__.run(input);
              return result.response;
            } catch (error) {
              return 'Error: Execution failed';
            }
          }
          return \`No executor available for: \${input}\`;
        }
        async* runStream(input, options) {
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            try {
              const result = await window.__ROBOTA_PLAYGROUND_EXECUTOR__.run(input);
              const words = result.response.split(' ');
              for (const word of words) {
                yield word + ' ';
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            } catch (error) {
              yield 'Error: Stream failed';
            }
          } else {
            yield 'No executor available';
          }
        }
        getStats() {
          return { name: this.name, conversationCount: 1, uptime: Date.now(), tools: [] };
        }
        getHistory() { return []; }
        async destroy() {}
      },
      Robota: class PlaygroundRobotaBridge {
        constructor(options) {
          this.options = options;
          this.name = options?.name || 'PlaygroundRobota';
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            window.__ROBOTA_PLAYGROUND_EXECUTOR__.createAgent(options).catch(() => {});
          }
        }
        async run(input, options) {
          if (window.__ROBOTA_PLAYGROUND_EXECUTOR__) {
            try {
              const result = await window.__ROBOTA_PLAYGROUND_EXECUTOR__.run(input);
              return result.response;
            } catch (error) {
              return 'Error: Execution failed';
            }
          }
          return \`No executor available for: \${input}\`;
        }
        async* runStream(input, options) {
          const response = await this.run(input, options);
          const words = response.split(' ');
          for (const word of words) {
            yield word + ' ';
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        getStats() {
          return {
            name: this.name, conversationCount: 1, uptime: Date.now(),
            tools: this.options?.tools?.map(t => t.name) || []
          };
        }
        getHistory() { return []; }
        async destroy() {}
      },
      createFunctionTool: (name, description, schema, handler) => {
        return { name, description, schema, handler, execute: handler };
      },
      LoggingPlugin: class MockLoggingPlugin { constructor(options) {} },
      UsagePlugin: class MockUsagePlugin { constructor(options) {} },
      PerformancePlugin: class MockPerformancePlugin { constructor(options) {} }
    },
    openai: {
      OpenAIProvider: class MockOpenAIProvider {
        constructor(options) { this.name = 'openai'; this.options = options; }
        async chat(messages) { return 'Mock OpenAI response'; }
      },
      OpenAI: class MockOpenAI {
        constructor(options) { this.apiKey = options?.apiKey; }
        chat = {
          completions: {
            create: async (params) => ({ choices: [{ message: { content: 'Mock OpenAI API response' } }] })
          }
        };
      }
    },
    anthropic: {
      AnthropicProvider: class MockAnthropicProvider {
        constructor(options) { this.name = 'anthropic'; this.options = options; }
      },
      Anthropic: class MockAnthropic {
        constructor(options) { this.apiKey = options?.apiKey; }
        messages = {
          create: async (params) => ({ content: [{ text: 'Mock Anthropic API response' }] })
        };
      }
    },
    google: {
      GoogleProvider: class MockGoogleProvider {
        constructor(options) { this.name = 'google'; this.options = options; }
      },
      GoogleGenerativeAI: class MockGoogleGenerativeAI {
        constructor(apiKey) { this.apiKey = apiKey; }
        getGenerativeModel(config) {
          return {
            generateContent: async (prompt) => ({ response: { text: () => 'Mock Google AI API response' } })
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
