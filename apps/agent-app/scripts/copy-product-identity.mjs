#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { embeddedProductIdentity, resolveProductConfig } from '@robota-sdk/product-config';

export function copyProductIdentity({
  appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..'),
  workspaceRoot = join(appDirectory, '..', '..'),
} = {}) {
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
  const generated = existsSync(source);
  if (generated) copyFileSync(source, destination);
  else {
    const { robotaEnvironment } = createRequire(import.meta.url)(join(outputDirectory, 'robota.js'));
    const builtInConfig = resolveProductConfig({ environment: robotaEnvironment({}, '/__artifact_home__') });
    writeFileSync(destination, `${JSON.stringify(embeddedProductIdentity(builtInConfig), null, 2)}\n`);
  }

  const defaultsSource = join(workspaceRoot, '.product', 'runtime-defaults.json');
  const defaultsDestination = join(outputDirectory, 'product-runtime-defaults.json');
  rmSync(defaultsDestination, { force: true });
  if (existsSync(defaultsSource)) copyFileSync(defaultsSource, defaultsDestination);
  else if (!generated) writeFileSync(defaultsDestination, `${JSON.stringify({
    PRODUCT_USER_STATE_DIR: '.robota',
    PRODUCT_CACHE_DIR: '.robota/cache',
    PRODUCT_LOG_DIR: '.robota/logs',
    PRODUCT_PROJECT_STATE_DIR: '.robota',
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) copyProductIdentity();
