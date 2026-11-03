import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { expect, it } from 'vitest';

// A Bun standalone executable reads bunfig.toml (whose `preload` runs arbitrary JavaScript) and .env from
// the directory it starts in unless the build turns that off, so a cloned repository could run code or
// rewrite the environment before workspace trust is decided. Every compile site must turn all four off.
const AUTOLOAD_OPTIONS = [
  'autoloadBunfig',
  'autoloadDotenv',
  'autoloadTsconfig',
  'autoloadPackageJson',
];
const AUTOLOAD_FLAGS = [
  '--no-compile-autoload-bunfig',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-tsconfig',
  '--no-compile-autoload-package-json',
];

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workspaceFiles = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
  .split('\0')
  .filter((file) => file && !/(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$|\.mdx?$/u.test(file));
const read = (file) => {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return '';
  }
};

const propertyName = (property) =>
  property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : undefined;

function bunBuildCompileSites(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sites = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'build' &&
      node.expression.expression.getText(sourceFile).replace(/^globalThis\./u, '') === 'Bun'
    ) {
      const [options] = node.arguments;
      const compile =
        options && ts.isObjectLiteralExpression(options)
          ? options.properties.find((property) => propertyName(property) === 'compile')
          : undefined;
      if (compile) {
        const value = ts.isPropertyAssignment(compile) ? compile.initializer : undefined;
        const disabled = new Set(
          value && ts.isObjectLiteralExpression(value)
            ? value.properties
                .filter(
                  (property) =>
                    ts.isPropertyAssignment(property) &&
                    property.initializer.kind === ts.SyntaxKind.FalseKeyword,
                )
                .map(propertyName)
            : [],
        );
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        sites.push({
          site: `${file}:${line + 1}`,
          missing: AUTOLOAD_OPTIONS.filter((option) => !disabled.has(option)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

it('compiles every standalone executable through Bun.build with runtime config autoloading off', () => {
  const sites = workspaceFiles
    .filter((file) => /\.[cm]?[jt]sx?$/u.test(file))
    .flatMap((file) => {
      const source = read(file);
      return source.includes('Bun.build') ? bunBuildCompileSites(file, source) : [];
    });
  expect(sites.map(({ site }) => site.split(':')[0])).toContain(
    'packages/agent-cli/scripts/build-bun.mjs',
  );
  expect(sites.filter(({ missing }) => missing.length > 0)).toEqual([]);
});

it('probes autoloading with the prefixed state variable unset', async () => {
  // dotenv never overrides a variable, so a planted .env can only show itself if the variable it sets is unset;
  // the fixture's PRODUCT_* values stay, because a product binary needs them at run time.
  const { standaloneAutoloadEnvironment } = await import(
    '../../../packages/agent-cli/scripts/e2e-standalone-autoload.mjs'
  );
  const env = standaloneAutoloadEnvironment('/tmp/home', 'PROBE_USER_STATE_DIR');
  expect(env).not.toHaveProperty('PROBE_USER_STATE_DIR');
  expect(env).toHaveProperty('PRODUCT_USER_STATE_DIR');
  expect(env.HOME).toBe('/tmp/home');
});

it('sees the prefixed state variable take effect either as its value or as the conflict it names', async () => {
  const { stateVariableTookEffect } = await import(
    '../../../packages/agent-cli/scripts/e2e-standalone-autoload.mjs'
  );
  const seen = (result) => stateVariableTookEffect(result, 'planted-user-state', 'PROBE_USER_STATE_DIR');
  expect(seen({ status: 0, stdout: 'state root: /x/planted-user-state', stderr: '' })).toBe(true);
  expect(
    seen({ status: 1, stdout: '', stderr: 'PRODUCT_USER_STATE_DIR: conflicts with PROBE_USER_STATE_DIR' }),
  ).toBe(true);
  // An ignored variable, and a failure that has nothing to do with it, are not an effect.
  expect(seen({ status: 0, stdout: 'state root: /x/home/.probe', stderr: '' })).toBe(false);
  expect(seen({ status: 0, stdout: '', stderr: 'warning: PROBE_USER_STATE_DIR' })).toBe(false);
  expect(seen({ status: 1, stdout: '', stderr: 'PRODUCT_PROJECT_STATE_DIR: required value' })).toBe(false);
});

it.skipIf(process.platform === 'win32')(
  'fails its positive control on an executable that ignores the prefixed state variable',
  async () => {
    const { runStandaloneAutoloadE2e } = await import(
      '../../../packages/agent-cli/scripts/e2e-standalone-autoload.mjs'
    );
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const directory = mkdtempSync(join(tmpdir(), 'standalone-control-'));
    try {
      // Answers --help from PRODUCT_USER_STATE_DIR only, as a binary would whose alias stopped working.
      const fake = join(directory, 'ignores-alias');
      writeFileSync(
        fake,
        `#!${process.execPath}\nprocess.stdout.write('state root: ' + (process.env.PRODUCT_USER_STATE_DIR ?? '') + '\\n');\n`,
      );
      chmodSync(fake, 0o755);
      expect(() => runStandaloneAutoloadE2e(fake, { envPrefix: 'PROBE_' })).toThrow(
        /Control: PROBE_USER_STATE_DIR from the environment had no visible effect/u,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('passes every autoload opt-out to each `bun build --compile` command line', () => {
  const commands = workspaceFiles.flatMap((file) =>
    read(file)
      .split('\n')
      .map((line, index) => ({ line, site: `${file}:${index + 1}` }))
      .filter(({ line }) => /\bbun\s+build\b.*\s--compile\b/u.test(line)),
  );
  expect(
    commands
      .map(({ line, site }) => ({
        site,
        missing: AUTOLOAD_FLAGS.filter((flag) => !line.includes(flag)),
      }))
      .filter(({ missing }) => missing.length > 0),
  ).toEqual([]);
});
