#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(appDirectory, '..', '..');
const source = join(workspaceRoot, '.product', 'identity.json');
const outputDirectory = join(appDirectory, 'dist', 'electron');
const destination = join(outputDirectory, 'product-identity.json');

rmSync(destination, { force: true });
if (existsSync(source)) {
  mkdirSync(outputDirectory, { recursive: true });
  copyFileSync(source, destination);
}
