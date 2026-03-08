/**
 * Code execution engine for the Robota Playground
 */

const DELAY_PARSE_MS = 500;
const DELAY_COMPILE_MS = 800;
const DELAY_INIT_MS = 600;
const DELAY_HEALTH_CHECK_MS = 400;
const SIMULATED_MIN_DELAY_MS = 1000;
const SIMULATED_MAX_EXTRA_DELAY_MS = 2000;

import {
    injectRemoteExecutor,
    requiresTransformation,
    extractProviderInfo,
} from './remote-injection';
import { createPlaygroundSandbox } from './remote-injection-sandbox';
import type { IPlaygroundConfig } from './config-validation';
import { analyzeCode, validateEnvironment, parseAgentConfig } from './code-analyzer';
import type { ICodeExecutionResult, IErrorInfo, IAgentContext } from './code-executor-types';

// Re-export types for external consumers
export type { ICodeExecutionResult, IErrorInfo, IAgentContext } from './code-executor-types';

export class CodeExecutor {
    private context?: IAgentContext
    private playgroundConfig: IPlaygroundConfig

    constructor(config?: Partial<IPlaygroundConfig>) {
        this.playgroundConfig = {
            enabled: true,
            serverUrl: config?.serverUrl || 'https://api.robota.io',
            apiUrl: config?.apiUrl || config?.serverUrl || 'https://api.robota.io',
            features: {
                remoteExecution: true,
                streaming: true,
                tools: true,
                ...(config?.features ?? {})
            }
        };
    }

    async executeCode(code: string, provider: string): Promise<ICodeExecutionResult> {
        const startTime = Date.now();
        const logs: string[] = [];
        const errors: IErrorInfo[] = [];
        const warnings: IErrorInfo[] = [];

        try {
            let transformedCode = code;
            if (requiresTransformation(code)) {
                logs.push('🔄 Transforming code for secure execution...');
                transformedCode = injectRemoteExecutor(code, this.playgroundConfig);
                logs.push('✅ Code transformed with RemoteExecutor injection');
            }

            logs.push('🔍 Analyzing code structure...');
            const analysisResult = analyzeCode(transformedCode);
            errors.push(...analysisResult.errors);
            warnings.push(...analysisResult.warnings);

            const criticalErrors = errors.filter(e => e.severity === 'error');
            if (criticalErrors.length > 0) {
                return { success: false, error: criticalErrors[0].message, logs, duration: Date.now() - startTime, agentReady: false, errors, warnings };
            }

            logs.push('⚙️ Parsing agent configuration...');
            await this.simulateDelay(DELAY_PARSE_MS);

            const agentConfig = parseAgentConfig(transformedCode);
            const providerInfo = extractProviderInfo(transformedCode);
            logs.push(`✅ Found agent with ${agentConfig.tools.length} tools`);
            logs.push(`🔌 Detected providers: ${providerInfo.providers.join(', ')}`);

            logs.push('🌍 Checking environment...');
            const envValidation = validateEnvironment(provider);
            warnings.push(...envValidation.warnings);

            if (envValidation.errors.length > 0) {
                errors.push(...envValidation.errors);
                return { success: false, error: envValidation.errors[0].message, logs, duration: Date.now() - startTime, agentReady: false, errors, warnings };
            }

            logs.push('🔨 Compiling agent...');
            await this.simulateDelay(DELAY_COMPILE_MS);
            logs.push('✅ Compilation successful');

            logs.push('🚀 Initializing agent...');
            await this.simulateDelay(DELAY_INIT_MS);

            if (requiresTransformation(code)) {
                logs.push('🔐 Using RemoteExecutor for secure execution');
                logs.push(`🌐 Connected to: ${this.playgroundConfig.serverUrl}`);
            }
            logs.push(`✅ Agent initialized with ${provider}`);

            logs.push('🚀 Executing code...');
            const { executionOutput, executionError } = await this.runInSandbox(transformedCode, logs);

            logs.push('🧪 Running health checks...');
            await this.simulateDelay(DELAY_HEALTH_CHECK_MS);
            logs.push('✅ All systems operational');

            this.context = { ...agentConfig, provider };

            return {
                success: !executionError,
                output: executionError ? undefined : executionOutput,
                error: executionError ? (executionError instanceof Error ? executionError.message : 'Unknown error') : undefined,
                logs,
                duration: Date.now() - startTime,
                agentReady: !executionError,
                compiledCode: this.generateCompiledCode(transformedCode),
                errors: executionError ? [...errors, {
                    type: 'runtime' as const, severity: 'error' as const,
                    message: executionError instanceof Error ? executionError.message : 'Unknown runtime error',
                    stack: executionError instanceof Error ? executionError.stack : undefined,
                    suggestions: ['Check your code syntax', 'Verify all imports are correct']
                }] : errors,
                warnings
            };
        } catch (error) {
            const errorInfo: IErrorInfo = {
                type: 'runtime', severity: 'error',
                message: error instanceof Error ? error.message : 'Unknown runtime error',
                stack: error instanceof Error ? error.stack : undefined,
                suggestions: ['Check your code syntax', 'Ensure all required dependencies are imported', 'Verify your agent configuration']
            };
            errors.push(errorInfo);
            return { success: false, error: errorInfo.message, logs, duration: Date.now() - startTime, agentReady: false, errors, warnings };
        }
    }

    private async runInSandbox(transformedCode: string, logs: string[]): Promise<{ executionOutput: string; executionError: Error | null }> {
        try {
            const sandbox = createPlaygroundSandbox(this.playgroundConfig, injectRemoteExecutor);
            logs.push('🔒 Running in sandbox environment...');
            const { result, logs: consoleLogs } = await sandbox.execute(transformedCode);

            const outputParts: string[] = [];
            if (consoleLogs.length > 0) {
                outputParts.push('Console Output:', ...consoleLogs);
            }
            if (result !== undefined) {
                outputParts.push('', 'Return Value:', typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
            }

            const executionOutput = outputParts.length > 0 ? outputParts.join('\n') : 'Code executed successfully (no output)';
            logs.push('✅ Code executed successfully in sandbox');
            if (consoleLogs.length > 0) {
                logs.push(`📝 Captured ${consoleLogs.length} console output(s)`);
            }

            sandbox.cleanup();
            return { executionOutput, executionError: null };
        } catch (error) {
            logs.push(`❌ Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { executionOutput: '', executionError: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    async sendMessage(message: string): Promise<string> {
        if (!this.context) {
            throw new Error('Agent not ready. Please run your code first.');
        }
        await this.simulateDelay(SIMULATED_MIN_DELAY_MS + Math.random() * SIMULATED_MAX_EXTRA_DELAY_MS);
        return this.generateAgentResponse(message, this.context);
    }

    private generateCompiledCode(code: string): string {
        const config = parseAgentConfig(code);
        return `// Compiled Robota Agent
const compiledAgent = {
  model: "${config.model}",
  tools: [${config.tools.map((tool) => `"${tool.name}"`).join(', ')}],
  systemMessage: ${config.systemMessage ? `"${config.systemMessage}"` : 'null'},
  ready: true
};

export default compiledAgent;`;
    }

    private generateAgentResponse(message: string, context: IAgentContext): string {
        const responses = [
            `I understand you're asking about "${message}". As an AI agent powered by ${context.provider}, I'm here to help!`,
            `Thanks for your message: "${message}". I have ${context.tools.length} tools available to assist you.`,
            `Let me process your request: "${message}". Based on my configuration, I can help with various tasks.`,
            `I received your message about "${message}". Using my ${context.model} capabilities, here's what I think...`,
            `Interesting question about "${message}"! With my current tools (${context.tools.map(t => t.name).join(', ')}), I can help you with that.`
        ];

        if (message.toLowerCase().includes('time')) {
            const timeTools = context.tools.filter(t => t.name.toLowerCase().includes('time'));
            if (timeTools.length > 0) {
                return `I can help with time-related queries! I have the "${timeTools[0].name}" tool available. The current time is ${new Date().toLocaleString()}.`;
            }
        }

        if (message.toLowerCase().includes('weather')) {
            const weatherTools = context.tools.filter(t => t.name.toLowerCase().includes('weather'));
            if (weatherTools.length > 0) {
                return `I'd be happy to help with weather information using my "${weatherTools[0].name}" tool! However, this is a simulated environment, so I can't provide real weather data right now.`;
            }
        }

        return responses[Math.floor(Math.random() * responses.length)];
    }

    private async simulateDelay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getContext(): IAgentContext | undefined {
        return this.context;
    }

    reset(): void {
        this.context = undefined;
    }
}
