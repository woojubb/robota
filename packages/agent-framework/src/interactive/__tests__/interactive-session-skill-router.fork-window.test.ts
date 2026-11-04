import { describe, expect, it, vi } from 'vitest';

import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { stubSubmit } from './helpers/session-stub.js';

import type { ICommand } from '../../command-api/types.js';
import type { ISkillActivationEvent } from '../../commands/skill-activation-events.js';
import type { IFrameworkHost } from '../../host/framework-host.js';
import type { ISkillResource } from '@robota-sdk/agent-interface-command';

/**
 * A forked skill's resources are readable only from inside that fork. The window that says so follows
 * the fork's own calls, which takes the host's `createAsyncScope`. With one (the Node host) every
 * read below is answered by the call chain it comes from; without one the fork is refused before it
 * starts, so there is no window for a sibling or a background task to read.
 */
const withScope = createTestFrameworkHost().createAsyncScope;
const withoutScope: IFrameworkHost['createAsyncScope'] = undefined;

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** A lazily loaded skill with one supporting resource whose bytes name the skill. */
function resourceSkill(name: string, extra: Partial<ICommand> = {}) {
  const uri = `skill://${name}/reference.txt`;
  const activation = {
    content: `workflow of ${name}`,
    resources: {
      manifest: [{ uri, digest: 'sha256:verified', size: 24 }],
      read: vi.fn(async (requested: string) => ({
        uri: requested,
        text: `bytes of ${name}`,
        digest: 'sha256:verified',
        size: 24,
      })),
    },
    validate: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const acquire = vi.fn(async (_signal?: AbortSignal) => activation);
  const skill: ICommand = {
    ...extra,
    name,
    source: 'host-skill',
    description: name,
    skillContentLoader: { acquire },
  };
  return { skill, uri, acquire, activation };
}

/** What a read answered: the bytes, or the refusal's words. */
async function outcome(read: () => Promise<ISkillResource>): Promise<string> {
  try {
    return (await read()).text ?? '';
  } catch (error) {
    return `refused: ${(error as Error).message}`;
  }
}

function makeRouter(
  createAsyncScope: IFrameworkHost['createAsyncScope'],
  forks: Record<string, () => Promise<string>> = {},
) {
  const activations: ISkillActivationEvent[] = [];
  const runFork = vi.fn(async (content: string) => {
    // The fork is handed the skill's own content, which names the skill.
    const name = Object.keys(forks).find((candidate) =>
      content.includes(`workflow of ${candidate}`),
    );
    return name === undefined ? '' : forks[name]!();
  });
  let router!: SessionSkillRouter;
  const onForkSkill = vi.fn(async (skill, args, _display, qualifiedName, invocation, signal) =>
    router.executeSkillWithActivation(skill, args, invocation, qualifiedName, signal),
  );
  router = new SessionSkillRouter(
    [],
    [],
    [],
    undefined,
    () => createTestCommandHost(),
    () => 'session',
    stubSubmit,
    async () => undefined,
    (event) => activations.push(event),
    runFork,
    onForkSkill,
    (execute) => execute(),
    createAsyncScope,
  );
  return { router, runFork, onForkSkill, activations };
}

describe('SessionSkillRouter fork resource window on a host with an async scope', () => {
  it('answers each read from the call chain it comes from, with a sibling and a second fork running', async () => {
    const parent = resourceSkill('parent');
    const sibling = resourceSkill('sibling');
    // The user's fork a background task would like to read; the model may not invoke it.
    const forkA = resourceSkill('forkA', { context: 'fork', disableModelInvocation: true });
    const forkB = resourceSkill('forkB', { context: 'fork' });
    const aStarted = gate();
    const bStarted = gate();
    const release = gate();
    const inFork: Record<string, string> = {};
    // eslint-disable-next-line prefer-const -- the forks read through the router they run in
    let fixture: ReturnType<typeof makeRouter>;
    fixture = makeRouter(withScope, {
      forkA: async () => {
        aStarted.open();
        await release.wait;
        inFork['readsForkB'] = await outcome(() =>
          fixture.router.readSkillResource('forkB', forkB.uri),
        );
        inFork['readsSibling'] = await outcome(() =>
          fixture.router.readSkillResource('sibling', sibling.uri),
        );
        inFork['readsOwnAfterBStarted'] = await outcome(() =>
          fixture.router.readSkillResource('forkA', forkA.uri),
        );
        return 'a done';
      },
      forkB: async () => {
        bStarted.open();
        await release.wait;
        return 'b done';
      },
    });
    const { router } = fixture;

    router.beginTurnSkillActivation('parent-turn');
    await router.executeSkillWithActivation(parent.skill, '', 'model-tool');
    const runA = router.executeSkillWithActivation(forkA.skill, '', 'model-tool');
    await aStarted.wait;
    const runB = router.executeSkillWithActivation(forkB.skill, '', 'model-tool');
    await bStarted.wait;

    // A sibling in the parent's turn, and a background read, are outside both forks.
    const siblingReadsForkA = await outcome(() => router.readSkillResource('forkA', forkA.uri));
    // A sibling activating a skill while the forks run binds it to the parent's turn, not to a fork.
    await router.executeSkillWithActivation(sibling.skill, '', 'model-tool');
    const siblingReadsOwn = await outcome(() => router.readSkillResource('sibling', sibling.uri));
    release.open();
    await Promise.all([runA, runB]);

    expect(siblingReadsForkA).toBe('refused: No active supporting resources for skill: forkA');
    expect(siblingReadsOwn).toBe('bytes of sibling');
    expect(inFork).toEqual({
      readsForkB: 'refused: No active supporting resources for skill: forkB',
      readsSibling: 'refused: No active supporting resources for skill: sibling',
      readsOwnAfterBStarted: 'bytes of forkA',
    });
    router.endTurnSkillActivation('parent-turn');
  });
});

describe('SessionSkillRouter fork resource window on a host without an async scope', () => {
  const REFUSAL = /`createAsyncScope`/;

  it('refuses a forked skill before anything starts, for a model and for a user, in one fixed message', async () => {
    const forkA = resourceSkill('forkA', { context: 'fork', disableModelInvocation: true });
    const { router, runFork, onForkSkill, activations } = makeRouter(withoutScope, {
      forkA: async () => 'never',
    });
    router.beginTurnSkillActivation('turn');

    const byModel = await router
      .executeSkillWithActivation(forkA.skill, '', 'model-tool')
      .catch((error: Error) => error);
    const byUser = await router
      .executeUserResolvedSkillCommand(forkA.skill, '', 'forkA', '/forkA', 'user-slash')
      .catch((error: Error) => error);

    expect(byModel).toBeInstanceOf(Error);
    expect((byModel as Error).message).toMatch(REFUSAL);
    expect((byUser as Error).message).toBe((byModel as Error).message);
    // Nothing started: no content was acquired, no fork ran, nothing was reported as activated.
    expect(forkA.acquire).not.toHaveBeenCalled();
    expect(runFork).not.toHaveBeenCalled();
    expect(onForkSkill).not.toHaveBeenCalled();
    expect(activations).toEqual([]);
    router.endTurnSkillActivation('turn');
  });

  it('has no fork window for a sibling or a background task to read, and never binds a skill to a fork', async () => {
    const parent = resourceSkill('parent');
    const sibling = resourceSkill('sibling');
    const forkA = resourceSkill('forkA', { context: 'fork', disableModelInvocation: true });
    const { router } = makeRouter(withoutScope, { forkA: async () => 'never' });
    router.beginTurnSkillActivation('turn');
    await router.executeSkillWithActivation(parent.skill, '', 'model-tool');

    await expect(router.executeSkillWithActivation(forkA.skill, '', 'model-tool')).rejects.toThrow(
      REFUSAL,
    );
    // The fork's resources are not readable from anywhere, and a skill a sibling activates is the turn's.
    expect(await outcome(() => router.readSkillResource('forkA', forkA.uri))).toBe(
      'refused: No active supporting resources for skill: forkA',
    );
    await router.executeSkillWithActivation(sibling.skill, '', 'model-tool');
    expect(await outcome(() => router.readSkillResource('sibling', sibling.uri))).toBe(
      'bytes of sibling',
    );
    expect(await outcome(() => router.readSkillResource('parent', parent.uri))).toBe(
      'bytes of parent',
    );
    router.endTurnSkillActivation('turn');
    expect(await outcome(() => router.readSkillResource('sibling', sibling.uri))).toMatch(
      /^refused: /,
    );
  });

  it('still runs a skill that does not fork', async () => {
    const plain = resourceSkill('plain');
    const { router, activations } = makeRouter(withoutScope);
    router.beginTurnSkillActivation('turn');
    const result = await router.executeSkillWithActivation(plain.skill, '', 'model-tool');
    expect(result.mode).toBe('inject');
    expect(activations.map((event) => event.status)).toEqual(['started', 'completed']);
    router.endTurnSkillActivation('turn');
  });
});
