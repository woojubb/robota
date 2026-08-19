/**
 * INFRA-112 (issue #1904) — deriving what a hook ACCEPTS from its own source.
 *
 * The two cases that matter are the acceptors the first detector missed and the indirect one it
 * could not see, because each would have made the scan report a hook as accepting nothing — and a
 * hook that accepts nothing is a finding, not a quiet zero.
 */

import { describe, expect, it } from 'vitest';

import { acceptedFormsIn, collectAcceptedForms, overrideNamesIn } from '../hook-overrides.mjs';

describe('what a hook accepts, derived from its source', () => {
  it('reads an environment-only hatch as environment', () => {
    const source = 'if [ "${LOCKFILE_CHURN_ACK:-0}" != "1" ]; then refuse; fi';
    expect(acceptedFormsIn(source).LOCKFILE_CHURN_ACK).toEqual({
      environment: true,
      inline: false,
    });
  });

  it('reads a command-string acceptor as inline', () => {
    // The acceptor that the first detector MISSED: a capture group sits between `=1` and the class.
    const source = String.raw`grep -qE '(^|[[:space:]])MERGE_GATE_ACK=1([[:space:]]+x)*[[:space:]]+gh'`;
    expect(acceptedFormsIn(source).MERGE_GATE_ACK).toEqual({ environment: false, inline: true });
  });

  it('follows an indirect acceptor to both forms', () => {
    // `stmt_override` tests `${!token:-0}` AND a statement regex, so the six branch-guard hatches
    // accept both while their names appear beside neither construct.
    const source = 'if ! stmt_override BRANCH_GUARD_ALLOW_DELETE; then refuse; fi';
    expect(acceptedFormsIn(source).BRANCH_GUARD_ALLOW_DELETE).toEqual({
      environment: true,
      inline: true,
    });
  });

  it('names a variable it only mentions, with neither form', () => {
    const source = 'echo "see SOME_OTHER_ACK in the other hook"';
    expect(acceptedFormsIn(source).SOME_OTHER_ACK).toEqual({ environment: false, inline: false });
    expect(overrideNamesIn(source)).toContain('SOME_OTHER_ACK');
  });

  it('counts the hooks it opened, reset per call rather than accumulated', () => {
    const read = () => 'if [ "${A_ACK:-0}" != "1" ]; then :; fi';
    collectAcceptedForms(['one.sh', 'two.sh'], read);
    const second = collectAcceptedForms(['one.sh'], read);
    expect(second.get('A_ACK')?.hooks).toEqual(['one.sh']);
  });
});
