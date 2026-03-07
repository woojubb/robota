import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as ts from 'typescript';

function isTargetFile(file) {
  if (!(file.startsWith('packages/') || file.startsWith('apps/'))) return false;
  if (!(file.endsWith('.ts') || file.endsWith('.tsx'))) return false;
  if (file.includes('/dist/')) return false;
  if (file.startsWith('docs/api-reference/')) return false;
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

function fileRoot(file) {
  const parts = file.split('/');
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : file;
}

function getHeritageNames(sourceFile, heritageClause) {
  return heritageClause.types
    .map((t) => {
      const expr = t.expression;
      return expr.getText(sourceFile);
    })
    .filter(Boolean);
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {ts.ClassDeclaration} node
 */
function getClassInfo(sourceFile, node) {
  const className = node.name ? node.name.text : null;
  if (!className) return null;

  const isAbstract = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

  const extendsNames = [];
  const implementsNames = [];

  for (const heritage of node.heritageClauses ?? []) {
    if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
      extendsNames.push(...getHeritageNames(sourceFile, heritage));
    } else if (heritage.token === ts.SyntaxKind.ImplementsKeyword) {
      implementsNames.push(...getHeritageNames(sourceFile, heritage));
    }
  }

  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    className,
    line: pos.line + 1,
    isAbstract,
    extendsName: extendsNames.length > 0 ? extendsNames[0] : null,
    implementsNames,
  };
}

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter(isTargetFile)
  .filter((f) => !isTestFile(f));

/** @type {Array<{file:string, root:string, className:string, line:number, isAbstract:boolean, extendsName:string|null, implementsNames:string[]}>} */
const classes = [];

for (const file of files) {
  const abs = path.resolve(process.cwd(), file);
  const sourceText = fs.readFileSync(abs, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  /** @param {ts.Node} n */
  function visit(n) {
    if (ts.isClassDeclaration(n)) {
      const info = getClassInfo(sourceFile, n);
      if (info) {
        classes.push({
          file,
          root: fileRoot(file),
          ...info,
        });
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(sourceFile);
}

/** @type {Map<string, Array<typeof classes[number]>>} */
const interfaceToImplementers = new Map();

/** @type {Map<string, Array<typeof classes[number]>>} */
const baseClassToDerived = new Map();

/** @type {Map<string, typeof classes[number]>} */
const classByName = new Map();

for (const c of classes) {
  classByName.set(c.className, c);
  for (const iface of c.implementsNames) {
    const arr = interfaceToImplementers.get(iface) ?? [];
    arr.push(c);
    interfaceToImplementers.set(iface, arr);
  }
  if (c.extendsName) {
    const arr = baseClassToDerived.get(c.extendsName) ?? [];
    arr.push(c);
    baseClassToDerived.set(c.extendsName, arr);
  }
}

const interfaceImplementations = Array.from(interfaceToImplementers.entries())
  .map(([interfaceName, implementers]) => {
    const classesSorted = [...implementers].sort((a, b) =>
      a.className.localeCompare(b.className) || a.file.localeCompare(b.file) || a.line - b.line
    );
    return {
      interfaceName,
      implementingClassCount: implementers.length,
      implementingClasses: classesSorted.map((c) => ({
        className: c.className,
        file: c.file,
        line: c.line,
        isAbstract: c.isAbstract,
        extendsName: c.extendsName,
        root: c.root,
      })),
    };
  })
  .sort((a, b) => b.implementingClassCount - a.implementingClassCount || a.interfaceName.localeCompare(b.interfaceName));

const interfacesWithMultipleImplementations = interfaceImplementations.filter((x) => x.implementingClassCount > 1);

const baseImplementsThenExtendsChains = [];
for (const [interfaceName, implementers] of interfaceToImplementers.entries()) {
  const baseCandidates = implementers.filter((c) => baseClassToDerived.has(c.className));
  for (const base of baseCandidates) {
    const derived = baseClassToDerived.get(base.className) ?? [];
    baseImplementsThenExtendsChains.push({
      interfaceName,
      baseClass: {
        className: base.className,
        file: base.file,
        line: base.line,
        isAbstract: base.isAbstract,
        root: base.root,
      },
      derivedClassCount: derived.length,
      derivedClasses: [...derived]
        .sort((a, b) => a.className.localeCompare(b.className) || a.file.localeCompare(b.file) || a.line - b.line)
        .map((c) => ({
          className: c.className,
          file: c.file,
          line: c.line,
          isAbstract: c.isAbstract,
          root: c.root,
        })),
    });
  }
}

baseImplementsThenExtendsChains.sort(
  (a, b) =>
    b.derivedClassCount - a.derivedClassCount ||
    a.interfaceName.localeCompare(b.interfaceName) ||
    a.baseClass.className.localeCompare(b.baseClass.className)
);

const report = {
  version: 1,
  scannedFiles: files.length,
  scannedClasses: classes.length,
  interfacesWithAtLeastOneImplementer: interfaceImplementations.length,
  interfacesWithMultipleImplementations: interfacesWithMultipleImplementations.length,
  baseImplementsThenExtendsChains: baseImplementsThenExtendsChains.length,
  interfaceImplementations,
  interfacesWithMultipleImplementationsDetails: interfacesWithMultipleImplementations,
  baseImplementsThenExtendsChainsDetails: baseImplementsThenExtendsChains,
};

const outFile = 'scripts/audit/output/implements-audit.json';
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log(
  `[IMPLEMENTS-AUDIT:v1] scannedFiles=${report.scannedFiles} ` +
    `scannedClasses=${report.scannedClasses} ` +
    `interfacesWithImplementers=${report.interfacesWithAtLeastOneImplementer} ` +
    `interfacesWithMultiImpl=${report.interfacesWithMultipleImplementations} ` +
    `baseImplementsThenExtendsChains=${report.baseImplementsThenExtendsChains} ` +
    `out=${outFile}`
);


