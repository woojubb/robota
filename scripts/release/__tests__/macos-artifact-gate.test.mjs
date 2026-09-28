import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const gate = fileURLToPath(
  new URL('../../harness/verify-macos-release-artifacts.sh', import.meta.url),
);
const scratch = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture({ rejectStaple = false, requireOpenAssessment = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'macos-gate-test-'));
  scratch.push(root);
  const commands = join(root, 'commands');
  const downloads = join(root, 'downloads');
  mkdirSync(commands);
  mkdirSync(downloads);
  const script = '#!/bin/sh\nprintf "3.0.0-beta.test\\n"\n';
  const digest = createHash('sha256').update(script).digest('hex');
  const names = ['robota-darwin-arm64', 'robota-darwin-x64', 'Robota.dmg'];
  for (const name of names) writeFileSync(join(downloads, name), script, { mode: 0o755 });
  writeFileSync(
    join(downloads, 'SHA256SUMS.txt'),
    names.map((name) => `${digest}  ${name}\n`).join(''),
  );
  const mocks = {
    codesign: 'exit 0',
    xattr: 'echo quarantine',
    uuidgen: 'echo uuid',
    sw_vers: 'echo 26.0',
    xcrun: rejectStaple ? 'exit 1' : 'exit 0',
    hdiutil:
      'if [ "$1" = attach ]; then for arg in "$@"; do mount="$arg"; done; mkdir -p "$mount/Robota.app"; fi',
    spctl: requireOpenAssessment
      ? 'case "$*" in *Robota.dmg*) case "$*" in *"--type open --context context:primary-signature"*) exit 0;; *) exit 1;; esac;; esac'
      : 'exit 0',
  };
  for (const [name, content] of Object.entries(mocks))
    writeFileSync(join(commands, name), `#!/bin/sh\n${content}\n`, { mode: 0o755 });
  return spawnSync('bash', [gate, 'test-tag', downloads], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, TMPDIR: root },
  });
}

it('fails a published DMG with no valid stapled ticket even when signature and Gatekeeper checks pass', () => {
  const result = fixture({ rejectStaple: true });
  expect(result.stdout).toMatch(/BLOCKING\s+FAIL xcrun stapler validate/);
  expect(result.status).toBe(1);
});

it('assesses a DMG as a disk image being opened rather than a package installer', () => {
  const result = fixture({ requireOpenAssessment: true });
  expect(result.stdout).toMatch(/BLOCKING\s+PASS spctl --assess --type open/);
  expect(result.status).toBe(0);
});
