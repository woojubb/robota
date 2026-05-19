import type { IAssemblyState } from './index';
import { getProviderTemplate } from './provider-templates';
import { getSkillById } from '../../skills/catalog';

function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function buildSystemPrompt(state: IAssemblyState): string {
  const skillAdditions = (state.skills ?? [])
    .map((id) => getSkillById(id)?.systemPromptAddition)
    .filter(Boolean) as string[];

  return [state.agent.systemPrompt, ...skillAdditions].filter(Boolean).join('\n\n');
}

function hasSkills(state: IAssemblyState): boolean {
  return (state.skills ?? []).length > 0;
}

function buildProviderParts(state: IAssemblyState): {
  importLine: string;
  providerLine: string;
} {
  const providerTmpl = getProviderTemplate(state.agent.provider);
  return {
    importLine: `import { ${providerTmpl.className} } from '${providerTmpl.importPath}';`,
    providerLine: `  provider: new ${providerTmpl.className}({ apiKey: process.env.${providerTmpl.envKey} }),`,
  };
}

function buildCommonOptions(state: IAssemblyState, providerLine: string): string[] {
  const systemPrompt = buildSystemPrompt(state);
  const permissionMode = state.permissionMode ?? 'bypassPermissions';

  const options: string[] = [providerLine, `  permissionMode: '${permissionMode}',`];

  if (systemPrompt) {
    const escaped = escapeTemplateLiteral(systemPrompt);
    options.push(`  systemPrompt: \`${escaped}\`,`);
  }

  if (state.maxTurns !== undefined) {
    options.push(`  maxTurns: ${state.maxTurns},`);
  }

  return options;
}

// The string literals below are written into generated code files — not executed here.
const GENERATED_CONSOLE_LOG = 'console.log(answer);'; // allow-console: generated template output, not runtime log
const GENERATED_STDOUT_WRITE = "session.on('text_delta', (delta) => process.stdout.write(delta));"; // allow-console: generated template output, not runtime log

function generateCreateQueryCode(state: IAssemblyState): string {
  const { importLine, providerLine } = buildProviderParts(state);
  const options = buildCommonOptions(state, providerLine);

  return [
    `import { createQuery } from '@robota-sdk/agent-framework';`,
    importLine,
    '',
    'const query = createQuery({',
    ...options,
    '});',
    '',
    "const answer = await query('Your message here');",
    GENERATED_CONSOLE_LOG,
  ].join('\n');
}

function generateInteractiveSessionCode(state: IAssemblyState): string {
  const { importLine, providerLine } = buildProviderParts(state);
  const options = ['  cwd: process.cwd(),', ...buildCommonOptions(state, providerLine)];

  return [
    `import { InteractiveSession } from '@robota-sdk/agent-framework';`,
    importLine,
    '',
    'const session = new InteractiveSession({',
    ...options,
    '});',
    '',
    GENERATED_STDOUT_WRITE,
    '',
    "await session.submit('Your message here');",
    'await session.shutdown();',
  ].join('\n');
}

export function serializeToCode(state: IAssemblyState): string {
  if (hasSkills(state)) {
    return generateInteractiveSessionCode(state);
  }
  return generateCreateQueryCode(state);
}
