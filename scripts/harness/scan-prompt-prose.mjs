/**
 * Harness scanner: mechanical floor for MODEL-FACING INSTRUCTION PROSE in library sources —
 * ENFORCED as a FROZEN-BASELINE RATCHET (NEUT-006; audit
 * .design/audits/2026-07-24-neutrality-prompt-audit.md, gap #6).
 *
 * The five neutrality scans guard dependencies / identifiers / corpus files — not prompt TEXT.
 * Nothing stopped the next "helpful default prompt" landing in a neutral library layer unseen
 * (exactly how the 2026-03..05 debt accumulated). This scan detects instruction prose in known
 * prompt sinks (tool `description:` fields, `*PROMPT`/`systemPrompt`-named consts and properties,
 * zod `.describe(...)`, positional tool-description arguments) using a word-count + imperative-
 * marker heuristic, then applies the repo's standard ratchet (cf. scan-file-size.mjs):
 *
 *   - `prompt-prose-baseline.json` records every pre-existing prompt-bearing file WITH the
 *     fingerprints (whitespace-normalized sha256) of its prose literals at adoption.
 *   - A file NOT in the baseline may carry NO prose literal — new prose in a neutral library
 *     file FAILS immediately; inject policy from the product layer instead.
 *   - A baselined file is FROZEN at its fingerprint list: any prose literal whose fingerprint is
 *     not in the frozen list (added OR reworded) FAILS — existing debt is frozen, not licensed.
 *   - Dropping prose is always allowed; when a baselined file sheds literals the scan prints a
 *     ratchet-tightening notice — regenerate with `--write-baseline` in the same PR so the
 *     ratchet only ever tightens (the baseline shrinks as NEUT-001..005 land).
 *
 * `--write-baseline` regenerates the baseline from the current tree (for adopting a deliberate,
 * reviewed prompt change).
 *
 * Additionally asserts the audit's ROLE-VOCABULARY invariant: a workflow role name bound in the
 * same file as a concrete model id (the role→model opinion) may live only in the chartered
 * defaults package(s).
 *
 * The ENGINE is repo-agnostic: scan roots, sink patterns, prose heuristic, exemptions, role
 * vocabulary, and the baseline path are POLICY data under the `promptProse` key of
 * `.agents/harness.config.json`.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { WORKSPACE_ROOT, pathExists } from './shared.mjs';

/**
 * Parse a JS string literal starting at `start` (which must point at ', " or `).
 * Escaped \n / \t / \r decode to a space so word counting and fingerprinting see prose, not
 * escape syntax. Template-literal interpolations (`${...}`) are blanked to whitespace (brace-
 * depth counted). Returns `{ text, end }` or undefined for non-literals / unterminated input.
 */
export function parseStringLiteral(content, start) {
  const quote = content[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;

  let out = '';
  let i = start + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      const next = content[i + 1];
      out += next === 'n' || next === 't' || next === 'r' ? ' ' : (next ?? '');
      i += 2;
      continue;
    }
    if (ch === quote) return { text: out, end: i };
    if (quote !== '`' && (ch === '\n' || ch === '\r')) return undefined; // unterminated
    if (quote === '`' && ch === '$' && content[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < content.length && depth > 0) {
        if (content[j] === '{') depth++;
        else if (content[j] === '}') depth--;
        j++;
      }
      out += ' ';
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return undefined;
}

function skipWhitespace(content, pos) {
  while (pos < content.length && /\s/.test(content[pos])) pos++;
  return pos;
}

/**
 * Find every string literal that directly follows one of the configured sink patterns.
 * When the sink value is an ARRAY of literals (`[ 'a', 'b', ... ]` — the common
 * `[...].join('\n')` prompt-builder shape), every comma-separated element literal is captured.
 * A position is counted once even when multiple sink patterns match it.
 * @param {string} content
 * @param {RegExp[]} sinkRegexes global regexes matching the text immediately BEFORE the literal
 * @returns {Array<{index: number, text: string}>}
 */
export function extractSinkLiterals(content, sinkRegexes) {
  const literals = [];
  const seenPositions = new Set();

  function capture(pos) {
    const literal = parseStringLiteral(content, pos);
    if (literal === undefined) return undefined;
    if (!seenPositions.has(pos)) {
      seenPositions.add(pos);
      literals.push({ index: pos, text: literal.text });
    }
    return literal.end;
  }

  for (const regex of sinkRegexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      let pos = skipWhitespace(content, match.index + match[0].length);
      if (content[pos] === '[') {
        // Array of literals: capture each comma-separated element until a non-literal element.
        pos = skipWhitespace(content, pos + 1);
        for (;;) {
          const end = capture(pos);
          if (end === undefined) break;
          pos = skipWhitespace(content, end + 1);
          if (content[pos] !== ',') break;
          pos = skipWhitespace(content, pos + 1);
        }
      } else {
        capture(pos);
      }
    }
  }

  return literals.sort((a, b) => a.index - b.index);
}

/**
 * Prose heuristic: at least `minWords` words AND at least one imperative/instruction marker,
 * and not shaped like a non-prose payload (markup / code scaffold, per `nonProsePatterns`).
 * Short labels ("The absolute path to read") and neutral technical text stay out of scope.
 */
export function isPromptProse(text, { minWords, markerPattern, nonProsePatterns = [] }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < minWords) return false;
  if (nonProsePatterns.some((pattern) => new RegExp(pattern).test(text))) return false;
  return new RegExp(markerPattern, 'i').test(text);
}

/** Whitespace-normalized sha256 fingerprint (formatting-only edits do not move the ratchet). */
export function fingerprintLiteral(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Pure ratchet evaluation (exposed for tests).
 * @param {Array<{relPath: string, literals: Array<{hash: string, preview: string}>}>} fileEntries
 *   prose literals per file (files with zero prose may be omitted or passed empty)
 * @param {Record<string, {count: number, hashes: string[]}>} baseline frozen fingerprints
 * @returns {{findings: Array<{file, type, detail}>, tightenable: string[], stale: string[]}}
 */
export function evaluatePromptProse(fileEntries, baseline) {
  const findings = [];
  const tightenable = [];
  const seen = new Set();

  for (const { relPath, literals } of fileEntries) {
    if (literals.length === 0) continue;
    seen.add(relPath);
    const frozen = baseline[relPath];

    if (frozen === undefined) {
      for (const literal of literals) {
        findings.push({
          file: relPath,
          type: 'new-prose-in-library-file',
          detail: `model-facing instruction prose in a non-baselined library file: "${literal.preview}". Inject policy from the product/opinion layer instead of hardcoding it; a deliberate, reviewed prompt change must regenerate the baseline with --write-baseline in the same PR.`,
        });
      }
      continue;
    }

    const frozenHashes = new Set(frozen.hashes);
    let unfrozen = 0;
    for (const literal of literals) {
      if (!frozenHashes.has(literal.hash)) {
        unfrozen++;
        findings.push({
          file: relPath,
          type: 'prose-past-baseline',
          detail: `prose literal not in the frozen baseline (added or reworded): "${literal.preview}". Frozen debt may shrink but never grow; a deliberate, reviewed prompt change must regenerate the baseline with --write-baseline in the same PR.`,
        });
      }
    }
    if (unfrozen === 0 && literals.length < frozen.hashes.length) {
      tightenable.push(relPath);
    }
  }

  const stale = Object.keys(baseline).filter((relPath) => !seen.has(relPath));
  return { findings, tightenable, stale };
}

/**
 * Role-vocabulary invariant (audit delta): a workflow role name AND a concrete model id in the
 * same library file is the role→model OPINION and may live only in the chartered defaults
 * package(s). Either term alone is fine (role words have other senses; model catalogs are data).
 * @param {Array<{relPath: string, content: string}>} files
 * @param {{roleTermPattern: string, modelIdPatterns: string[], allowedPathIncludes: string[]}} cfg
 */
export function evaluateRoleVocabulary(files, cfg) {
  const roleRegex = new RegExp(cfg.roleTermPattern);
  const modelRegexes = cfg.modelIdPatterns.map((pattern) => new RegExp(pattern));
  const findings = [];

  for (const { relPath, content } of files) {
    if (cfg.allowedPathIncludes.some((allowed) => relPath.includes(allowed))) continue;
    const roleMatch = content.match(roleRegex);
    if (roleMatch === null) continue;
    let modelMatch;
    for (const regex of modelRegexes) {
      modelMatch = content.match(regex);
      if (modelMatch !== null) break;
    }
    if (!modelMatch) continue;
    findings.push({
      file: relPath,
      type: 'role-model-binding-outside-defaults',
      detail: `role vocabulary (${JSON.stringify(roleMatch[0].trim())}) appears alongside a concrete model id (${JSON.stringify(modelMatch[0])}); the role→model opinion belongs only in ${cfg.allowedPathIncludes.join(', ')}.`,
    });
  }

  return findings;
}

function loadPromptProseConfig() {
  const config = loadHarnessConfig().promptProse;
  if (config === undefined) {
    throw new Error(
      'missing `promptProse` key in .agents/harness.config.json — the scan has no policy to enforce.',
    );
  }
  return config;
}

function isExcluded(relPath, config) {
  return config.excludePathIncludes.some((pattern) => relPath.includes(pattern));
}

async function collectSourceFiles(config) {
  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__')
          continue;
        await walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const rel = path.relative(WORKSPACE_ROOT, full);
        if (isExcluded(rel, config)) continue;
        if (!config.srcPathIncludes.some((segment) => rel.includes(segment))) continue;
        results.push({ absPath: full, relPath: rel });
      }
    }
  }

  for (const root of config.scanRoots) {
    const absRoot = path.join(WORKSPACE_ROOT, root);
    if (await pathExists(absRoot)) await walk(absRoot);
  }
  return results;
}

async function measureAll(config) {
  const sinkRegexes = config.sinkPatterns.map(
    (sink) =>
      new RegExp(sink.pattern, sink.flags?.includes('g') ? sink.flags : `${sink.flags ?? ''}g`),
  );
  const proseEntries = [];
  const roleFiles = [];

  for (const { absPath, relPath } of await collectSourceFiles(config)) {
    const content = await fs.readFile(absPath, 'utf8');
    roleFiles.push({ relPath, content });
    if (config.exemptPathIncludes.some((pattern) => relPath.includes(pattern))) continue;
    const literals = extractSinkLiterals(content, sinkRegexes)
      .filter((literal) => isPromptProse(literal.text, config.prose))
      .map((literal) => ({
        hash: fingerprintLiteral(literal.text),
        preview: `${literal.text.replace(/\s+/g, ' ').trim().slice(0, 70)}…`,
      }));
    if (literals.length > 0) proseEntries.push({ relPath, literals });
  }

  return { proseEntries, roleFiles };
}

async function loadBaseline(baselineAbsPath) {
  try {
    return JSON.parse(await fs.readFile(baselineAbsPath, 'utf8'));
  } catch {
    return {}; // no baseline file → every prose literal fails (the strictest mode)
  }
}

async function main() {
  const config = loadPromptProseConfig();
  const baselineAbsPath = path.join(WORKSPACE_ROOT, config.baselinePath);
  const { proseEntries, roleFiles } = await measureAll(config);

  if (process.argv.includes('--write-baseline')) {
    const next = {};
    for (const { relPath, literals } of proseEntries.sort((a, b) =>
      a.relPath.localeCompare(b.relPath),
    )) {
      next[relPath] = { count: literals.length, hashes: literals.map((l) => l.hash) };
    }
    await fs.writeFile(baselineAbsPath, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(next).reduce((sum, entry) => sum + entry.count, 0);
    process.stdout.write(
      `prompt-prose baseline regenerated: ${Object.keys(next).length} file(s), ${total} frozen prose literal(s).\n`,
    );
    return;
  }

  const baseline = await loadBaseline(baselineAbsPath);
  const { findings, tightenable, stale } = evaluatePromptProse(proseEntries, baseline);
  findings.push(...evaluateRoleVocabulary(roleFiles, config.roleVocabulary));

  for (const relPath of tightenable) {
    process.stdout.write(
      `- [ratchet-tighten] ${relPath} shed baselined prose — run \`node scripts/harness/scan-prompt-prose.mjs --write-baseline\` to lock in the gain.\n`,
    );
  }
  for (const relPath of stale) {
    process.stdout.write(
      `- [stale-baseline] ${relPath} no longer carries baselined prose (cleaned or deleted) — regenerate the baseline to lock in the gain.\n`,
    );
  }

  if (findings.length === 0) {
    const frozenFiles = Object.keys(baseline).length;
    const frozenLiterals = Object.values(baseline).reduce((sum, entry) => sum + entry.count, 0);
    process.stdout.write(
      `harness prompt-prose scan passed (${frozenFiles} baselined file(s), ${frozenLiterals} frozen prose literal(s)).\n`,
    );
    return;
  }

  process.stdout.write(`harness prompt-prose scan: ${findings.length} finding(s):\n`);
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
