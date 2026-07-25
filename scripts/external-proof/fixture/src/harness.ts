/**
 * A tiny, dependency-free assertion harness. The external consumer deliberately does NOT install
 * vitest or any Robota test utility — it must prove the RUNTIME surface works with nothing but the
 * published packages, exactly as a third party would have.
 */

let passed = 0;
const failures: string[] = [];

export function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`    ok  ${label}\n`);
    return;
  }
  failures.push(label);
  process.stdout.write(`    FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}\n`);
}

export function checkEqual(label: string, actual: unknown, expected: unknown): void {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  check(label, actualText === expectedText, `expected ${expectedText}, got ${actualText}`);
}

/** Assert a call throws, and that the message matches — the rejection channel must be observable. */
export function checkThrows(label: string, fn: () => unknown, expected: RegExp): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, expected.test(message), `message was: ${message}`);
    return;
  }
  check(label, false, 'did not throw');
}

export function section(title: string): void {
  process.stdout.write(`\n  ${title}\n`);
}

export function mode(title: string): void {
  process.stdout.write(`\n${title}\n${'='.repeat(title.length)}\n`);
}

export function note(text: string): void {
  process.stdout.write(`    note: ${text}\n`);
}

export function report(): never {
  process.stdout.write(`\n${'-'.repeat(72)}\n`);
  if (failures.length === 0) {
    process.stdout.write(`EXTERNAL PROOF PASSED — ${passed} assertions across Modes A, B and C.\n`);
    process.exit(0);
  }
  process.stdout.write(
    `EXTERNAL PROOF FAILED — ${failures.length} failed, ${passed} passed:\n` +
      failures.map((failure) => `  - ${failure}`).join('\n') +
      '\n',
  );
  process.exit(1);
}
