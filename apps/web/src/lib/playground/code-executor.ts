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

        try {
            // Step 1: Code validation
            logs.push('🔍 Validating code syntax...')
            const validationResult = this.validateCode(code)
            if (!validationResult.valid) {
                return {
                    success: false,
                    error: validationResult.error,
                    logs,
                    duration: Date.now() - startTime,
                    agentReady: false
                }
            }

            // Step 2: Parse agent configuration
            logs.push('⚙️ Parsing agent configuration...')
            await this.simulateDelay(500)

            const agentConfig = this.parseAgentConfig(code)
            logs.push(`✅ Found agent with ${agentConfig.tools.length} tools`)

            // Step 3: Initialize provider
            logs.push(`🤖 Initializing ${provider} provider...`)
            await this.simulateDelay(1000)
            logs.push(`✅ ${provider} provider ready`)

            // Step 4: Compile agent
            logs.push('🔧 Compiling agent...')
            await this.simulateDelay(800)

            this.context = {
                provider,
                model: agentConfig.model || 'gpt-4',
                tools: agentConfig.tools,
                systemMessage: agentConfig.systemMessage
            }

            logs.push('✅ Agent compiled successfully')
            logs.push(`🎯 Ready to chat with ${this.context.tools.length} available tools`)

            const output = this.generateExecutionOutput(agentConfig)

            return {
                success: true,
                output,
                logs,
                duration: Date.now() - startTime,
                agentReady: true,
                compiledCode: this.generateCompiledOutput(agentConfig)
            }

        } catch (error) {
            logs.push(`❌ Execution failed: ${error}`)
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                logs,
                duration: Date.now() - startTime,
                agentReady: false
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