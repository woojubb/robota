#!/usr/bin/env node

/**
 * Doc-example typecheck scan (DOCS-015).
 *
 * The first code a consumer meets — README quickstarts — shipped uncompilable for an unknown time
 * (`defaultModel.systemMessage`, a field that does not exist on `IAgentConfig.defaultModel`), and
 * doc examples had no gate at all, so drift between examples and the real types was invisible.
 * External discoverability feedback showed consumers (especially AI agents) trust `.d.ts` over
 * README precisely because of this class of drift.
 *
 * This scan extracts every ```ts / ```typescript fenced block from the root README and each
 * packages/x/README.md and typechecks them against the WORKSPACE SOURCE types (strict). A block
 * that is intentionally a fragment (pseudo-code, elided context) must carry an explicit opt-out
 * marker on the nearest non-blank line above its fence:
 *
 *   <!-- doc-example-skip: <reason> -->
 *
 * Silent skips do not exist; the marker count is reported. The content/ corpus (guide,
 * getting-started, examples, integrations + root pages) was onboarded by DOCS-019; content/v2.0.0
 * (preserved historical docs), content/ko (translations), and content/images stay excluded.
 *
 * Exit code 0 = all doc examples typecheck, 1 = drift found.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';

import { listManifestPackageDirs } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const OUT_DIR = path.join(WORKSPACE_ROOT, 'node_modules/.cache/doc-examples');

// The marker may be separated from its fence by blank lines (prettier reformats it that way).
const FENCE_PATTERN = /(^|\n)([^\n]*)\n(?:[ \t]*\n)*```(ts|typescript)\n([\s\S]*?)```/g;
const SKIP_PATTERN = /<!--\s*doc-example-skip:\s*(.+?)\s*-->/;

/**
 * README files under scan: root + every workspace package's README.md.
 *
 * HARNESS-052: the glob was `packages/*​/README.md`, which the docstring described as "each
 * `packages/x/README.md`" while `pnpm-workspace.yaml` also declares `packages/dag-nodes/*`. The
 * set is now the UNION of the depth-1 glob and the nesting-aware SSOT, so a README added to a nested
 * group member is compiled like any other while the group container's own README
 * (`packages/dag-nodes/README.md`, which the glob matched and the package enumerator does not, the
 * container having no `package.json`) keeps its coverage. Measured at the time of the change: 40
 * README files before, 40 after plus every future nested one — no member ships a README yet, so this
 * bought coverage rather than subjects, and dropping the union would have silently traded one
 * uncovered file for another.
 */
export function listReadmeFiles(root = WORKSPACE_ROOT) {
  const files = ['README.md'];
  for (const entry of globSync('packages/*/README.md', { cwd: root })) {
    files.push(entry);
  }
  for (const pkgDir of listManifestPackageDirs(root)) {
    const readme = path.join(pkgDir, 'README.md');
    if (existsSync(readme)) files.push(path.relative(root, readme).split(path.sep).join('/'));
  }
  // DOCS-019: the content/ guide corpus is in scope. Excluded by design: content/v2.0.0
  // (preserved historical docs), content/ko (translations mirror en), content/images.
  for (const pattern of [
    'content/*.md',
    'content/guide/*.md',
    'content/getting-started/*.md',
    'content/examples/*.md',
    'content/integrations/*.md',
    'content/development/*.md',
    'content/plugins/*.md',
  ]) {
    for (const entry of globSync(pattern, { cwd: root })) {
      files.push(entry);
    }
  }
  return [...new Set(files)].sort();
}

/** Extract ts blocks with their skip-marker state. */
export function extractBlocks(markdown) {
  const blocks = [];
  let index = 0;
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const precedingLine = match[2] ?? '';
    const skip = SKIP_PATTERN.exec(precedingLine);
    blocks.push({
      index: index++,
      code: match[4],
      skipReason: skip ? skip[1] : null,
    });
  }
  return blocks;
}

/**
 * PERF-006: this tsconfig carries NO `baseUrl`, and the `paths` values are absolute instead.
 *
 * `baseUrl` is deprecated in TypeScript 6 — it is a hard `error TS5101`, not a warning — and is
 * removed outright in 7. The repo's checked-in tsconfigs were already cleared of it by PERF-004;
 * this generated one was the last occurrence anywhere in the tree, and it only surfaced when the
 * tool-side compiler moved from 5.9.3 to 6.0.3 (5.9.3 compiled it silently).
 *
 * Absolute `paths` values are the forward-compatible replacement: without `baseUrl` a relative
 * mapping resolves against THIS file's directory, which is a cache path several levels below the
 * workspace root, so absolutes keep the mapping correct regardless of where `OUT_DIR` moves — and
 * they work unchanged if this scan is later moved onto the native compiler.
 */
function buildTsconfig(dir, root = WORKSPACE_ROOT) {
  const at = (relative) => path.join(root, relative);
  return {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['es2023', 'dom'],
      types: ['node'],
      skipLibCheck: true,
      jsx: 'react-jsx',
      customConditions: ['source'],
      paths: {
        '@robota-sdk/*': [at('packages/*/src/index.ts')],
        '@robota-sdk/agent-provider-openai/loggers': [
          at('packages/agent-provider-openai/src/openai/loggers/index.ts'),
        ],
        '@robota-sdk/agent-provider-gemini/google': [
          at('packages/agent-provider-gemini/src/google/index.ts'),
        ],
        '@robota-sdk/agent-provider-openai-compatible/shared': [
          at('packages/agent-provider-openai-compatible/src/shared/openai-compatible/index.ts'),
        ],
        '@robota-sdk/agent-provider-*': [at('packages/agent-provider-*/src/index.ts')],
        '@robota-sdk/agent-transport/*': [at('packages/agent-transport/src/*/index.ts')],
      },
    },
    include: [path.join(dir, '*.ts')],
  };
}

export async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];
  let skipped = 0;
  for (const relative of listReadmeFiles()) {
    const markdown = readFileSync(path.join(WORKSPACE_ROOT, relative), 'utf8');
    for (const block of extractBlocks(markdown)) {
      if (block.skipReason) {
        skipped += 1;
        continue;
      }
      const slug = relative.replace(/[^a-zA-Z0-9]+/g, '_');
      const fileName = `${slug}__${block.index}.ts`;
      writeFileSync(path.join(OUT_DIR, fileName), block.code, 'utf8');
      manifest.push({ fileName, source: `${relative} (block #${block.index + 1})` });
    }
  }

  writeFileSync(path.join(OUT_DIR, 'tsconfig.json'), JSON.stringify(buildTsconfig(OUT_DIR)));

  let output = '';
  let failed = false;
  try {
    execFileSync('pnpm', ['exec', 'tsc', '-p', path.join(OUT_DIR, 'tsconfig.json')], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failed = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  if (!failed) {
    process.stdout.write(
      `::examined:: ${manifest.length} documentation code blocks\n` +
        `doc-examples scan passed (${manifest.length} blocks typechecked, ${skipped} marked skip).\n`,
    );
    return;
  }

  process.stdout.write('doc-examples scan failed — README code blocks do not typecheck:\n');
  const bySource = new Map();
  for (const line of output.split('\n')) {
    const match = /doc-examples[\\/](\S+?\.ts)\((\d+),\d+\): (error TS\d+: .*)/.exec(line);
    if (!match) continue;
    const entry = manifest.find((m) => m.fileName === match[1]);
    const source = entry ? entry.source : match[1];
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(`line ${match[2]}: ${match[3]}`);
  }
  for (const [source, errors] of bySource) {
    process.stdout.write(`  - ${source}\n`);
    for (const error of errors.slice(0, 3)) process.stdout.write(`      ${error}\n`);
  }
  if (bySource.size === 0) {
    process.stdout.write('  (errors outside the extracted blocks — raw tsc output follows)\n');
    for (const line of output.split('\n').filter(Boolean).slice(0, 10)) {
      process.stdout.write(`      ${line}\n`);
    }
  }
  process.stdout.write(
    'Fix the example to match the real types, or mark an intentional fragment with ' +
      '<!-- doc-example-skip: <reason> --> on the line above the fence.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
