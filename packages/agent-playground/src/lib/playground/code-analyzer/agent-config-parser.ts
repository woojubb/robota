import type { IParsedAgentConfig, IParsedToolConfig } from './types';

export function parseAgentConfig(code: string): IParsedAgentConfig {
  const tools: IParsedToolConfig[] = [];

  const toolMatches =
    code.match(/createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g) ?? [];
  for (const match of toolMatches) {
    const parts = match.match(
      /createFunctionTool\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/,
    );
    if (parts) {
      tools.push({ name: parts[1], description: parts[2] });
    }
  }

  const toolsArrayMatch = code.match(/tools:\s*\[([^\]]+)\]/);
  if (toolsArrayMatch) {
    const toolVariables = toolsArrayMatch[1].match(/\w+Tool/g) ?? [];
    toolVariables.forEach((varName) => {
      const toolName = varName.replace('Tool', '');
      if (!tools.find((tool) => tool.name === toolName)) {
        tools.push({ name: toolName, description: 'Custom tool function' });
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
  const pluginMatches = code.match(/new\s+(\w+Plugin)/g) ?? [];
  pluginMatches.forEach((match) => {
    const pluginName = match.replace('new ', '');
    if (!plugins.includes(pluginName)) {
      plugins.push(pluginName);
    }
  });

  return { name, model, tools, systemMessage, plugins };
}
