import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function normalizeName(name) {
  if ((name.startsWith('I') || name.startsWith('T')) && name.length > 1) {
    const next = name[1];
    if (next >= 'A' && next <= 'Z') return name.slice(1);
  }
  return name;
}

function isTargetFile(file) {
  if (!(file.startsWith('packages/') || file.startsWith('apps/'))) return false;
  if (!(file.endsWith('.ts') || file.endsWith('.tsx'))) return false;
  if (file.includes('/dist/')) return false;
  if (file.startsWith('content/api-reference/')) return false;
  if (file.includes('/node_modules/')) return false;
  return true;
}

function isTestFile(file) {
  return (
    file.endsWith('.test.ts') ||
    file.endsWith('.test.tsx') ||
    file.endsWith('.spec.ts') ||
    file.endsWith('.spec.tsx') ||
    file.includes('/__tests__/')
  );
}

function rootOf(file) {
  const p = file.split('/');
  return p.length >= 2 ? p.slice(0, 2).join('/') : file;
}

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter(isTargetFile);

const declPatterns = [
  { kind: 'class', re: /^\s*(export\s+)?(declare\s+)?(abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/ },
  { kind: 'interface', re: /^\s*(export\s+)?(declare\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)\b/ },
  { kind: 'type', re: /^\s*(export\s+)?(declare\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b\s*=/ },
];

/** @type {Map<string, Array<{rawName:string, normalizedName:string, kind:'class'|'interface'|'type', file:string, line:number, text:string}>>} */
const groups = new Map();

for (const file of files) {
  const abs = path.resolve(process.cwd(), file);
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of declPatterns) {
      const m = line.match(p.re);
      if (!m) continue;
      const rawName = p.kind === 'class' ? m[4] : m[3];
      const normalizedName = normalizeName(rawName);
      const entry = { rawName, normalizedName, kind: p.kind, file, line: i + 1, text: line.trim() };
      const arr = groups.get(normalizedName) ?? [];
      arr.push(entry);
      groups.set(normalizedName, arr);
      break;
    }
  }
}

const duplicatesAll = Array.from(groups.entries())
  .filter(([, occ]) => occ.length > 1)
  .map(([name, occ]) => ({ name, count: occ.length, occurrences: occ }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const duplicatesNonTest = duplicatesAll
  .map((d) => ({ ...d, occurrences: d.occurrences.filter((o) => !isTestFile(o.file)) }))
  .map((d) => ({ ...d, count: d.occurrences.length }))
  .filter((d) => d.count > 1);

const declarationsNonTest = Array.from(groups.values())
  .flat()
  .filter((d) => !isTestFile(d.file));

function collectKeywordMatches(keyword) {
  return declarationsNonTest.filter((d) => d.rawName.includes(keyword));
}

const interfaceKeywordMatches = collectKeywordMatches('Interface');
const typeKeywordMatches = collectKeywordMatches('Type');
const typeSafeKeywordMatches = collectKeywordMatches('TypeSafe');

const classifiedNonTest = duplicatesNonTest.map((d) => {
  const kindSet = new Set(d.occurrences.map((o) => o.kind));
  const roots = Array.from(new Set(d.occurrences.map((o) => rootOf(o.file)))).sort();
  const sameKind = kindSet.size === 1;
  const isContractImplementationPair = kindSet.size === 2 && kindSet.has('class') && kindSet.has('interface') && d.count === 2;

  return {
    ...d,
    roots,
    kindSet: Array.from(kindSet).sort(),
    classification: isContractImplementationPair ? 'contract_implementation_pair' : sameKind ? 'same_kind_duplicate' : 'mixed_kinds_duplicate',
  };
});

const contractImplementationPairsNonTest = classifiedNonTest.filter((d) => d.classification === 'contract_implementation_pair');
const ssotViolationsNonTest = classifiedNonTest.filter((d) => d.classification !== 'contract_implementation_pair');

const report = {
  version: 3,
  scannedFiles: files.length,
  duplicateGroupsAll: duplicatesAll.length,
  // NOTE: This count includes contract+implementation pairs for backward visibility.
  duplicateGroupsNonTest: duplicatesNonTest.length,
  // NOTE: This count excludes contract+implementation pairs to focus on SSOT violations only.
  ssotViolationGroupsNonTest: ssotViolationsNonTest.length,
  crossRootGroupsNonTest: classifiedNonTest.filter((d) => d.roots.length > 1).length,
  sameKindGroupsNonTest: classifiedNonTest.filter((d) => d.classification === 'same_kind_duplicate').length,
  contractImplementationPairsNonTest: contractImplementationPairsNonTest.length,
  keywordInventoryNonTest: {
    interfaceKeywordCount: interfaceKeywordMatches.length,
    typeKeywordCount: typeKeywordMatches.length,
    typeSafeKeywordCount: typeSafeKeywordMatches.length,
    interfaceKeywordSamples: interfaceKeywordMatches.slice(0, 40),
    typeKeywordSamples: typeKeywordMatches.slice(0, 40),
    typeSafeKeywordSamples: typeSafeKeywordMatches.slice(0, 40),
  },
  // SSOT violations only (exclude contract+implementation pairs)
  duplicatesNonTest: ssotViolationsNonTest,
  // Contract/implementation pairs kept separately for visibility
  contractImplementationPairsNonTestDetails: contractImplementationPairsNonTest,
};

fs.writeFileSync('scripts/audit/output/ssot-duplicate-declarations-v3.json', JSON.stringify(report, null, 2));

console.log(
  `[SSOT-SCAN:v3] scannedFiles=${report.scannedFiles} ` +
  `dupAll=${report.duplicateGroupsAll} dupNonTest=${report.ssotViolationGroupsNonTest} ` +
  `crossRootNonTest=${report.crossRootGroupsNonTest} sameKindNonTest=${report.sameKindGroupsNonTest} ` +
  `contractImplPairsNonTest=${report.contractImplementationPairsNonTest} ` +
  `kwInterface=${report.keywordInventoryNonTest.interfaceKeywordCount} ` +
  `kwType=${report.keywordInventoryNonTest.typeKeywordCount} ` +
  `kwTypeSafe=${report.keywordInventoryNonTest.typeSafeKeywordCount}`
);


