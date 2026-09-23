import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = Object.freeze({
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64' },
  'linux-arm64': { platform: 'linux', arch: 'arm64' },
  'linux-x64': { platform: 'linux', arch: 'x64' },
  'windows-x64': { platform: 'win32', arch: 'x64' },
});

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readQualification(file, runtimePattern) {
  const text = readFileSync(resolve(file), 'utf8').trim();
  for (const required of [
    'qualification=passed',
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    'rootReplacement=preserved',
    'finalLink=refused',
    'boundedRead=refused',
  ]) {
    if (!text.includes(required)) throw new Error(`Qualification evidence is missing ${required}.`);
  }
  const match = text.match(runtimePattern);
  if (!match) throw new Error(`Qualification evidence has an invalid runtime: ${text}`);
  return match[1];
}

function requireLine(file, line) {
  const text = readFileSync(resolve(file), 'utf8');
  if (!text.split(/\r?\n/u).includes(line)) {
    throw new Error(`Native evidence is missing the exact line: ${line}`);
  }
  return 'passed';
}

const target = argument('--target');
const output = argument('--output');
const node20Log = argument('--node20-log');
const node22Log = argument('--node22-log');
const bunLog = argument('--bun-log');
const sessionLog = argument('--session-log');
const nodeCliLog = argument('--node-cli-log');
const bunCliLog = argument('--bun-cli-log');
if (
  !target ||
  !output ||
  !node20Log ||
  !node22Log ||
  !bunLog ||
  !sessionLog ||
  !nodeCliLog ||
  !bunCliLog
) {
  throw new Error(
    'usage: write-native-evidence.mjs --target <target> --output <file> --node20-log <file> --node22-log <file> --bun-log <file> --session-log <file> --node-cli-log <file> --bun-cli-log <file>',
  );
}
const expected = TARGETS[target];
if (!expected || expected.platform !== process.platform || expected.arch !== process.arch) {
  throw new Error(
    `Target ${target} does not match native host ${process.platform}-${process.arch}.`,
  );
}

const evidence = {
  schemaVersion: 2,
  target,
  platform: process.platform,
  arch: process.arch,
  koffi: '3.3.1',
  node20: readQualification(node20Log, /runtime=node-(v20\.19\.\d+)/u),
  node22: readQualification(node22Log, /runtime=node-(v22\.\d+\.\d+)/u),
  bun: readQualification(bunLog, /runtime=bun-(1\.3\.14)/u),
  rootReplacement: 'preserved',
  finalLink: 'refused',
  boundedRead: 'refused',
  sessionReplay: requireLine(
    sessionLog,
    'result=replay-preserved; replacementDenied=true; cleanupRemoved=true',
  ),
  packedNodeCli: requireLine(
    nodeCliLog,
    'native-file-authority=passed; success=true; replacementDenied=true; cleanupRemoved=true',
  ),
  standaloneBunCli: requireLine(
    bunCliLog,
    'native-file-authority=passed; success=true; replacementDenied=true; cleanupRemoved=true',
  ),
};
writeFileSync(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
