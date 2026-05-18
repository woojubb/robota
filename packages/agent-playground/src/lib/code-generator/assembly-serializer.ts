import type { IAssemblyState } from './index';
import { getProviderTemplate } from './provider-templates';
import { getToolImportEntry } from './tool-import-registry';

function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function buildImports(state: IAssemblyState): string[] {
  const lines: string[] = ["import { Robota } from '@robota-sdk/agent-core';"];

  const providerTmpl = getProviderTemplate(state.agent.provider);
  lines.push(`import { ${providerTmpl.className} } from '${providerTmpl.importPath}';`);

  const toolEntries = state.tools
    .map((id) => ({ id, entry: getToolImportEntry(id) }))
    .filter((t): t is { id: string; entry: NonNullable<ReturnType<typeof getToolImportEntry>> } =>
      Boolean(t.entry),
    );

  const byPath = new Map<string, string[]>();
  for (const { entry } of toolEntries) {
    const names = byPath.get(entry.importPath) ?? [];
    if (!names.includes(entry.factoryName)) names.push(entry.factoryName);
    byPath.set(entry.importPath, names);
  }

  for (const [path, names] of byPath) {
    lines.push(`import { ${names.join(', ')} } from '${path}';`);
  }

  return lines;
}

function buildRobotaOptions(
  state: IAssemblyState,
  providerClassName: string,
  envKey: string,
): string[] {
  const lines: string[] = [
    `  name: 'My Agent',`,
    `  aiProviders: [new ${providerClassName}({ apiKey: process.env.${envKey} })],`,
    `  defaultModel: {`,
    `    provider: '${state.agent.provider}',`,
    `    model: '${state.agent.model}',`,
  ];

  if (state.agent.systemPrompt) {
    const escaped = escapeTemplateLiteral(state.agent.systemPrompt);
    lines.push(`    systemMessage: \`${escaped}\`,`);
  }

  lines.push(`  },`);

  if (state.tools.length > 0) {
    const toolCalls = state.tools
      .map((id) => getToolImportEntry(id))
      .filter(Boolean)
      .map((e) => `${e!.factoryName}()`)
      .join(', ');
    if (toolCalls) lines.push(`  tools: [${toolCalls}],`);
  }

  return lines;
}

// The lines below are string literals that will be written into generated code files.
// They are not executed here — allow-console applies to the generated output, not this module.
const CONSOLE_LOG_LINE = `console.log(response);`; // allow-console: part of generated template, not runtime log

export function serializeToCode(state: IAssemblyState): string {
  const providerTmpl = getProviderTemplate(state.agent.provider);
  const imports = buildImports(state);
  const optionLines = buildRobotaOptions(state, providerTmpl.className, providerTmpl.envKey);

  const parts: string[] = [
    imports.join('\n'),
    '',
    `const robota = new Robota({`,
    ...optionLines,
    `});`,
    '',
    `const response = await robota.run('Your message here');`,
    CONSOLE_LOG_LINE,
    '',
    `await robota.destroy();`,
  ];

  return parts.join('\n');
}
