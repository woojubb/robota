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
 * Silent skips do not exist; the marker count is reported. content/ guide pages are a tracked
 * follow-on (larger corpus, same mechanism) — see the DOCS-015 backlog evidence.
 *
 * Exit code 0 = all doc examples typecheck, 1 = drift found.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'node:fs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(WORKSPACE_ROOT, 'node_modules/.cache/doc-examples');

// The marker may be separated from its fence by blank lines (prettier reformats it that way).
const FENCE_PATTERN = /(^|\n)([^\n]*)\n(?:[ \t]*\n)*```(ts|typescript)\n([\s\S]*?)```/g;
const SKIP_PATTERN = /<!--\s*doc-example-skip:\s*(.+?)\s*-->/;

/** README files under scan: root + every packages/x/README.md. */
export function listReadmeFiles(root = WORKSPACE_ROOT) {
  const files = ['README.md'];
  for (const entry of globSync('packages/*/README.md', { cwd: root })) {
    files.push(entry);
  }
  return files.sort();
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

function buildTsconfig(dir) {
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
      baseUrl: WORKSPACE_ROOT,
      paths: {
        '@robota-sdk/*': ['packages/*/src/index.ts'],
        '@robota-sdk/agent-provider/*': ['packages/agent-provider/src/*/index.ts'],
        '@robota-sdk/agent-transport/*': ['packages/agent-transport/src/*/index.ts'],
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
