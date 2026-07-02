#!/usr/bin/env node

/**
 * llms.txt link-rot scan (DOCS-017).
 *
 * The root `llms.txt` is the consumer-agent map (llmstxt.org convention): a thin index whose value
 * is entirely in its links. A moved/renamed owner document silently turns the map into the exact
 * misdirection it was written to prevent, so every repo-relative markdown link in it must resolve.
 *
 * Findings:
 *   - llms.txt missing at the repository root
 *   - a markdown link target (non-http) that does not exist on disk
 *
 * Exit code 0 = map is intact, 1 = missing file or dangling link.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const LLMS_TXT = 'llms.txt';

const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;

/** Extract repo-relative link targets (http(s) and anchors are out of scope). */
export function extractLocalLinks(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(LINK_PATTERN)) {
    const target = match[1].trim();
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    targets.push(target.split('#')[0]);
  }
  return targets;
}

export async function main() {
  const filePath = path.join(WORKSPACE_ROOT, LLMS_TXT);
  let markdown;
  try {
    markdown = await fs.readFile(filePath, 'utf8');
  } catch {
    // allow-fallback: absence of the map file IS the finding this scan reports
    process.stdout.write(`llms-txt scan failed: ${LLMS_TXT} is missing at the repository root.\n`);
    process.exitCode = 1;
    return;
  }

  const dangling = [];
  const targets = extractLocalLinks(markdown);
  for (const target of targets) {
    try {
      await fs.access(path.join(WORKSPACE_ROOT, target));
    } catch {
      // allow-fallback: a non-resolving path IS the finding this scan reports
      dangling.push(target);
    }
  }

  if (dangling.length > 0) {
    process.stdout.write('llms-txt scan failed — dangling links in llms.txt:\n');
    for (const target of dangling) {
      process.stdout.write(`  - ${target}\n`);
    }
    process.stdout.write('Update the link to the moved/renamed owner document.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`llms-txt scan passed (${targets.length} links resolve).\n`);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
