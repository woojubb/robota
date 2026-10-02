import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const setup = fileURLToPath(new URL('../setup-macos-signing.mjs', import.meta.url));
const scratch = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

it.each([false, true])(
  'keeps keychain credentials out of logs when import fails: %s',
  (rejectImport) => {
    const root = mkdtempSync(join(tmpdir(), 'macos-credential-test-'));
    scratch.push(root);
    const commands = join(root, 'commands');
    mkdirSync(commands);
    const passwordFile = join(root, 'mock-keychain-password');
    const platform = join(root, 'macos-platform.cjs');
    writeFileSync(platform, "Object.defineProperty(process, 'platform', { value: 'darwin' });\n");
    writeFileSync(
      join(commands, 'security'),
      `#!/bin/sh
umask 077
case "$1" in
  create-keychain) printf '%s' "$3" > "$MOCK_PASSWORD_FILE";;
  import) if [ "$MOCK_REJECT_IMPORT" = true ]; then printf '%s\\n' "$@" >&2; exit 1; fi;;
  list-keychains) if [ "$#" = 3 ]; then printf '"/mock/login.keychain-db"\\n'; fi; exit 0;;
  find-identity) printf '1) ${'A'.repeat(40)} "Developer ID Application: Test (B7N9FQPD7R)"\\n'; exit 0;;
esac
printf '%s\\n' "$@"
`,
      { mode: 0o755 },
    );
    writeFileSync(join(commands, 'xcrun'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, ['--require', platform, setup, 'setup'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${commands}:${process.env.PATH}`,
        MOCK_PASSWORD_FILE: passwordFile,
        MOCK_REJECT_IMPORT: String(rejectImport),
        RUNNER_TEMP: root,
        PRODUCT_CREDENTIAL_SERVICE: 'synthetic-service',
        GITHUB_ENV: join(root, 'github-env'),
        MACOS_CERTIFICATE_P12: Buffer.from('synthetic certificate').toString('base64'),
        MACOS_CERTIFICATE_PASSWORD: 'synthetic-certificate-password',
        APPLE_TEAM_ID: 'B7N9FQPD7R',
        APPLE_API_KEY_P8: 'synthetic-api-private-key',
        APPLE_API_KEY_ID: 'TESTKEY123',
        APPLE_API_ISSUER: 'synthetic-issuer',
      },
    });
    expect(result.status).toBe(rejectImport ? 1 : 0);
    if (rejectImport) expect(result.stderr).toContain('security import failed');
    const password = readFileSync(passwordFile, 'utf8');
    expect(password).toHaveLength(64);
    const logs = result.stdout + result.stderr;
    expect(logs).not.toContain(password);
    expect(logs).not.toContain('synthetic-certificate-password');
    expect(logs).not.toContain('synthetic-api-private-key');
  },
);
