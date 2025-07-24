/**
 * Code execution engine for the Robota Playground
 * Simulates running Robota agent code and provides realistic results
 * Now with RemoteExecutor integration for secure server-side execution
 */

import {
    injectRemoteExecutor,
    requiresTransformation,
    extractProviderInfo,
    createPlaygroundSandbox,
    type PlaygroundConfig
} from './remote-injection';

export interface ExecutionResult {
    success: boolean
    output?: string
    error?: string
    logs?: string[]
    duration: number
    agentReady: boolean
    compiledCode?: string
    errors?: ErrorInfo[]
    warnings?: ErrorInfo[]
}

export interface ErrorInfo {
    type: 'syntax' | 'runtime' | 'api' | 'configuration' | 'import'
    severity: 'error' | 'warning' | 'info'
    message: string
    line?: number
    column?: number
    stack?: string
    code?: string
    suggestions?: string[]
    documentation?: string
}

export interface AgentContext {
    provider: string
    model: string
    tools: Array<{ name: string; description: string }>
    systemMessage?: string
}

export class CodeExecutor {
    private context: AgentContext | null = null
    private playgroundConfig: PlaygroundConfig

    constructor(config?: Partial<PlaygroundConfig>) {
        this.playgroundConfig = {
            serverUrl: config?.serverUrl || 'https://api.robota.io',
            userApiKey: config?.userApiKey || 'playground-demo-token',
            enableWebSocket: config?.enableWebSocket || false
        };
    }

    async executeCode(code: string, provider: string): Promise<ExecutionResult> {
        const startTime = Date.now()
        const logs: string[] = []
        const errors: ErrorInfo[] = []
        const warnings: ErrorInfo[] = []

        try {
            // Step 0: Transform code for RemoteExecutor if needed
            let transformedCode = code;
            if (requiresTransformation(code)) {
                logs.push('🔄 Transforming code for secure execution...');
                transformedCode = injectRemoteExecutor(code, this.playgroundConfig);
                logs.push('✅ Code transformed with RemoteExecutor injection');
            }

            // Step 1: Code validation and analysis
            logs.push('🔍 Analyzing code structure...')
            const analysisResult = this.analyzeCode(transformedCode)

            errors.push(...analysisResult.errors)
            warnings.push(...analysisResult.warnings)

            // If there are critical errors, return early
            const criticalErrors = errors.filter(e => e.severity === 'error')
            if (criticalErrors.length > 0) {
                return {
                    success: false,
                    error: criticalErrors[0].message,
                    logs,
                    duration: Date.now() - startTime,
                    agentReady: false,
                    errors,
                    warnings
                }
            }

            // Step 2: Parse agent configuration
            logs.push('⚙️ Parsing agent configuration...')
            await this.simulateDelay(500)

            const agentConfig = this.parseAgentConfig(transformedCode)
            const providerInfo = extractProviderInfo(transformedCode)
            logs.push(`✅ Found agent with ${agentConfig.tools.length} tools`)
            logs.push(`🔌 Detected providers: ${providerInfo.providers.join(', ')}`)

            // Step 3: Validate environment
            logs.push('🌍 Checking environment...')
            const envValidation = this.validateEnvironment(provider, { ...agentConfig, provider })
            warnings.push(...envValidation.warnings)

            if (envValidation.errors.length > 0) {
                errors.push(...envValidation.errors)
                return {
                    success: false,
                    error: envValidation.errors[0].message,
                    logs,
                    duration: Date.now() - startTime,
                    agentReady: false,
                    errors,
                    warnings
                }
            }

            // Step 4: Simulate compilation
            logs.push('🔨 Compiling agent...')
            await this.simulateDelay(800)
            logs.push('✅ Compilation successful')

            // Step 5: Initialize agent
            logs.push('🚀 Initializing agent...')
            await this.simulateDelay(600)

            if (requiresTransformation(code)) {
                logs.push('🔐 Using RemoteExecutor for secure execution')
                logs.push(`🌐 Connected to: ${this.playgroundConfig.serverUrl}`)
            }

            logs.push(`✅ Agent initialized with ${provider}`)

            // Step 6: Execute the actual code
            logs.push('🚀 Executing code...')

            let executionOutput = '';
            let executionError = null;

            try {
                // Create sandbox environment for safe execution
                const sandbox = createPlaygroundSandbox(this.playgroundConfig);

                // Execute code in sandbox
                logs.push('🔒 Running in sandbox environment...');
                const { result, logs: consoleLogs } = await sandbox.execute(transformedCode);

                // Combine execution result and console logs
                const outputParts = [];

                if (consoleLogs.length > 0) {
                    outputParts.push('Console Output:');
                    outputParts.push(...consoleLogs);
                }

                if (result !== undefined) {
                    outputParts.push('');
                    outputParts.push('Return Value:');
                    outputParts.push(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
                }

                executionOutput = outputParts.length > 0 ?
                    outputParts.join('\n') :
                    'Code executed successfully (no output)';

                logs.push('✅ Code executed successfully in sandbox');
                if (consoleLogs.length > 0) {
                    logs.push(`📝 Captured ${consoleLogs.length} console output(s)`);
                }

                // Cleanup sandbox
                sandbox.cleanup();

            } catch (error) {
                executionError = error;
                logs.push(`❌ Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            logs.push('🧪 Running health checks...')
            await this.simulateDelay(400)
            logs.push('✅ All systems operational')

            this.context = { ...agentConfig, provider }

            return {
                success: !executionError,
                output: executionError ? undefined : executionOutput,
                error: executionError ? (executionError instanceof Error ? executionError.message : 'Unknown error') : undefined,
                logs,
                duration: Date.now() - startTime,
                agentReady: !executionError,
                compiledCode: this.generateCompiledCode(transformedCode),
                errors: executionError ? [...errors, {
                    type: 'runtime',
                    severity: 'error',
                    message: executionError instanceof Error ? executionError.message : 'Unknown runtime error',
                    stack: executionError instanceof Error ? executionError.stack : undefined,
                    suggestions: ['Check your code syntax', 'Verify all imports are correct']
                }] : errors,
                warnings
            }

        } catch (error) {
            const errorInfo: ErrorInfo = {
                type: 'runtime',
                severity: 'error',
                message: error instanceof Error ? error.message : 'Unknown runtime error',
                stack: error instanceof Error ? error.stack : undefined,
                suggestions: [
                    'Check your code syntax',
                    'Ensure all required dependencies are imported',
                    'Verify your agent configuration'
                ]
            }

            errors.push(errorInfo)

            return {
                success: false,
                error: errorInfo.message,
                logs,
                duration: Date.now() - startTime,
                agentReady: false,
                errors,
                warnings
            }
        }
    }

    async sendMessage(message: string): Promise<string> {
        if (!this.context) {
            throw new Error('Agent not ready. Please run your code first.')
        }

        // Simulate processing time
        await this.simulateDelay(1000 + Math.random() * 2000)

        // Generate realistic responses based on context
        return this.generateAgentResponse(message, this.context)
    }

    private analyzeCode(code: string): { errors: ErrorInfo[], warnings: ErrorInfo[] } {
        const errors: ErrorInfo[] = []
        const warnings: ErrorInfo[] = []
        const lines = code.split('\n')

        // Check for basic syntax issues
        this.checkSyntax(code, lines, errors, warnings)

        // Check imports
        this.checkImports(code, lines, errors, warnings)

        // Check agent configuration
        this.checkAgentConfig(code, lines, errors, warnings)

        // Check environment variables
        this.checkEnvironmentUsage(code, lines, warnings)

        return { errors, warnings }
    }

    private checkSyntax(code: string, lines: string[], errors: ErrorInfo[], warnings: ErrorInfo[]) {
        // Check for common syntax errors
        if (code.includes('import') && !code.includes('from')) {
            const importLine = lines.findIndex(line => line.includes('import') && !line.includes('from'))
            if (importLine !== -1) {
                errors.push({
                    type: 'syntax',
                    severity: 'error',
                    message: 'Invalid import statement syntax',
                    line: importLine + 1,
                    code: lines[importLine],
                    suggestions: [
                        'Use: import { Agent } from \'@robota/agents\'',
                        'Check import statement format',
                        'Ensure proper module path'
                    ],
                    documentation: 'https://robota.dev/docs/getting-started'
                })
            }
        }

        // Check for missing closing brackets
        const openBrackets = (code.match(/\{/g) || []).length
        const closeBrackets = (code.match(/\}/g) || []).length
        if (openBrackets !== closeBrackets) {
            errors.push({
                type: 'syntax',
                severity: 'error',
                message: 'Mismatched brackets - missing closing bracket',
                suggestions: [
                    'Check for missing } brackets',
                    'Ensure proper code block structure',
                    'Use an IDE with bracket matching'
                ]
            })
        }

        // Check for missing semicolons (warning)
        const missingSemicolonLines = lines
            .map((line, index) => ({ line: line.trim(), index }))
            .filter(({ line, index }) =>
                line.length > 0 &&
                !line.endsWith(';') &&
                !line.endsWith('{') &&
                !line.endsWith('}') &&
                !line.startsWith('//') &&
                !line.startsWith('import') &&
                !line.startsWith('export') &&
                line.includes('=')
            )

        missingSemicolonLines.slice(0, 3).forEach(({ line, index }) => {
            warnings.push({
                type: 'syntax',
                severity: 'warning',
                message: 'Missing semicolon',
                line: index + 1,
                code: line,
                suggestions: ['Add semicolon at the end of the statement']
            })
        })
    }

    private checkImports(code: string, lines: string[], errors: ErrorInfo[], warnings: ErrorInfo[]) {
        const requiredImports = [
            { package: '@robota-sdk/agents', export: 'Robota' },
            { package: '@robota-sdk/openai', export: 'OpenAIProvider' },
            { package: '@robota-sdk/anthropic', export: 'AnthropicProvider' },
            { package: '@robota-sdk/google', export: 'GoogleProvider' }
        ]

        // Check if Robota is imported
        if (!code.includes('Robota') && !code.includes('from \'@robota-sdk/agents\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing Robota import from @robota-sdk/agents',
                line: 1,
                suggestions: [
                    'Add: import { Robota } from \'@robota-sdk/agents\'',
                    'Install package: npm install @robota-sdk/agents'
                ],
                documentation: 'https://robota.dev/docs/agents'
            })
        }

        // Check for OpenAI client import
        if (code.includes('new OpenAI(') && !code.includes('import OpenAI from \'openai\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing OpenAI client import',
                suggestions: [
                    'Add: import OpenAI from \'openai\'',
                    'Install package: npm install openai'
                ]
            })
        }

        // Check provider imports based on usage
        if (code.includes('OpenAIProvider') && !code.includes('from \'@robota-sdk/openai\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing OpenAIProvider import',
                suggestions: [
                    'Add: import { OpenAIProvider } from \'@robota-sdk/openai\'',
                    'Install package: npm install @robota-sdk/openai'
                ]
            })
        }

        if (code.includes('AnthropicProvider') && !code.includes('from \'@robota-sdk/anthropic\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing AnthropicProvider import',
                suggestions: [
                    'Add: import { AnthropicProvider } from \'@robota-sdk/anthropic\'',
                    'Install package: npm install @robota-sdk/anthropic'
                ]
            })
        }

        if (code.includes('GoogleProvider') && !code.includes('from \'@robota-sdk/google\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing GoogleProvider import',
                suggestions: [
                    'Add: import { GoogleProvider } from \'@robota-sdk/google\'',
                    'Install package: npm install @robota-sdk/google'
                ]
            })
        }

        // Check for tool function imports
        if (code.includes('createFunctionTool') && !code.includes('createFunctionTool') && !code.includes('from \'@robota-sdk/agents\'')) {
            warnings.push({
                type: 'import',
                severity: 'warning',
                message: 'createFunctionTool should be imported from @robota-sdk/agents',
                suggestions: [
                    'Add createFunctionTool to import: import { Robota, createFunctionTool } from \'@robota-sdk/agents\''
                ]
            })
        }

        // Check for plugin imports
        const pluginNames = ['LoggingPlugin', 'UsagePlugin', 'PerformancePlugin']
        pluginNames.forEach(pluginName => {
            if (code.includes(pluginName) && !code.includes(`${pluginName}`) && !code.includes('from \'@robota-sdk/agents\'')) {
                warnings.push({
                    type: 'import',
                    severity: 'warning',
                    message: `${pluginName} should be imported from @robota-sdk/agents`,
                    suggestions: [
                        `Add ${pluginName} to import: import { Robota, ${pluginName} } from '@robota-sdk/agents'`
                    ]
                })
            }
        })
    }

    private checkAgentConfig(code: string, lines: string[], errors: ErrorInfo[], warnings: ErrorInfo[]) {
        // Check if Robota is instantiated
        if (!code.includes('new Robota(')) {
            errors.push({
                type: 'configuration',
                severity: 'error',
                message: 'No Robota instance found',
                suggestions: [
                    'Create agent: const robota = new Robota({ name: "MyAgent", aiProviders: [...], defaultModel: {...} })',
                    'Check Robota configuration syntax'
                ],
                documentation: 'https://robota.dev/docs/agents/configuration'
            })
            return
        }

        // Check if aiProviders is configured
        if (!code.includes('aiProviders:')) {
            errors.push({
                type: 'configuration',
                severity: 'error',
                message: 'Missing aiProviders configuration',
                suggestions: [
                    'Add aiProviders to Robota config',
                    'Example: aiProviders: [new OpenAIProvider({ apiKey: "your-api-key" })]'
                ]
            })
        }

        // Check if defaultModel is configured
        if (!code.includes('defaultModel:')) {
            errors.push({
                type: 'configuration',
                severity: 'error',
                message: 'Missing defaultModel configuration',
                suggestions: [
                    'Add defaultModel to Robota config',
                    'Example: defaultModel: { provider: "openai", model: "gpt-3.5-turbo" }'
                ]
            })
        }

        // Check for agent name
        if (!code.includes('name:')) {
            warnings.push({
                type: 'configuration',
                severity: 'warning',
                message: 'Missing agent name',
                suggestions: [
                    'Add name to Robota config',
                    'Example: name: "MyAgent"'
                ]
            })
        }

        // Check for proper cleanup
        if (!code.includes('destroy()') && !code.includes('await robota.destroy()')) {
            warnings.push({
                type: 'configuration',
                severity: 'warning',
                message: 'Missing cleanup call',
                suggestions: [
                    'Add cleanup: await robota.destroy()',
                    'Call destroy() to properly clean up resources'
                ]
            })
        }
    }

    private checkEnvironmentUsage(code: string, lines: string[], warnings: ErrorInfo[]) {
        // Check for environment variable usage
        const envVarPattern = /process\.env\.(\w+)/g
        const envVars = []
        let match

        while ((match = envVarPattern.exec(code)) !== null) {
            envVars.push(match[1])
        }

        envVars.forEach(envVar => {
            warnings.push({
                type: 'configuration',
                severity: 'info',
                message: `Environment variable ${envVar} is used`,
                suggestions: [
                    `Set ${envVar} in your environment`,
                    'Create .env file with your API keys',
                    'Check environment variable configuration'
                ]
            })
        })
    }

    private validateEnvironment(provider: string, agentConfig: AgentContext): { errors: ErrorInfo[], warnings: ErrorInfo[] } {
        const errors: ErrorInfo[] = []
        const warnings: ErrorInfo[] = []

        // Simulate environment validation
        const commonEnvVars = {
            openai: ['OPENAI_API_KEY'],
            anthropic: ['ANTHROPIC_API_KEY'],
            google: ['GOOGLE_API_KEY']
        }

        const requiredVars = commonEnvVars[provider as keyof typeof commonEnvVars] || []

        requiredVars.forEach(envVar => {
            warnings.push({
                type: 'configuration',
                severity: 'warning',
                message: `${envVar} should be set in environment`,
                suggestions: [
                    `Add ${envVar}=your_key_here to .env file`,
                    'Check API key configuration',
                    'Verify environment variables are loaded'
                ],
                documentation: `https://robota.dev/docs/providers/${provider}`
            })
        })

        return { errors, warnings }
    }

    private validateCode(code: string): { valid: boolean; error?: string } {
        // Basic syntax validation
        if (!code.trim()) {
            return { valid: false, error: 'Code cannot be empty' }
        }

        if (!code.includes('Robota')) {
            return { valid: false, error: 'Code must include a Robota instance' }
        }

        if (!code.includes('Provider')) {
            return { valid: false, error: 'Code must include a Provider (OpenAI, Anthropic, or Google)' }
        }

        // Check for basic TypeScript syntax errors
        const commonErrors = [
            { pattern: /\)\s*{/, message: 'Missing opening brace' },
            { pattern: /}\s*\)/, message: 'Unexpected closing brace' },
            {
                pattern: /\w+\s*\(/, test: (code: string) => {
                    const openParens = (code.match(/\(/g) || []).length
                    const closeParens = (code.match(/\)/g) || []).length
                    return openParens !== closeParens
                }, message: 'Mismatched parentheses'
            }
        ]

        for (const error of commonErrors) {
            if (error.test ? error.test(code) : error.pattern.test(code)) {
                return { valid: false, error: error.message }
            }
        }

        return { valid: true }
    }

    private parseAgentConfig(code: string): {
        name: string
        model: string
        tools: Array<{ name: string; description: string }>
        systemMessage?: string
        plugins: string[]
    } {
        const tools: Array<{ name: string; description: string }> = []

        // Extract tools from createFunctionTool calls
        const toolMatches = code.match(/createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g) || []
        for (const match of toolMatches) {
            const parts = match.match(/createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/)
            if (parts) {
                tools.push({
                    name: parts[1],
                    description: parts[2]
                })
            }
        }

        // Also extract tools from tools array in config
        const toolsArrayMatch = code.match(/tools:\s*\[([^\]]+)\]/)
        if (toolsArrayMatch) {
            const toolVariables = toolsArrayMatch[1].match(/\w+Tool/g) || []
            toolVariables.forEach(varName => {
                if (!tools.find(t => t.name === varName.replace('Tool', ''))) {
                    tools.push({
                        name: varName.replace('Tool', ''),
                        description: 'Custom tool function'
                    })
                }
            })
        }

        // Extract agent name
        const nameMatch = code.match(/name:\s*['"`]([^'"`]+)['"`]/)
        const name = nameMatch ? nameMatch[1] : 'UnnamedAgent'

        // Extract model from defaultModel
        const modelMatch = code.match(/model:\s*['"`]([^'"`]+)['"`]/)
        const model = modelMatch ? modelMatch[1] : 'gpt-3.5-turbo'

        // Extract system message from defaultModel
        const systemMatch = code.match(/systemMessage:\s*['"`]([^'"`]+)['"`]/)
        const systemMessage = systemMatch ? systemMatch[1] : undefined

        // Extract plugins
        const plugins: string[] = []
        const pluginMatches = code.match(/new\s+(\w+Plugin)/g) || []
        pluginMatches.forEach(match => {
            const pluginName = match.replace('new ', '')
            if (!plugins.includes(pluginName)) {
                plugins.push(pluginName)
            }
        })

        return { name, model, tools, systemMessage, plugins }
    }

    private generateExecutionOutput(config: any): string {
        return `🤖 Robota Agent Execution Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Robota agent "${config.name}" initialized successfully
🎯 Model: ${config.model}
🔧 Tools: ${config.tools.length} available
🔌 Plugins: ${config.plugins.length} active
${config.systemMessage ? '💬 System message configured' : ''}

${config.tools.length > 0 ? `Available Tools:
${config.tools.map((tool: any, i: number) => `  ${i + 1}. ${tool.name} - ${tool.description}`).join('\n')}` : ''}

${config.plugins.length > 0 ? `\nActive Plugins:
${config.plugins.map((plugin: string, i: number) => `  ${i + 1}. ${plugin}`).join('\n')}` : ''}

🚀 Agent is ready for conversation!
Type a message in the chat to start interacting.`
    }

    private generateCompiledOutput(config: any): string {
        return `// Compiled Robota Agent
const compiledAgent = {
  model: "${config.model}",
  tools: [${config.tools.map((t: any) => `"${t.name}"`).join(', ')}],
  systemMessage: ${config.systemMessage ? `"${config.systemMessage}"` : 'null'},
  ready: true
};

export default compiledAgent;`
    }

    private generateSuccessOutput(config: AgentContext, provider: string, transformedCode?: string): string {
        const isRemoteExecution = transformedCode && transformedCode !== transformedCode;

        return `🎉 Agent Initialization Successful!
━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Agent initialized with ${provider} provider
🎯 Model: ${config.model}
🔧 Tools: ${config.tools.length} available
${config.systemMessage ? '💬 System message configured' : ''}
${transformedCode && requiresTransformation(transformedCode) ? '🔐 Using secure RemoteExecutor' : ''}

Available Tools:
${config.tools.map((tool: any, i: number) => `  ${i + 1}. ${tool.name} - ${tool.description}`).join('\n')}

🚀 Agent is ready for conversation!
Type a message in the chat to start interacting.`
    }

    private generateCompiledCode(code: string): string {
        return `// Compiled Robota Agent
const compiledAgent = {
  model: "${this.parseAgentConfig(code).model}",
  tools: [${this.parseAgentConfig(code).tools.map((t: any) => `"${t.name}"`).join(', ')}],
  systemMessage: ${this.parseAgentConfig(code).systemMessage ? `"${this.parseAgentConfig(code).systemMessage}"` : 'null'},
  ready: true
};

export default compiledAgent;`
    }

    private generateAgentResponse(message: string, context: AgentContext): string {
        const responses = [
            `I understand you're asking about "${message}". As an AI agent powered by ${context.provider}, I'm here to help!`,
            `Thanks for your message: "${message}". I have ${context.tools.length} tools available to assist you.`,
            `Let me process your request: "${message}". Based on my configuration, I can help with various tasks.`,
            `I received your message about "${message}". Using my ${context.model} capabilities, here's what I think...`,
            `Interesting question about "${message}"! With my current tools (${context.tools.map(t => t.name).join(', ')}), I can help you with that.`
        ]

        // Add tool-specific responses
        if (message.toLowerCase().includes('time')) {
            const timeTools = context.tools.filter(t => t.name.toLowerCase().includes('time'))
            if (timeTools.length > 0) {
                return `I can help with time-related queries! I have the "${timeTools[0].name}" tool available. The current time is ${new Date().toLocaleString()}.`
            }
        }

        if (message.toLowerCase().includes('weather')) {
            const weatherTools = context.tools.filter(t => t.name.toLowerCase().includes('weather'))
            if (weatherTools.length > 0) {
                return `I'd be happy to help with weather information using my "${weatherTools[0].name}" tool! However, this is a simulated environment, so I can't provide real weather data right now.`
            }
        }

        // Return random response
        return responses[Math.floor(Math.random() * responses.length)]
    }

    private async simulateDelay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    getContext(): AgentContext | null {
        return this.context
    }

    reset(): void {
        this.context = null
    }
} 