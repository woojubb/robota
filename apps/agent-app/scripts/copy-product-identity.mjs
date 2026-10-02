#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(appDirectory, '..', '..');
const source = join(workspaceRoot, '.product', 'identity.json');
const outputDirectory = join(appDirectory, 'dist', 'electron');
const destination = join(outputDirectory, 'product-identity.json');

mkdirSync(outputDirectory, { recursive: true });
const policy = readFileSync(join(workspaceRoot, 'products', 'robota.mjs'), 'utf8');
const compiledPolicy = ts.transpileModule(policy, {
  fileName: 'robota.js',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
writeFileSync(join(outputDirectory, 'robota.js'), compiledPolicy.outputText);
rmSync(destination, { force: true });
if (existsSync(source)) {
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(source, destination);
}
