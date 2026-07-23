import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = process.cwd();

const findings = [];

function readText(relativePath) {
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    findings.push({
      file: relativePath,
      detail: 'Required release governance file is missing.',
    });
    return '';
  }

  return readFileSync(absolutePath, 'utf8');
}

function requireContains(relativePath, content, expected, detail) {
  if (!content.includes(expected)) {
    findings.push({
      file: relativePath,
      detail,
    });
  }
}

function requireOrder(relativePath, content, first, second, detail) {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    findings.push({
      file: relativePath,
      detail,
    });
  }
}

function requireScript(rootPackageJson, scriptName, expectedCommand) {
  const actualCommand = rootPackageJson.scripts?.[scriptName];
  if (actualCommand !== expectedCommand) {
    findings.push({
      file: 'package.json',
      detail: `Root package.json must expose ${scriptName} as "${expectedCommand}".`,
    });
  }
}

const rootPackageJson = JSON.parse(readText('package.json'));
// HARNESS-DIET-004: the release runbook content merged into publish.md
// (release-operations.md is a pointer stub); the scan guards the merged content.
const releaseRulesPath = '.agents/rules/publish.md';
const releaseRules = readText(releaseRulesPath);
const processRules = readText('.agents/rules/process.md');
const rulesIndex = readText('.agents/rules/index.md');
const commonMistakes = readText('.agents/rules/common-mistakes.md');
const publishRules = readText('.agents/rules/publish.md');
const ciWorkflow = readText('.github/workflows/ci.yml');
const publishScript = readText('scripts/publish/publish-packages.sh');

requireScript(
  rootPackageJson,
  'harness:scan:release-governance',
  'node scripts/harness/check-release-governance.mjs',
);
requireScript(rootPackageJson, 'harness:release:init', 'node scripts/harness/release-run.mjs init');
requireScript(
  rootPackageJson,
  'harness:release:check',
  'node scripts/harness/release-run.mjs check',
);
requireScript(
  rootPackageJson,
  'harness:release:triage',
  'node scripts/harness/release-run.mjs triage',
);
requireScript(
  rootPackageJson,
  'harness:release:report',
  'node scripts/harness/release-run.mjs report',
);
// harness:scan delegates to the aggregating runner (HARNESS-011); the
// governance invariant — release verification runs this scan — now lives in
// the runner's scan table.
requireContains(
  'scripts/harness/run-all-scans.mjs',
  readText('scripts/harness/run-all-scans.mjs'),
  'check-release-governance.mjs',
  'run-all-scans.mjs must include the release-governance scan.',
);
requireContains(
  'package.json',
  rootPackageJson.scripts?.['harness:scan'] ?? '',
  'run-all-scans.mjs',
  'Root harness:scan must delegate to the aggregating scan runner.',
);

const releaseRunScript = readText('scripts/harness/release-run.mjs');
const releaseRunReadme = readText('.agents/release-runs/README.md');
const releaseRunTemplate = readText('.agents/templates/release-run-template.md');

const requiredReleaseSections = [
  '### Release Control Plane',
  '### Release State Machine',
  '### CI Failure Triage',
  '### Long-Running Gates',
  '### Dist Artifact Invariant',
  '### Publish Boundary',
  '### Stop Conditions',
];

for (const section of requiredReleaseSections) {
  requireContains(
    releaseRulesPath,
    releaseRules,
    section,
    `Release operations rules must include ${section}.`,
  );
}

const requiredReleasePhrases = [
  'current SHA',
  'target version',
  'exact gate currently running',
  'next action',
  'stop condition',
  'failure class',
  'failure signature',
  'local reproduction',
  'minimal fix recommendation',
  'build`, `test`, or `typecheck`',
  'root monorepo build once',
  'OTP',
];

for (const phrase of requiredReleasePhrases) {
  requireContains(
    releaseRulesPath,
    releaseRules,
    phrase,
    `Release operations rules must retain the required phrase: ${phrase}.`,
  );
}

requireContains(
  '.agents/rules/process.md',
  processRules,
  '[index.md](index.md)',
  'Process routing stub must point at the rules index.',
);
requireContains(
  '.agents/rules/index.md',
  rulesIndex,
  '[publish.md](publish.md)',
  'Rules index must route to the release runbook (publish.md).',
);
requireContains(
  '.agents/rules/common-mistakes.md',
  commonMistakes,
  'Running release work as ad-hoc CI debugging',
  'Common mistakes must capture ad-hoc release debugging as a known failure mode.',
);
requireContains(
  '.agents/rules/common-mistakes.md',
  commonMistakes,
  'Fixing CI before classifying the failure',
  'Common mistakes must capture CI patching without failure classification.',
);
requireContains(
  '.agents/rules/publish.md',
  publishRules,
  'Release Control Plane',
  'Publish rules must reference the Release Control Plane before publish.',
);
requireContains(
  'scripts/harness/release-run.mjs',
  releaseRunScript,
  'validatePublishReadiness',
  'Release-run script must validate publish readiness.',
);
requireContains(
  'scripts/harness/release-run.mjs',
  releaseRunScript,
  'Active watchers',
  'Release-run script must check long-running watcher cleanup fields.',
);
requireContains(
  '.agents/release-runs/README.md',
  releaseRunReadme,
  'pnpm harness:release:check -- --version <version> --publish',
  'Release-run README must document the publish preflight command.',
);
for (const field of [
  'Version',
  'Branch',
  'SHA',
  'PR',
  'Target branch',
  'Active gate',
  'Gate status',
  'Next action',
  'Stop condition',
  'Publish ready',
  'Active watchers',
  'Cleanup status',
]) {
  requireContains(
    '.agents/templates/release-run-template.md',
    releaseRunTemplate,
    `- ${field}:`,
    `Release-run template must include ${field}.`,
  );
}

requireContains(
  '.github/workflows/ci.yml',
  ciWorkflow,
  "const checksRequiringPackageDist = new Set(['build', 'test', 'typecheck'])",
  'CI must build root package dist for build, test, and typecheck verification.',
);
requireContains(
  '.github/workflows/ci.yml',
  ciWorkflow,
  'package-dist.tgz',
  'CI must archive package dist artifacts for skip-build quality verification.',
);
requireContains(
  '.github/workflows/ci.yml',
  ciWorkflow,
  "needs.build.outputs.package_dist_required == 'true'",
  'CI quality must restore package dist only when the build job declares it required.',
);

const releaseScript = rootPackageJson.scripts?.['harness:verify:release'] ?? '';
requireOrder(
  'package.json',
  releaseScript,
  'pnpm build:deps',
  'pnpm harness:scan',
  'Release verification must build before harness scan so dist checks have artifacts.',
);
requireContains(
  'package.json',
  releaseScript,
  'pnpm test',
  'Release verification must include the test suite.',
);
requireContains(
  'package.json',
  releaseScript,
  'pnpm typecheck',
  'Release verification must include typecheck.',
);
requireContains(
  'package.json',
  releaseScript,
  'pnpm lint',
  'Release verification must include lint.',
);

requireContains(
  'scripts/publish/publish-packages.sh',
  publishScript,
  'command+=(publish -r --no-git-checks)',
  'Publish script must publish recursively instead of per-package by default.',
);
requireContains(
  'scripts/publish/publish-packages.sh',
  publishScript,
  'run_publish_command dry-run',
  'Publish script must dry-run before requesting OTP.',
);
requireOrder(
  'scripts/publish/publish-packages.sh',
  publishScript,
  'pnpm harness:release:check -- --version "$VERSION" --publish',
  'read -rp "🔑 Enter npm OTP for publish: " OTP',
  'Publish script must validate release-run state before requesting OTP.',
);
requireContains(
  'scripts/publish/publish-packages.sh',
  publishScript,
  'read -rp "🔑 Enter npm OTP for publish: " OTP',
  'Publish script must request OTP only inside the publish boundary.',
);

if (findings.length === 0) {
  process.stdout.write('release governance scan passed.\n');
} else {
  process.stdout.write('release governance scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}
