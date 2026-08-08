import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Guard property 6 — when a guard's enumeration is incomplete, which way does it fail?
 *
 * A guard that decides by a list of RECOGNISED inputs answers "not my business" to everything the
 * list forgot, and that answer is silent. A guard that decides by a list of EXCLUDED inputs answers
 * "mine" instead, so a mistake becomes a refusal someone sees, argues with, and fixes.
 *
 * The two directions are not equally wrong, which is why this is a floor and not a preference. A
 * silent pass is discovered by the incident it failed to prevent. A wrong refusal is discovered by
 * the next person who runs the command, and it has an override.
 *
 * Measured: one guard widened by an allowlist of flag tokens leaked THREE separate bypasses in a
 * single change — a flag the list omitted, the `=` form of a flag it contained, and bundled short
 * options — each a silent pass, each found by review rather than by the guard. Adding the missing
 * tokens would have been the fourth attempt at the same mistake.
 *
 * ## What this asserts, and what it deliberately does not
 *
 * It does NOT try to decide from source whether a given regex is an allowlist. That reading is not
 * decidable, and a check that guesses would fire on correct guards — the failure that gets a floor
 * suppressed rather than fixed.
 *
 * It asserts the thing that IS decidable: every hook that judges has written down which way it
 * fails, in one declaration a reader can find and a reviewer can disagree with. A guard whose author
 * never had to answer the question is the one that answers it by accident.
 */
// The declaration and its CONTINUATION lines. `[^\n]*` alone read only the first line, so the
// reason assertion below judged a wrapped rationale by its opening words — a hook whose first line
// was terse and whose argument lived on line two would have passed as argued-for. Review found it.
// A continuation is a following comment line that is not itself a new sentence-opening marker:
// blank comment lines end the declaration, matching how the five hooks actually wrap.
const DECLARATION = /fail-direction:\s*(refuse|permit)\b[^\n]*(?:\n#[ \t]+[^\n]+)*/;

const JUDGING_HOOKS = readdirSync(HOOKS_DIR)
  .filter((name) => name.endsWith('.sh'))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(HOOKS_DIR, name), 'utf8') }))
  // A hook that never prints `Blocked:` decides nothing, so it has no direction to fail in. The same
  // population `guards-fail-closed` and `guards-pass-silently` use, read the same way — from the
  // file system, so a hook added tomorrow is covered without anyone remembering to list it.
  .filter((hook) => hook.text.includes('Blocked:'));

describe('every judging guard declares which way its enumeration fails', () => {
  it('has a population to judge at all', () => {
    // Fail closed. A filter that matched nothing would make every assertion below vacuous, and this
    // file would pass loudest at the moment it covered nothing.
    console.log(`::examined:: ${JUDGING_HOOKS.length} judging hooks`);
    expect(JUDGING_HOOKS.length).toBeGreaterThan(0);
  });

  for (const hook of JUDGING_HOOKS) {
    it(`${hook.name} says whether an unrecognised input is refused or permitted`, () => {
      const declaration = DECLARATION.exec(hook.text);

      expect(
        declaration,
        `${hook.name} judges commands but never says what it does with a shape it does not ` +
          'recognise. Add one line — `fail-direction: refuse — <why>` or ' +
          '`fail-direction: permit — <why>` — where the classification happens.',
      ).not.toBeNull();
    });

    it(`${hook.name} gives a reason for the direction it chose`, () => {
      // `permit` is a legitimate answer for a guard whose subject is narrow and whose false
      // refusals would be worse than its misses. It is legitimate BECAUSE it was argued for; a bare
      // token would make the declaration a formality, which is how a field becomes a box to tick.
      const declaration = DECLARATION.exec(hook.text);
      const reason = (declaration?.[0] ?? '').replace(/fail-direction:\s*(refuse|permit)\b/, '');

      expect(
        reason.replace(/[^A-Za-z0-9]/g, '').length,
        `${hook.name} declares a direction with no reason behind it`,
      ).toBeGreaterThan(10);
    });
  }
});
