/**
 * ARCH-029: the two literals both command-axis doubles read.
 *
 * They live here rather than in either file because the doubles were split by contract axis and
 * these belong to neither: a shared placeholder timestamp, and the fake execution root. Duplicating
 * them would let the two doubles drift on the one thing they must agree about.
 */

/** A timestamp meaning "this never happened". */
export const NEVER = '1970-01-01T00:00:00.000Z';

/**
 * The root every default cwd hangs off. Deliberately NOT under the shared temp directory: SEC-003's
 * floor treats a hardcoded shared-temp literal as a CWE-377 taint source, and it is right to — the
 * cwd is handed to the production code under test, which may write through it. This path does not
 * exist, so a test that actually writes fails loudly instead of succeeding quietly somewhere world-
 * writable.
 */
export const FAKE_ROOT = '/robota-test-command-host';
