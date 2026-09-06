import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ENTRYPOINT_PATTERN = /^(?:scan|check)-.+\.mjs$/;

// These files are reusable libraries or one-off workflow helpers. Their names predate the
// discovery convention, so they are excluded explicitly rather than being silently ignored.
export const NON_SCAN_ENTRYPOINTS = new Set([
  'check-patch-coverage.mjs',
  'check-plan.mjs',
  'check-pr-body.mjs',
  'check-regression-red-proof.mjs',
  'check-review-gate.mjs',
  'scan-promotion-closes.mjs',
  'scan-receipt.mjs',
]);

function candidateFiles(harnessDir) {
  return readdirSync(harnessDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ENTRYPOINT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function validateDefinition(definition, file) {
  if (!definition || typeof definition !== 'object') {
    throw new Error(
      `scan discovery: ${file} must export a scanDefinition object; ` +
        'a scan without an explicit declaration is refused',
    );
  }
  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new Error(`scan discovery: ${file} has no non-empty scanDefinition.name`);
  }
  if (definition.always !== true && !Array.isArray(definition.examines)) {
    throw new Error(
      `scan discovery: ${file} (${definition.name}) declares neither examines nor always; ` +
        '--affected would otherwise skip it without knowing what it reads',
    );
  }
  if (definition.advisory !== undefined && typeof definition.advisory !== 'boolean') {
    throw new Error(`scan discovery: ${file} (${definition.name}) has a non-boolean advisory flag`);
  }
  return definition;
}

/**
 * Discover additional scan entrypoints that are not in the compatibility registry.
 *
 * Existing entries remain the compatibility baseline while scans migrate incrementally. A new
 * candidate must export its own declaration; otherwise this function fails closed before any scan
 * is run. The returned command shape intentionally matches SCAN_COMMANDS.
 */
export async function discoverAdditionalScans({ root = process.cwd(), legacyScans = [] } = {}) {
  const harnessDir = path.join(root, 'scripts', 'harness');
  const legacyFiles = new Set(
    legacyScans
      .map((scan) => scan.command?.[1])
      .filter((file) => typeof file === 'string')
      .map((file) => path.basename(file)),
  );
  const legacyNames = new Set(legacyScans.map((scan) => scan.name));
  const discovered = [];

  for (const file of candidateFiles(harnessDir)) {
    if (legacyFiles.has(file) || NON_SCAN_ENTRYPOINTS.has(file)) continue;

    const filePath = path.join(harnessDir, file);
    const source = readFileSync(filePath, 'utf8');
    if (!/export\s+const\s+scanDefinition\s*=/.test(source)) {
      throw new Error(
        `scan discovery: ${file} is a new scan candidate without scanDefinition; ` +
          'declare what it reads (examines/always) and whether it is advisory',
      );
    }
    const module = await import(`${pathToFileURL(filePath).href}?scan-discovery`);
    const definition = validateDefinition(module.scanDefinition, file);
    if (legacyNames.has(definition.name)) {
      throw new Error(`scan discovery: ${file} duplicates registered scan name ${definition.name}`);
    }
    discovered.push({
      ...definition,
      command: definition.command ?? ['node', `scripts/harness/${file}`],
    });
  }

  return discovered.sort((left, right) => {
    const leftOrder = Number.isInteger(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isInteger(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });
}

export async function loadScanCommands(legacyScans, options = {}) {
  const additional = await discoverAdditionalScans({ ...options, legacyScans });
  const all = [...legacyScans, ...additional];
  const names = new Set();
  for (const scan of all) {
    if (names.has(scan.name)) throw new Error(`scan discovery: duplicate scan name ${scan.name}`);
    names.add(scan.name);
  }
  return all;
}
