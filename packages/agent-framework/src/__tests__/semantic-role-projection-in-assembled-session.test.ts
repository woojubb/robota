/**
 * Semantic-role projection as the ASSEMBLED SESSION sees it (ARCH-024, issue #2270).
 *
 * WHY THIS LIVES HERE. These assertions are about what `createSession` composes into a session's
 * system message for a given `commandSemanticRoles` projection. That is agent-framework behaviour
 * end to end — no command module is involved in any assertion below.
 *
 * They previously lived in `packages/agent-command/examples/`, reaching the assembly factory through
 * the package root barrel. That is the only reason `createSession` was ever exported: the export and
 * the scenario arrived in the same commit (2d3b2c028), which also deleted the line recording
 * `createSession()` as internal. Proving a framework property from a consumer package forced a public
 * surface that the 2026-03-26 SDK scope redesign had decided against.
 *
 * Here the factory is reached by relative import, the way `create-session-default-tools.test.ts`,
 * `hook-wiring.test.ts` and `guardrail-registry-reaches-session.test.ts` already do, so the behaviour
 * is pinned without a public export.
 *
 * WHAT STAYS IN agent-command: that the SHIPPED skills/compact/agent modules declare the three roles,
 * and that duplicate role declarations are rejected. Those are facts about that package's modules.
 *
 * The distinguishing property throughout is that a semantic role is carried by an explicit
 * DECLARATION, never inferred from a command's name — so an alternate id gains the behaviour and a
 * coincidentally-named unannotated command does not.
 */

import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { deriveContextCapacityHint } from '../assembly/context-capacity-hint.js';
import { createSession } from '../assembly/create-session.js';
import { SystemCommandExecutor } from '../commands/system-command-executor.js';
import { createContributionSourcesForProjectAccess } from '../contributions/initial-contribution-sources.js';
import { WorkspaceTrustService } from '../workspace-trust/workspace-trust-service.js';

import type { ISystemCommand, ISystemCommandSemanticRoles } from '../command-api/contracts.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '../workspace-trust/types.js';

const CONFIG: IResolvedConfig = {
  defaultTrustLevel: 'moderate',
  provider: { name: 'scripted-test-provider', apiKey: 'offline', model: 'scripted' },
  permissions: { allow: [], deny: [] },
  language: 'en',
  env: {},
};

const TERMINAL = {
  write: () => {},
  writeLine: () => {},
  spinner: () => ({ stop: () => {} }),
};

function command(name: string, semanticRole?: ISystemCommand['semanticRole']): ISystemCommand {
  return {
    name,
    ...(semanticRole ? { semanticRole } : {}),
    description: name,
    modelInvocable: true,
    execute: () => ({ success: true, message: '' }),
  };
}

/** Drives the production authority mint boundary rather than fabricating a trusted access object. */
async function trustedProjectAccess(root: string): Promise<ITrustedWorkspaceProjectAccess> {
  const canonicalRoot = realpathSync(root);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `semantic-role-projection:${canonicalRoot}`,
    displayPath: canonicalRoot,
    worktreeRoot: canonicalRoot,
  };
  const trusted: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(canonicalRoot);
  if (access.status !== 'trusted') throw new Error('workspace grant was not trusted');
  return access;
}

let cwd: string;
/**
 * An EMPTY directory standing in for the user home.
 *
 * `createContributionSourcesForProjectAccess` defaults its second argument to `homedir()`, so
 * without this the suite reads whatever skills the runner happens to have in `~/.claude/skills`.
 * That is not hypothetical: the first version of this file omitted both this and the workspace
 * skill below, and passed on a developer machine with 13 unrelated skills installed while failing
 * on CI, where there are none. The assertions were green for a reason that had nothing to do with
 * the behaviour under test.
 *
 * Isolating it in BOTH directions is the point — host state can neither supply a skill nor
 * withhold one.
 */
let userHome: string;
let projectAccess: ITrustedWorkspaceProjectAccess;
const openSessions: Array<Awaited<ReturnType<typeof createSession>>['session']> = [];

/**
 * The assembled system message for one role projection.
 *
 * `createSession` is async (ARCH-035) and awaiting it is not a style choice: `.session` off an
 * unawaited promise is `undefined`, and the failure then surfaces two frames away as a missing
 * method. INFRA-119 is that bug.
 */
async function assembledSystemMessage(
  commandName: string,
  commandSemanticRoles?: ISystemCommandSemanticRoles,
): Promise<string> {
  const created = await createSession({
    config: CONFIG,
    cwd,
    contributionSources: createContributionSourcesForProjectAccess(projectAccess, userHome),
    context: { agentsMd: '', projectNotesMd: '' },
    terminal: TERMINAL as never,
    provider: createScriptedProvider([]).provider,
    commandDescriptors: [
      {
        name: commandName,
        kind: 'builtin-command',
        description: 'Activate a skill',
        userInvocable: true,
        modelInvocable: true,
      },
    ],
    ...(commandSemanticRoles ? { commandSemanticRoles } : {}),
  });
  openSessions.push(created.session);
  return created.session.getSystemMessage();
}

/** The three alternate ids, none of which matches a built-in command name. */
const ALTERNATE: readonly ISystemCommand[] = [
  command('activate-skill-alt', 'skillActivation'),
  command('reduce-context-alt', 'contextReduction'),
  command('spawn-subagent-alt', 'subagentSpawn'),
];

const rolesFrom = (commands: readonly ISystemCommand[]): ISystemCommandSemanticRoles =>
  // Copied rather than passed through: the executor takes a mutable array, and handing it a
  // `readonly` view would only typecheck by widening the caller's guarantee.
  new SystemCommandExecutor([...commands]).getSemanticRoles();

beforeAll(async () => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'semantic-role-projection-')));
  userHome = realpathSync(mkdtempSync(join(tmpdir(), 'semantic-role-projection-home-')));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'index.ts'), 'export const value = 1;\n');

  // The workspace owns the one skill these assertions are about. Without it every
  // `toContain('## Skills')` below is red on correct code, and every `not.toContain` passes
  // vacuously — which is how a host-supplied skill made this suite look green.
  const skillDir = join(cwd, '.agents', 'skills', 'audit');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    ['---', 'name: audit', 'description: Audit code', '---', 'Audit'].join('\n'),
    'utf8',
  );

  projectAccess = await trustedProjectAccess(cwd);
});

afterAll(async () => {
  for (const session of openSessions.reverse()) {
    await session.shutdown();
  }
  rmSync(cwd, { recursive: true, force: true });
  rmSync(userHome, { recursive: true, force: true });
});

describe('semantic-role projection reaching the assembled session', () => {
  it('an ALTERNATE skillActivation id gains skill metadata, and a coincidental name does not', async () => {
    const alternate = await assembledSystemMessage('activate-skill-alt', {
      skillActivation: 'activate-skill-alt',
    });
    const coincidental = await assembledSystemMessage('skills');

    // The pair is the whole point: the behaviour follows the DECLARATION, not the name. Asserting
    // only the first would pass on an implementation that keyed off the literal name 'skills'.
    expect(alternate).toContain('## Skills');
    expect(coincidental).not.toContain('## Skills');
  });

  it('omitting ONE role removes only that behaviour and leaves the other two', async () => {
    const withoutSkillActivation = rolesFrom(ALTERNATE.slice(1));
    const withoutContextReduction = rolesFrom([ALTERNATE[0]!, ALTERNATE[2]!]);
    const withoutSubagentSpawn = rolesFrom(ALTERNATE.slice(0, 2));

    const [skillOmitted, contextOmitted, spawnOmitted] = await Promise.all([
      assembledSystemMessage('activate-skill-alt', withoutSkillActivation),
      assembledSystemMessage('activate-skill-alt', withoutContextReduction),
      assembledSystemMessage('activate-skill-alt', withoutSubagentSpawn),
    ]);

    // skillActivation omitted → no skill metadata, but contextReduction still resolves its hint.
    expect(skillOmitted).not.toContain('## Skills');
    expect(deriveContextCapacityHint(withoutSkillActivation.contextReduction)).toBe(
      'Run /reduce-context-alt and retry.',
    );

    // contextReduction omitted → no hint, but skill metadata survives.
    expect(contextOmitted).toContain('## Skills');
    expect(deriveContextCapacityHint(withoutContextReduction.contextReduction)).toBeUndefined();

    // subagentSpawn omitted → the other two are untouched.
    expect(spawnOmitted).toContain('## Skills');
    expect(deriveContextCapacityHint(withoutSubagentSpawn.contextReduction)).toBe(
      'Run /reduce-context-alt and retry.',
    );
  });

  it('unannotated commands with built-in names gain nothing', async () => {
    const unannotated = [command('skills'), command('compact'), command('agent')];
    const roles = rolesFrom(unannotated);

    expect(Object.keys(roles)).toHaveLength(0);
    expect(await assembledSystemMessage('skills', roles)).not.toContain('## Skills');
    expect(deriveContextCapacityHint(roles.contextReduction)).toBeUndefined();
  });

  it('a session assembled with NO role projection has every role absent', async () => {
    // The default the factory applies when nothing is threaded through. Absence is explicit here
    // rather than inferred, which is what makes the coincidental-name case above safe.
    const noRoles = await assembledSystemMessage('activate-skill-alt');

    expect(noRoles).not.toContain('## Skills');
    expect(deriveContextCapacityHint(undefined)).toBeUndefined();
  });
});
