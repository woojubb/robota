import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeContractPath } from './contract-input-matching.mjs';

const SAFE_DEFAULT_WEIGHT = 10;
const positiveWeight = (value, fallback = SAFE_DEFAULT_WEIGHT) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

function suppliedWeight(weights, file) {
  if (weights instanceof Map) return weights.get(file);
  if (weights && typeof weights === 'object') return weights[file];
  return undefined;
}

function occurrences(source, expression) {
  return [...source.matchAll(expression)].length;
}

/** Estimate first-run milliseconds from the complete static source closure. */
export function estimateContractTestWeights({ root, files, registry = [], measuredDurations }) {
  const entries = new Map(
    (Array.isArray(registry) ? registry : []).map((entry) => [
      normalizeContractPath(entry?.test),
      entry,
    ]),
  );
  return new Map(
    files.map((file) => {
      const measured = suppliedWeight(measuredDurations, file);
      if (Number.isFinite(measured) && measured > 0) return [file, measured];
      try {
        const closure = entries.get(file)?.implementationInputs ?? [file];
        const sources = [...new Set(closure)].map((input) =>
          readFileSync(path.join(root, input), 'utf8'),
        );
        const source = sources.join('\n');
        const estimate =
          SAFE_DEFAULT_WEIGHT +
          Math.ceil(Buffer.byteLength(source) / 2_048) +
          sources.length * 2 +
          occurrences(
            source,
            /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/gu,
          ) *
            100 +
          occurrences(
            source,
            /(?:['"`]git['"`]|\bgit\b)[\s\S]{0,120}?\b(?:init|clone|worktree)\b/gu,
          ) *
            250 +
          occurrences(source, /\bPromise\.(?:all|allSettled)\s*\(/gu) * 150;
        return [file, positiveWeight(estimate)];
      } catch {
        return [file, SAFE_DEFAULT_WEIGHT];
      }
    }),
  );
}

/** Deterministic LPT partition. Every file appears exactly once. */
export function createDeterministicShards(files, count = 4, weights = new Map()) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('shard count must be positive');
  const unique = [...new Set(files)].sort();
  if (unique.length !== files.length) throw new Error('cannot shard duplicate test files');
  const shards = Array.from({ length: count }, (_, index) => ({ index, load: 0, files: [] }));
  const jobs = unique
    .map((file) => ({ file, weight: positiveWeight(suppliedWeight(weights, file)) }))
    .sort((left, right) => right.weight - left.weight || left.file.localeCompare(right.file));
  for (const job of jobs) {
    const target = shards.reduce((lightest, shard) =>
      shard.load < lightest.load || (shard.load === lightest.load && shard.index < lightest.index)
        ? shard
        : lightest,
    );
    target.files.push(job.file);
    target.load += job.weight;
  }
  return shards.map((shard) => shard.files.sort());
}
