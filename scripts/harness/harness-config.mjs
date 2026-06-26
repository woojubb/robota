#!/usr/bin/env node

/**
 * Loader for the externalized harness policy (`.agents/harness.config.json`, HARNESS-020).
 *
 * The scan scripts are a repo-agnostic engine; project-specific policy (npm scope prefix,
 * allowed internal deps, product-shell dirs, env names) is data, loaded here. Edit the JSON,
 * not the scripts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.cwd(), '.agents', 'harness.config.json');

let cached;

export function loadHarnessConfig() {
  if (!cached) {
    cached = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  return cached;
}
