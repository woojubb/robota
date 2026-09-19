/**
 * SCREEN-2002 TC-04 — the daltonized built-ins are guarded, not asserted.
 *
 * The claim "a colour-blind user can tell these apart" is measurable, so it is measured: every pair
 * of status colours and the diff pair are simulated for protanopia and deuteranopia and required to
 * stay apart in Lab. The guard's own failure modes are exercised too — a red/green pair must FAIL it,
 * and a value it cannot simulate must FAIL rather than skip, because a guard that quietly passes what
 * it did not check is worse than none.
 */
import { describe, expect, it } from 'vitest';

import { DARK_DALTONIZED_THEME, DARK_THEME, LIGHT_DALTONIZED_THEME } from '../built-in-themes.js';
import { simulate, simulatedDistance, type TColorVision } from '../color-vision.js';

import type { ITuiTheme } from '../theme-contracts.js';

/**
 * The floor, in CIE76 units, measured rather than assumed: the shipped daltonized pairs sit at 56–88
 * under both simulations, and the green/red pair the default theme uses for the same distinction
 * measures 41.7 under protanopia. 50 therefore separates the two with margin on each side. It is an
 * empirical floor for THIS projection, not a published perceptual constant, and is recorded as such.
 */
const MIN_DISTANCE = 50;

const VISIONS: readonly TColorVision[] = ['protanopia', 'deuteranopia'];
const DALTONIZED = [DARK_DALTONIZED_THEME, LIGHT_DALTONIZED_THEME];

/**
 * The pairs whose DIFFERENCE IN COLOUR carries meaning — "this went well" against "this did not",
 * in the three places the product draws that distinction. Other status colours (running, waiting,
 * cancelled, denied) are told apart by their glyph and their word, which is the rule this package
 * has kept since SCREEN-005; requiring them to differ in colour too would be guarding a claim the
 * product does not make.
 */
function meaningfulPairs(theme: ITuiTheme): [string, string, string][] {
  return [
    ['status.success vs status.error', theme.colors.status.success, theme.colors.status.error],
    ['diff added vs removed', theme.markdown.diffAdded, theme.markdown.diffRemoved],
    ['syntax addition vs deletion', theme.syntax.addition, theme.syntax.deletion],
  ];
}

describe('daltonized built-ins survive simulated colour-vision deficiency (SCREEN-2002 TC-04)', () => {
  it.each(
    DALTONIZED.flatMap((theme) => VISIONS.map((vision) => [theme.id, vision, theme] as const)),
  )('%s under %s: every meaningful pair stays apart', (_id, vision, theme) => {
    const tooClose = meaningfulPairs(theme)
      .map(([label, first, second]) => ({
        label,
        distance: simulatedDistance(first, second, vision),
      }))
      // A pair the guard could not simulate is a failure, not a skip — and a NON-FINITE distance is
      // the same hole wearing a number: `NaN < MIN_DISTANCE` is false, so one bad coefficient would
      // turn this guard green for every pair at once.
      .filter((pair) => !Number.isFinite(pair.distance) || (pair.distance ?? 0) < MIN_DISTANCE);
    expect(tooClose).toEqual([]);
  });

  it('discriminates: the green/red pair the default theme uses falls below the floor', () => {
    // The default theme names its colours, and a name resolves in the terminal — so the guard cannot
    // measure it at all, which is itself the refusal it makes. Measured as the hexes a terminal
    // typically renders those names as, the pair falls under the floor for protanopia.
    expect(
      simulatedDistance(
        DARK_THEME.colors.status.success,
        DARK_THEME.colors.status.error,
        'protanopia',
      ),
    ).toBeUndefined();
    const asHex = simulatedDistance('#00a000', '#d00000', 'protanopia');
    expect(asHex).toBeDefined();
    expect(asHex ?? 0).toBeLessThan(MIN_DISTANCE);
  });

  it('refuses a value it cannot simulate rather than passing it', () => {
    expect(simulate('cyan', 'protanopia')).toBeUndefined();
    expect(simulate('ansi256(9)', 'protanopia')).toBeUndefined();
    expect(simulate('#abc', 'protanopia')).toBeDefined();
    expect(simulate('ansi256(22)', 'protanopia')).toBeDefined();
    expect(simulate('rgb(10, 20, 30)', 'deuteranopia')).toBeDefined();
  });
});
