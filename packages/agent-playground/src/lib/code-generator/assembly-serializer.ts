import type { IAssemblyState } from './index';
import { getProviderTemplate } from './provider-templates';
import { getSkillById } from '../../skills/catalog';

function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
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
  const permissionMode = state.permissionMode ?? 'bypassPermissions';
  const options: string[] = [providerLine, `  permissionMode: '${permissionMode}',`];

  if (state.agent.systemPrompt) {
    const escaped = escapeTemplateLiteral(state.agent.systemPrompt);
    options.push(`  systemPrompt: \`${escaped}\`,`);
  }

  if (state.maxTurns !== undefined) {
    options.push(`  maxTurns: ${state.maxTurns},`);
  }

  return options;
}

function buildSkillCommandSourceLines(state: IAssemblyState): string[] {
  const skillIds = state.skills ?? [];
  const skills = skillIds
    .map((id) => getSkillById(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (skills.length === 0) return [];

  const skillEntries = skills
    .map((s) => `    { name: '${s.id}', content: \`${escapeTemplateLiteral(s.skillMdContent)}\` },`)
    .join('\n');

  return [
    '  commandModules: [',
    '    {',
    "      name: 'playground-skills',",
    '      commandSources: [',
    '        {',
    "          name: 'skill',",
    '          getCommands() {',
    '            return [',
    ...skills.map(
      (s) =>
        `              { name: '${s.id}', description: '${s.description}', source: 'skill', skillContent: \`${escapeTemplateLiteral(s.skillMdContent)}\` },`,
    ),
    '            ];',
    '          },',
    '        },',
    '      ],',
    '    },',
    '  ],',
  ];
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
  const skillLines = buildSkillCommandSourceLines(state);
  const options = [
    '  cwd: process.cwd(),',
    ...buildCommonOptions(state, providerLine),
    ...skillLines,
  ];

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
