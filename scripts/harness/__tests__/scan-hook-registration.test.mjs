import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  collectHookRegistrationFindings,
  declaredInvoker,
  registeredHookFiles,
} from '../scan-hook-registration.mjs';

/**
 * ACCEPTANCE CRITERION (written before the scan — INFRA-078).
 *
 * `hooks-have-execution-coverage` proves a hook CAN run. Nothing proved the DEPLOYMENT calls it, so
 * both of these stayed green:
 *
 *   A. a `.claude/hooks/*.sh` file registered to no event — tested, executable, and never fired;
 *   B. a matcher naming a hook file that does not exist — the event fires and nothing happens.
 *
 * The scan FAILS on A and on B, naming the offending file in the message.
 *
 * THE NUANCE, and the reason this is not a one-line glob diff. `revert-detect.sh` is legitimately
 * registered nowhere: `eval-log-stop.sh` shells out to it. An exemption LIST would become the hole —
 * the next unregistered hook gets appended to it and the floor is gone. So the exemption is a
 * DECLARATION the hook itself carries, and the declaration is VERIFIED:
 *
 *   - an unregistered hook with no `# invoked-by:` header FAILS;
 *   - a declared hook whose named caller does not exist FAILS;
 *   - a declared hook whose named caller does not reference it FAILS (the claim is checked against
 *     the caller's body, so a declaration cannot be self-certifying);
 *   - a declaration chain that never lands on a registered hook FAILS (two hooks declaring each
 *     other are both unreached, and each would otherwise excuse the other).
 *
 * WHAT MUST NOT FIRE, pinned as hard as what must. A correctly registered hook produces no finding,
 * and `revert-detect.sh` with its declaration produces no finding — asserted against the REAL tree,
 * not only fixtures, because a floor that fires on correct work is a floor someone switches off.
 *
 * FAIL-CLOSED. `.claude/hooks` or `.claude/settings.json` absent is an ERROR, never a pass, and a
 * run that examined zero hooks or zero matchers is a finding rather than a green — "nothing was
 * examined" must not be able to read as "everything is registered".
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A temp root with `.claude/settings.json` and `.claude/hooks/*.sh`. Never the real tree. */
function fixture({ hooks = {}, settings } = {}) {
  const root = makeTemp('hook-registration-');
  scratch.push(root);
  mkdirSync(path.join(root, '.claude/hooks'), { recursive: true });
  for (const [name, body] of Object.entries(hooks)) {
    writeFileSync(path.join(root, '.claude/hooks', name), body, 'utf8');
  }
  if (settings !== undefined) {
    writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify(settings, null, 2));
  }
  return root;
}

/** The shape of a real registration: one event, one matcher, one command per hook file. */
function settingsFor(event, matcher, files) {
  return {
    hooks: {
      [event]: [
        {
          matcher,
          hooks: files.map((f) => ({
            type: 'command',
            command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${f}`,
          })),
        },
      ],
    },
  };
}

const TRIVIAL = '#!/usr/bin/env bash\nexit 0\n';

describe('scan-hook-registration', () => {
  it('A. FAILS on a hook file that appears in no matcher', () => {
    const root = fixture({
      hooks: { 'wired.sh': TRIVIAL, 'orphan.sh': TRIVIAL },
      settings: settingsFor('PreToolUse', 'Bash', ['wired.sh']),
    });
    const { findings } = collectHookRegistrationFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('orphan.sh');
    expect(findings[0]).toContain('invoked-by');
  });

  it('B. FAILS on a matcher naming a hook file that does not exist', () => {
    const root = fixture({
      hooks: { 'wired.sh': TRIVIAL },
      settings: settingsFor('PreToolUse', 'Bash', ['wired.sh', 'deleted.sh']),
    });
    const { findings } = collectHookRegistrationFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('deleted.sh');
    expect(findings[0]).toContain('PreToolUse');
  });

  it('passes SILENTLY on a correctly registered hook', () => {
    const root = fixture({
      hooks: { 'wired.sh': TRIVIAL },
      settings: settingsFor('PreToolUse', 'Bash', ['wired.sh']),
    });
    const { findings, hooksExamined, matchersExamined } = collectHookRegistrationFindings(root);
    expect(findings).toEqual([]);
    expect(hooksExamined).toBe(1);
    expect(matchersExamined).toBe(1);
  });

  it('accepts an unregistered hook DECLARED as invoked by a registered sibling that calls it', () => {
    const root = fixture({
      hooks: {
        'stop.sh': `#!/usr/bin/env bash\nbash "$HOOK_DIR/helper.sh"\n`,
        'helper.sh': `#!/usr/bin/env bash\n# invoked-by: stop.sh\nexit 0\n`,
      },
      settings: settingsFor('Stop', '', ['stop.sh']),
    });
    expect(collectHookRegistrationFindings(root).findings).toEqual([]);
  });

  it('FAILS a declaration whose named caller does not reference it', () => {
    const root = fixture({
      hooks: {
        'stop.sh': `#!/usr/bin/env bash\nexit 0\n`,
        'helper.sh': `#!/usr/bin/env bash\n# invoked-by: stop.sh\nexit 0\n`,
      },
      settings: settingsFor('Stop', '', ['stop.sh']),
    });
    const { findings } = collectHookRegistrationFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('helper.sh');
    expect(findings[0]).toContain('does not reference');
  });

  it('FAILS a declaration naming a caller that does not exist', () => {
    const root = fixture({
      hooks: {
        'stop.sh': `#!/usr/bin/env bash\nexit 0\n`,
        'helper.sh': `#!/usr/bin/env bash\n# invoked-by: gone.sh\nexit 0\n`,
      },
      settings: settingsFor('Stop', '', ['stop.sh']),
    });
    const { findings } = collectHookRegistrationFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('gone.sh');
    expect(findings[0]).toContain('does not exist');
  });

  it('FAILS a declaration chain that never reaches a registered hook', () => {
    const root = fixture({
      hooks: {
        'wired.sh': TRIVIAL,
        'a.sh': `#!/usr/bin/env bash\n# invoked-by: b.sh\nbash b.sh\n`,
        'b.sh': `#!/usr/bin/env bash\n# invoked-by: a.sh\nbash a.sh\n`,
      },
      settings: settingsFor('Stop', '', ['wired.sh']),
    });
    const { findings } = collectHookRegistrationFindings(root);
    expect(findings).toHaveLength(2);
    expect(findings.join('\n')).toContain('never reaches a registered hook');
  });

  it('is a finding — not a pass — when zero hooks or zero matchers were examined', () => {
    const noHooks = fixture({ hooks: {}, settings: settingsFor('Stop', '', []) });
    const { findings } = collectHookRegistrationFindings(noHooks);
    expect(findings.join('\n')).toContain('examined');
  });

  it('fails closed when .claude/hooks is absent', () => {
    const root = makeTemp('hook-registration-bare-');
    scratch.push(root);
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude/settings.json'), '{}');
    expect(() => collectHookRegistrationFindings(root)).toThrow(/\.claude\/hooks/);
  });

  it('fails closed when .claude/settings.json is absent', () => {
    const root = fixture({ hooks: { 'wired.sh': TRIVIAL } });
    expect(() => collectHookRegistrationFindings(root)).toThrow(/settings\.json/);
  });

  it('reads every event and every matcher, not just the first', () => {
    const root = fixture({
      hooks: { 'a.sh': TRIVIAL, 'b.sh': TRIVIAL },
      settings: {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/a.sh' }] },
          ],
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: '.claude/hooks/b.sh' }] }],
        },
      },
    });
    const { findings, matchersExamined } = collectHookRegistrationFindings(root);
    expect(findings).toEqual([]);
    expect(matchersExamined).toBe(2);
  });

  it('reads an argument-carrying command (task-tracking.sh start) as a registration', () => {
    const root = fixture({
      hooks: { 'task-tracking.sh': TRIVIAL },
      settings: {
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/task-tracking.sh start',
                },
              ],
            },
          ],
        },
      },
    });
    expect(collectHookRegistrationFindings(root).findings).toEqual([]);
  });

  describe('declaredInvoker', () => {
    it('reads the header line', () => {
      expect(declaredInvoker('#!/usr/bin/env bash\n# invoked-by: stop.sh\n')).toBe('stop.sh');
    });
    it('is null when absent', () => {
      expect(declaredInvoker('#!/usr/bin/env bash\necho hi\n')).toBeNull();
    });
    it('does not read a mention buried deep in the body as a header', () => {
      const body = '#!/usr/bin/env bash\n' + 'echo x\n'.repeat(40) + '# invoked-by: stop.sh\n';
      expect(declaredInvoker(body)).toBeNull();
    });
  });

  describe('registeredHookFiles', () => {
    it('is empty for settings with no hooks block', () => {
      expect(registeredHookFiles({}).files.size).toBe(0);
    });
  });

  it('the REAL tree passes with nothing on the findings list', () => {
    const { findings, hooksExamined, matchersExamined } =
      collectHookRegistrationFindings(WORKSPACE_ROOT);
    expect(findings).toEqual([]);
    expect(hooksExamined).toBeGreaterThan(0);
    expect(matchersExamined).toBeGreaterThan(0);
  });
});

describe('a declaration is verified against an INVOCATION, not a mention', () => {
  // The class this repository keeps meeting: a name present in a file is not the same as a file
  // that runs it. `eval-log-stop.sh` really does `bash "$HOOK_DIR/revert-detect.sh"`; a comment
  // saying "revert-detect.sh is related" would satisfy a substring test just as well, and then a
  // hook nothing calls would carry a declaration that certified itself through a sibling's prose.
  it('refuses a caller that only NAMES the declarer', () => {
    const root = fixture({
      settings: { hooks: { Stop: [{ hooks: [{ command: '.claude/hooks/caller.sh' }] }] } },
      hooks: {
        'caller.sh': '#!/bin/bash\n# related: helper.sh does the parsing\necho hi\n',
        'helper.sh': '#!/bin/bash\n# invoked-by: caller.sh\necho hi\n',
      },
    });

    const { findings } = collectHookRegistrationFindings(root);

    expect(
      findings.map((f) => String(f)),
      'a mention in a comment certified a hook nothing runs',
    ).toHaveLength(1);
  });

  it('accepts a caller that actually spawns it', () => {
    const root = fixture({
      settings: { hooks: { Stop: [{ hooks: [{ command: '.claude/hooks/caller.sh' }] }] } },
      hooks: {
        'caller.sh': '#!/bin/bash\nbash "$HOOK_DIR/helper.sh"\n',
        'helper.sh': '#!/bin/bash\n# invoked-by: caller.sh\necho hi\n',
      },
    });

    expect(collectHookRegistrationFindings(root).findings).toEqual([]);
  });
});
