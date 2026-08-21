/**
 * The license gate says which part of the dependency graph it judges (issue #1951).
 *
 * `actions/dependency-review-action` defaults `fail-on-scopes` to `runtime` alone. A workflow that
 * sets no override therefore exempts every development-scoped package from the license allow-list
 * whatever its license is — and the empty `Licenses` group that produces reads exactly like
 * "evaluated and allowed". Measured on PR #1950: the same package at the same version under
 * `devDependencies` produced an empty group and SUCCESS, and under `dependencies` produced
 * `GPL-3.0-only` and FAILURE.
 *
 * That is a green trusted for more than it measures, and it is the reason INFRA-047's Test Plan
 * specified a case that could not fail. The narrower policy is defensible; leaving it unsaid is not.
 * So this asserts the DECLARATION, not one particular policy: an inherited default is what this
 * file exists to stop, and a future owner narrowing the scope on purpose edits the expectation here
 * along with the workflow, which is the visible decision the item asked for.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOW_RELATIVE = '.github/workflows/dependency-review.yml';
const WORKFLOW = readFileSync(path.join(ROOT, WORKFLOW_RELATIVE), 'utf8');

/** The `with:` value of one input on the dependency-review step, or null when it is not set. */
function stepInput(name) {
  const match = new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm').exec(WORKFLOW);
  return match ? match[1] : null;
}

describe('the license gate declares the scope it judges', () => {
  it('sets fail-on-scopes rather than inheriting the action default', () => {
    expect(
      stepInput('fail-on-scopes'),
      `${WORKFLOW_RELATIVE} must declare fail-on-scopes`,
    ).not.toBe(null);
  });

  it('judges development dependencies as well as runtime ones', () => {
    // Measured before extending: of the 668 packages in `pnpm licenses list --dev` and absent from
    // `--prod`, ZERO fall outside the allow-list. Six of the seven that are not literal matches are
    // `OR` expressions whose every leaf is listed, and the seventh is MIT by its LICENSE file.
    const scopes = (stepInput('fail-on-scopes') ?? '').split(',').map((s) => s.trim());
    expect(scopes).toContain('runtime');
    expect(scopes).toContain('development');
  });

  it('still states the allow-list the scope is evaluated against', () => {
    // A scope with no list behind it judges nothing. These are one setting in two halves, and a
    // change that dropped either would leave the other reading as a working gate.
    expect(stepInput('allow-licenses')).toContain('MIT');
  });
});
