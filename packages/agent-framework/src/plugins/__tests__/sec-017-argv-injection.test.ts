import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { MarketplaceClient } from '../marketplace-client.js';

import type { TExecFn } from '../marketplace-types.js';

/**
 * SEC-017 (issue #2019) — a marketplace URL is an ARGUMENT, never syntax.
 *
 * The port used to be `(command: string, …)` and the production adapter passed that string to
 * `execSync`, which always runs its argument through a shell. So a source URL containing `;` or
 * `$(…)` executed additional host commands during add, update, revision lookup or install.
 *
 * These assert the property that makes the fix real rather than the code that implements it: the
 * hostile text arrives at the port as ONE argv element, byte for byte, with nothing split off it.
 * A `toContain('git clone')` assertion over a joined string passes just as well when the URL has
 * been folded back into a shell line — which is the defect, not the fix.
 */
describe('SEC-017 — hostile marketplace input reaches the port as a literal argument', () => {
  let pluginsDir: string;
  let mockExec: Mock;
  let client: MarketplaceClient;

  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'sec-017-'));
    mockExec = vi.fn().mockReturnValue('');
    client = new MarketplaceClient({ pluginsDir, exec: mockExec as unknown as TExecFn });
  });

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true });
  });

  // Each is a real shell construct. Under the old string port every one of them was syntax the
  // shell acted on; under an argv port each must survive as inert text.
  const HOSTILE = [
    'https://example.com/repo.git; touch /tmp/pwned',
    'https://example.com/repo.git && id',
    'https://example.com/$(id).git',
    'https://example.com/`id`.git',
    'https://example.com/repo.git\nid',
    "https://example.com/'; id; '.git",
    'https://example.com/repo with spaces.git',
    'https://example.com/repo.git | cat',
  ];

  it.each(HOSTILE)('passes %j through as exactly one argv element', (url) => {
    try {
      client.addMarketplace({ type: 'git', url });
    } catch {
      // The clone is mocked, so the add fails later on a missing manifest. The call we assert on
      // has already happened, and asserting it is the point — not whether the add succeeded.
    }

    expect(mockExec).toHaveBeenCalled();
    const [file, args] = mockExec.mock.calls[0] as [string, readonly string[]];

    expect(file).toBe('git');
    // Byte-for-byte, as ONE element. Not "an element containing it" — a split would also satisfy
    // that, and a split is precisely what a shell does.
    expect(args).toContain(url);
    expect(args.filter((a) => a === url)).toHaveLength(1);

    // Nothing the shell would have produced: no element is a fragment of the URL, and the marker
    // commands never became arguments of their own.
    const fragments = args.filter((a) => a !== url && url.includes(a) && a.length > 2);
    expect(
      fragments,
      `a fragment of the URL became its own argument: ${JSON.stringify(args)}`,
    ).toEqual([]);
    expect(args).not.toContain('id');
    expect(args).not.toContain('touch');
  });

  it('sends an option-like URL after `--`, so git reads it as an operand', () => {
    // Argv stops the SHELL. It does not stop GIT: `--upload-pack=…` names a program git runs.
    try {
      client.addMarketplace({ type: 'git', url: '--upload-pack=touch /tmp/pwned' });
    } catch {
      // as above
    }

    const [, args] = mockExec.mock.calls[0] as [string, readonly string[]];
    const separator = args.indexOf('--');
    expect(
      separator,
      'no `--` separator, so an option-like URL is read as an option',
    ).toBeGreaterThan(-1);
    expect(args.indexOf('--upload-pack=touch /tmp/pwned')).toBeGreaterThan(separator);
  });
});
