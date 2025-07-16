/**
 * Code execution engine for the Robota Playground
 * Simulates running Robota agent code and provides realistic results
 */

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

    async executeCode(code: string, provider: string): Promise<ExecutionResult> {
        const startTime = Date.now()
        const logs: string[] = []
        const errors: ErrorInfo[] = []
        const warnings: ErrorInfo[] = []

        try {
            // Step 1: Code validation and analysis
            logs.push('🔍 Analyzing code structure...')
            const analysisResult = this.analyzeCode(code)

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

            const agentConfig = this.parseAgentConfig(code)
            logs.push(`✅ Found agent with ${agentConfig.tools.length} tools`)

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
            logs.push(`✅ Agent initialized with ${provider}`)

            // Step 6: Test basic functionality
            logs.push('🧪 Running health checks...')
            await this.simulateDelay(400)
            logs.push('✅ All systems operational')

            this.context = { ...agentConfig, provider }

            return {
                success: true,
                output: this.generateSuccessOutput({ ...agentConfig, provider }, provider),
                logs,
                duration: Date.now() - startTime,
                agentReady: true,
                compiledCode: this.generateCompiledCode(code),
                errors,
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
            { package: '@robota/agents', export: 'Agent' },
            { package: '@robota/openai', export: 'OpenAIProvider' },
            { package: '@robota/anthropic', export: 'AnthropicProvider' },
            { package: '@robota/google', export: 'GoogleProvider' }
        ]

        // Check if Agent is imported
        if (!code.includes('Agent')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing Agent import from @robota/agents',
                line: 1,
                suggestions: [
                    'Add: import { Agent } from \'@robota/agents\'',
                    'Install package: npm install @robota/agents'
                ],
                documentation: 'https://robota.dev/docs/agents'
            })
        }

        // Check provider imports based on usage
        if (code.includes('OpenAIProvider') && !code.includes('from \'@robota/openai\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing OpenAIProvider import',
                suggestions: [
                    'Add: import { OpenAIProvider } from \'@robota/openai\'',
                    'Install package: npm install @robota/openai'
                ]
            })
        }

        if (code.includes('AnthropicProvider') && !code.includes('from \'@robota/anthropic\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing AnthropicProvider import',
                suggestions: [
                    'Add: import { AnthropicProvider } from \'@robota/anthropic\'',
                    'Install package: npm install @robota/anthropic'
                ]
            })
        }

        if (code.includes('GoogleProvider') && !code.includes('from \'@robota/google\'')) {
            errors.push({
                type: 'import',
                severity: 'error',
                message: 'Missing GoogleProvider import',
                suggestions: [
                    'Add: import { GoogleProvider } from \'@robota/google\'',
                    'Install package: npm install @robota/google'
                ]
            })
        }
    }

    private checkAgentConfig(code: string, lines: string[], errors: ErrorInfo[], warnings: ErrorInfo[]) {
        // Check if Agent is instantiated
        if (!code.includes('new Agent(')) {
            errors.push({
                type: 'configuration',
                severity: 'error',
                message: 'No Agent instance found',
                suggestions: [
                    'Create agent: const agent = new Agent({ provider: ... })',
                    'Check agent configuration syntax'
                ],
                documentation: 'https://robota.dev/docs/agents/configuration'
            })
            return
        }

        // Check if provider is configured
        if (!code.includes('provider:')) {
            errors.push({
                type: 'configuration',
                severity: 'error',
                message: 'Missing provider configuration',
                suggestions: [
                    'Add provider to agent config',
                    'Example: provider: new OpenAIProvider({ apiKey: ... })'
                ]
            })
        }

        // Check for export default
        if (!code.includes('export default')) {
            warnings.push({
                type: 'configuration',
                severity: 'warning',
                message: 'Missing export default statement',
                suggestions: [
                    'Add: export default agent',
                    'Export your agent for use in other modules'
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

        if (!code.includes('Agent')) {
            return { valid: false, error: 'Code must include an Agent instance' }
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
        model: string
        tools: Array<{ name: string; description: string }>
        systemMessage?: string
    } {
        const tools: Array<{ name: string; description: string }> = []

        // Extract tools from addTool calls
        const toolMatches = code.match(/addTool\s*\(\s*{[^}]+}/g) || []
        for (const match of toolMatches) {
            const nameMatch = match.match(/name:\s*['"`]([^'"`]+)['"`]/)
            const descMatch = match.match(/description:\s*['"`]([^'"`]+)['"`]/)

            if (nameMatch && descMatch) {
                tools.push({
                    name: nameMatch[1],
                    description: descMatch[1]
                })
            }
        }

        // Extract model
        const modelMatch = code.match(/model:\s*['"`]([^'"`]+)['"`]/)
        const model = modelMatch ? modelMatch[1] : 'gpt-4'

        // Extract system message
        const systemMatch = code.match(/setSystemMessage\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)/)
        const systemMessage = systemMatch ? systemMatch[1] : undefined

        return { model, tools, systemMessage }
    }

    private generateExecutionOutput(config: any): string {
        return `🤖 Agent Execution Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Agent initialized successfully
🎯 Model: ${config.model}
🔧 Tools: ${config.tools.length} available
${config.systemMessage ? '💬 System message configured' : ''}

Available Tools:
${config.tools.map((tool: any, i: number) => `  ${i + 1}. ${tool.name} - ${tool.description}`).join('\n')}

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

    private generateSuccessOutput(config: AgentContext, provider: string): string {
        return `🎉 Agent Initialization Successful!
━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Agent initialized with ${provider} provider
🎯 Model: ${config.model}
🔧 Tools: ${config.tools.length} available
${config.systemMessage ? '💬 System message configured' : ''}

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