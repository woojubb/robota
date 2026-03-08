/**
 * Code analysis and validation utilities for CodeExecutor
 */

import type { IErrorInfo } from './code-executor-types';

const MAX_SYNTAX_WARNINGS = 3;

export function analyzeCode(code: string): { errors: IErrorInfo[], warnings: IErrorInfo[] } {
    const errors: IErrorInfo[] = [];
    const warnings: IErrorInfo[] = [];
    const lines = code.split('\n');

    checkSyntax(code, lines, errors, warnings);
    checkImports(code, errors, warnings);
    checkAgentConfig(code, errors, warnings);
    checkEnvironmentUsage(code, warnings);

    return { errors, warnings };
}

function checkSyntax(code: string, lines: string[], errors: IErrorInfo[], warnings: IErrorInfo[]) {
    if (code.includes('import') && !code.includes('from')) {
        const importLine = lines.findIndex(line => line.includes('import') && !line.includes('from'));
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
            });
        }
    }

    const openBrackets = (code.match(/\{/g) || []).length;
    const closeBrackets = (code.match(/\}/g) || []).length;
    if (openBrackets !== closeBrackets) {
        errors.push({
            type: 'syntax',
            severity: 'error',
            message: 'Mismatched brackets - missing closing bracket',
            suggestions: ['Check for missing } brackets', 'Ensure proper code block structure', 'Use an IDE with bracket matching']
        });
    }

    const missingSemicolonLines = lines
        .map((line, index) => ({ line: line.trim(), index }))
        .filter(({ line }) =>
            line.length > 0 &&
            !line.endsWith(';') &&
            !line.endsWith('{') &&
            !line.endsWith('}') &&
            !line.startsWith('//') &&
            !line.startsWith('import') &&
            !line.startsWith('export') &&
            line.includes('=')
        );

    missingSemicolonLines.slice(0, MAX_SYNTAX_WARNINGS).forEach(({ line, index }) => {
        warnings.push({
            type: 'syntax',
            severity: 'warning',
            message: 'Missing semicolon',
            line: index + 1,
            code: line,
            suggestions: ['Add semicolon at the end of the statement']
        });
    });
}

function checkImports(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]) {
    if (!code.includes('Robota') && !code.includes('from \'@robota-sdk/agents\'')) {
        errors.push({
            type: 'import', severity: 'error',
            message: 'Missing Robota import from @robota-sdk/agents', line: 1,
            suggestions: ['Add: import { Robota } from \'@robota-sdk/agents\'', 'Install package: npm install @robota-sdk/agents'],
            documentation: 'https://robota.dev/docs/agents'
        });
    }

    if (code.includes('new OpenAI(') && !code.includes('import OpenAI from \'openai\'')) {
        errors.push({
            type: 'import', severity: 'error',
            message: 'Missing OpenAI client import',
            suggestions: ['Add: import OpenAI from \'openai\'', 'Install package: npm install openai']
        });
    }

    checkProviderImport(code, 'OpenAIProvider', '@robota-sdk/openai', errors);
    checkProviderImport(code, 'AnthropicProvider', '@robota-sdk/anthropic', errors);
    checkProviderImport(code, 'GoogleProvider', '@robota-sdk/google', errors);

    if (code.includes('createFunctionTool') && !code.includes('from \'@robota-sdk/agents\'')) {
        warnings.push({
            type: 'import', severity: 'warning',
            message: 'createFunctionTool should be imported from @robota-sdk/agents',
            suggestions: ['Add createFunctionTool to import: import { Robota, createFunctionTool } from \'@robota-sdk/agents\'']
        });
    }

    const pluginNames = ['LoggingPlugin', 'UsagePlugin', 'PerformancePlugin'];
    pluginNames.forEach(pluginName => {
        if (code.includes(pluginName) && !code.includes('from \'@robota-sdk/agents\'')) {
            warnings.push({
                type: 'import', severity: 'warning',
                message: `${pluginName} should be imported from @robota-sdk/agents`,
                suggestions: [`Add ${pluginName} to import: import { Robota, ${pluginName} } from '@robota-sdk/agents'`]
            });
        }
    });
}

function checkProviderImport(code: string, providerName: string, packageName: string, errors: IErrorInfo[]) {
    if (code.includes(providerName) && !code.includes(`from '${packageName}'`)) {
        errors.push({
            type: 'import', severity: 'error',
            message: `Missing ${providerName} import`,
            suggestions: [
                `Add: import { ${providerName} } from '${packageName}'`,
                `Install package: npm install ${packageName}`
            ]
        });
    }
}

function checkAgentConfig(code: string, errors: IErrorInfo[], warnings: IErrorInfo[]) {
    if (!code.includes('new Robota(')) {
        errors.push({
            type: 'configuration', severity: 'error',
            message: 'No Robota instance found',
            suggestions: [
                'Create agent: const robota = new Robota({ name: "MyAgent", aiProviders: [...], defaultModel: {...} })',
                'Check Robota configuration syntax'
            ],
            documentation: 'https://robota.dev/docs/agents/configuration'
        });
        return;
    }

    if (!code.includes('aiProviders:')) {
        errors.push({
            type: 'configuration', severity: 'error',
            message: 'Missing aiProviders configuration',
            suggestions: ['Add aiProviders to Robota config', 'Example: aiProviders: [new OpenAIProvider({ apiKey: "your-api-key" })]']
        });
    }

    if (!code.includes('defaultModel:')) {
        errors.push({
            type: 'configuration', severity: 'error',
            message: 'Missing defaultModel configuration',
            suggestions: ['Add defaultModel to Robota config', 'Example: defaultModel: { provider: "openai", model: "gpt-3.5-turbo" }']
        });
    }

    if (!code.includes('name:')) {
        warnings.push({
            type: 'configuration', severity: 'warning',
            message: 'Missing agent name',
            suggestions: ['Add name to Robota config', 'Example: name: "MyAgent"']
        });
    }

    if (!code.includes('destroy()') && !code.includes('await robota.destroy()')) {
        warnings.push({
            type: 'configuration', severity: 'warning',
            message: 'Missing cleanup call',
            suggestions: ['Add cleanup: await robota.destroy()', 'Call destroy() to properly clean up resources']
        });
    }
}

function checkEnvironmentUsage(code: string, warnings: IErrorInfo[]) {
    const envVarPattern = /process\.env\.(\w+)/g;
    const envVars: string[] = [];
    let match;

    while ((match = envVarPattern.exec(code)) !== null) {
        envVars.push(match[1]);
    }

    envVars.forEach(envVar => {
        warnings.push({
            type: 'configuration', severity: 'info',
            message: `Environment variable ${envVar} is used`,
            suggestions: [`Set ${envVar} in your environment`, 'Create .env file with your API keys', 'Check environment variable configuration']
        });
    });
}

export function validateEnvironment(provider: string): { errors: IErrorInfo[], warnings: IErrorInfo[] } {
    const errors: IErrorInfo[] = [];
    const warnings: IErrorInfo[] = [];

    const commonEnvVars: Record<string, string[]> = {
        openai: ['OPENAI_API_KEY'],
        anthropic: ['ANTHROPIC_API_KEY'],
        google: ['GOOGLE_API_KEY']
    };

    const requiredVars = commonEnvVars[provider] || [];
    requiredVars.forEach(envVar => {
        warnings.push({
            type: 'configuration', severity: 'warning',
            message: `${envVar} should be set in environment`,
            suggestions: [`Add ${envVar}=your_key_here to .env file`, 'Check API key configuration', 'Verify environment variables are loaded'],
            documentation: `https://robota.dev/docs/providers/${provider}`
        });
    });

    return { errors, warnings };
}

export function parseAgentConfig(code: string): {
    name: string
    model: string
    tools: Array<{ name: string; description: string }>
    systemMessage?: string
    plugins: string[]
} {
    const tools: Array<{ name: string; description: string }> = [];

    const toolMatches = code.match(/createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g) || [];
    for (const match of toolMatches) {
        const parts = match.match(/createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/);
        if (parts) {
            tools.push({ name: parts[1], description: parts[2] });
        }
    }

    const toolsArrayMatch = code.match(/tools:\s*\[([^\]]+)\]/);
    if (toolsArrayMatch) {
        const toolVariables = toolsArrayMatch[1].match(/\w+Tool/g) || [];
        toolVariables.forEach(varName => {
            if (!tools.find(t => t.name === varName.replace('Tool', ''))) {
                tools.push({ name: varName.replace('Tool', ''), description: 'Custom tool function' });
            }
        });
    }

    const nameMatch = code.match(/name:\s*['"`]([^'"`]+)['"`]/);
    const name = nameMatch ? nameMatch[1] : 'UnnamedAgent';

    const modelMatch = code.match(/model:\s*['"`]([^'"`]+)['"`]/);
    const model = modelMatch ? modelMatch[1] : 'gpt-3.5-turbo';

    const systemMatch = code.match(/systemMessage:\s*['"`]([^'"`]+)['"`]/);
    const systemMessage = systemMatch ? systemMatch[1] : undefined;

    const plugins: string[] = [];
    const pluginMatches = code.match(/new\s+(\w+Plugin)/g) || [];
    pluginMatches.forEach(match => {
        const pluginName = match.replace('new ', '');
        if (!plugins.includes(pluginName)) {
            plugins.push(pluginName);
        }
    });

    return { name, model, tools, systemMessage, plugins };
}
