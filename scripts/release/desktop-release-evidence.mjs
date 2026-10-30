import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeEvidence({ kind, tag, sha, run, attempt, identity, files }) {
  if (
    !['native', 'desktop'].includes(kind) ||
    !/^[\w.+-]+$/u.test(tag) ||
    !/^[a-f0-9]{40}$/u.test(sha) ||
    !Number.isSafeInteger(run) ||
    run < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !identity.prefix ||
    !identity.tagPrefix ||
    !identity.repository ||
    !/^[a-f0-9]{64}$/u.test(identity.configHash) ||
    files.length === 0
  ) {
    throw new Error('Incomplete release evidence');
  }
  const names = new Set();
  const assets = files.map((file) => {
    const name = basename(file);
    if (names.has(name)) throw new Error(`Duplicate release asset: ${name}`);
    names.add(name);
    return {
      name,
      size: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
  });
  return { kind, tag, sha, run, attempt, identity, assets };
}

export function assertEvidence(expected, evidence, files) {
  const { kind, tag, sha, run, attempt, identity } = expected;
  if (
    evidence.kind !== kind ||
    evidence.tag !== tag ||
    evidence.sha !== sha ||
    evidence.run !== run ||
    evidence.attempt !== attempt ||
    JSON.stringify(evidence.identity) !== JSON.stringify(identity)
  ) {
    throw new Error('Release evidence identity mismatch');
  }
  const actual = makeEvidence({ ...expected, files });
  const canonical = (assets) => [...assets].sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(canonical(actual.assets)) !== JSON.stringify(canonical(evidence.assets)))
    throw new Error('Published release assets do not match producer evidence');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [
    output,
    kind,
    tag,
    sha,
    run,
    attempt,
    prefix,
    tagPrefix,
    repository,
    configHash,
    ...files
  ] = process.argv.slice(2);
  const evidence = makeEvidence({
    kind,
    tag,
    sha,
    run: Number(run),
    attempt: Number(attempt),
    identity: { prefix, tagPrefix, repository, configHash },
    files,
  });
  writeFileSync(output, JSON.stringify(evidence));
}
