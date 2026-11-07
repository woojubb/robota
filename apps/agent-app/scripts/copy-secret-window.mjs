#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'electron', 'secret');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { recursive: true, force: true });
cpSync(join(root, 'electron', 'secret'), output, { recursive: true });
