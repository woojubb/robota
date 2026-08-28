#!/usr/bin/env node

/**
 * Prove that user-execution PLAN completed before implementation (HARNESS-121).
 *
 * Presence in the final tree is not ordering: HARNESS-119 added its not-applicable verdict after
 * implementation and the old section scan could not tell. This guard uses the causal boundary Git
 * already records. A work unit gets one planning-only checkpoint commit containing the exact Task's
 * complete PLAN outcome and the paired spec's GATE-IMPLEMENT PASS. Every other path is implementation
 * and may change only after that checkpoint is an ancestor.
 *
 * Two entry points share this engine:
 *   - default: replay every commit after the topic merge base (CI / harness scan);
 *   - --staged: reject the proposed commit before Git creates it (Husky pre-commit).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { asScalar, frontmatterObject } from './frontmatter.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASK_PREFIX = '.agents/tasks/';
const SPEC_PREFIX = '.agents/spec-docs/';
const POST_MERGE_LEDGER = '.agents/loop-runs/post-merge-cycle.jsonl';
const UES_LEDGER = '.agents/loop-runs/user-execution-scenario.jsonl';
const SPEC_FOLDERS = new Set(['draft', 'backlog', 'todo', 'active', 'done']);
const PRE_CHECKPOINT_SPEC_STATUS = new Map([
  ['draft', 'draft'],
  ['backlog', 'review-ready'],
  ['todo', 'approved'],
]);
const LOOP_TERMINALS = new Set([
  'converged',
  'no-progress',
  'bound-reached',
  'halted-for-user',
  'abandoned',
]);

function finding(problem, commit = null) {
  return { commit, problem };
}

export function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').trim(),
  };
}

function lines(text) {
  return text.split('\n').filter((line) => line.length > 0);
}

function nulPaths(text) {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function gitText(root, revision, file) {
  const result = runGit(root, ['show', `${revision}:${file}`]);
  return result.code === 0 ? result.stdout : null;
}

function indexText(root, file) {
  const result = runGit(root, ['show', `:${file}`]);
  return result.code === 0 ? result.stdout : null;
}

function changedPaths(root, from, to) {
  const result = runGit(root, ['diff', '--name-only', '-z', '--no-renames', from, to, '--']);
  if (result.code !== 0) {
    throw new Error(`git diff ${from} ${to} failed: ${result.stderr || '(no stderr)'}`);
  }
  return nulPaths(result.stdout);
}

function stagedPaths(root) {
  const result = runGit(root, [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    '--no-renames',
    'HEAD',
    '--',
  ]);
  if (result.code !== 0) throw new Error(`staged diff failed: ${result.stderr || '(no stderr)'}`);
  return nulPaths(result.stdout);
}

function worktreePaths(root) {
  const unstaged = runGit(root, ['diff', '--name-only', '-z', '--no-renames', '--']);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (unstaged.code !== 0 || untracked.code !== 0) {
    throw new Error(
      `worktree query failed: ${unstaged.stderr || untracked.stderr || '(no stderr)'}`,
    );
  }
  return [...new Set([...nulPaths(unstaged.stdout), ...nulPaths(untracked.stdout)])];
}

function taskBasename(file) {
  if (!file.startsWith(TASK_PREFIX)) return null;
  const relative = file.slice(TASK_PREFIX.length);
  const withoutCompleted = relative.startsWith('completed/')
    ? relative.slice('completed/'.length)
    : relative;
  return withoutCompleted.endsWith('.md') ? withoutCompleted : null;
}

function specBasename(file) {
  if (!file.startsWith(SPEC_PREFIX)) return null;
  const relative = file.slice(SPEC_PREFIX.length);
  const slash = relative.indexOf('/');
  if (slash === -1) return null;
  const folder = relative.slice(0, slash);
  const basename = relative.slice(slash + 1);
  return SPEC_FOLDERS.has(folder) && basename.endsWith('.md') ? basename : null;
}

function activePairCandidates(paths) {
  const tasks = new Set(
    paths
      .filter((file) => file.startsWith(TASK_PREFIX) && !file.includes('/completed/'))
      .map(taskBasename)
      .filter(Boolean),
  );
  const activeSpecs = new Set(
    paths
      .filter((file) => file.startsWith(`${SPEC_PREFIX}active/`))
      .map(specBasename)
      .filter(Boolean),
  );
  return [...tasks].filter((basename) => activeSpecs.has(basename)).sort();
}

function planningBasenames(paths) {
  return [
    ...new Set(paths.map((file) => taskBasename(file) ?? specBasename(file)).filter(Boolean)),
  ].sort();
}

function subjectId(basename) {
  const match = /^([A-Z][A-Z0-9]*-\d+)(?:-|\.md)/.exec(basename);
  return match?.[1] ?? null;
}

function isExactCheckpointPairPath(file, basename) {
  return file === `${TASK_PREFIX}${basename}` || file === `${SPEC_PREFIX}active/${basename}`;
}

function isPreCheckpointPlanningPath(file, basename) {
  if (file === `${TASK_PREFIX}${basename}`) return true;
  if (!file.startsWith(SPEC_PREFIX) || specBasename(file) !== basename) return false;
  const folder = file.slice(SPEC_PREFIX.length).split('/', 1)[0];
  return PRE_CHECKPOINT_SPEC_STATUS.has(folder);
}

function frontmatterStatus(text) {
  const status = asScalar(frontmatterObject(text ?? '').status).trim();
  return status === '' ? null : status;
}

function isEscapedDelimiter(line, at) {
  let slashes = 0;
  for (let index = at - 1; index >= 0 && line[index] === '\\'; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function startsParagraphInterruptingHtmlBlock(line) {
  return (
    /^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(line) ||
    /^ {0,3}<!--/.test(line) ||
    /^ {0,3}<\?/.test(line) ||
    /^ {0,3}<!\[CDATA\[/.test(line) ||
    /^ {0,3}<![A-Z]/.test(line) ||
    /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hgroup|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i.test(
      line,
    )
  );
}

function startsNewMarkdownBlock(line) {
  return (
    line.trim() === '' ||
    /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
    fenceOpening(line) !== null ||
    /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) ||
    /^ {0,3}(?:=+|-+)\s*$/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/.test(line) ||
    startsParagraphInterruptingHtmlBlock(line)
  );
}

function fenceOpening(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  return match[1];
}

function hasMatchingBacktickRun(lines, lineIndex, cursor, length) {
  for (let index = lineIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > lineIndex && startsNewMarkdownBlock(line)) return false;
    let at = index === lineIndex ? cursor : 0;
    while (at < line.length) {
      if (line[at] !== '`') {
        at += 1;
        continue;
      }
      let end = at + 1;
      while (line[end] === '`') end += 1;
      if (end - at === length) return true;
      at = end;
    }
  }
  return false;
}

function stripHtmlCommentsOutsideCode(line, state, hasClosingRun) {
  let output = '';
  let cursor = 0;
  while (cursor < line.length) {
    if (state.comment) {
      const close = line.indexOf('-->', cursor);
      if (close === -1) return output;
      state.comment = false;
      cursor = close + 3;
      continue;
    }
    if (line[cursor] === '`') {
      if (state.codeSpan === null && isEscapedDelimiter(line, cursor)) {
        output += line[cursor];
        cursor += 1;
        continue;
      }
      let end = cursor + 1;
      while (line[end] === '`') end += 1;
      const length = end - cursor;
      if (state.codeSpan === null && hasClosingRun(end, length)) state.codeSpan = length;
      else if (state.codeSpan === length) state.codeSpan = null;
      output += line.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (
      state.codeSpan === null &&
      line.startsWith('<!--', cursor) &&
      !isEscapedDelimiter(line, cursor)
    ) {
      state.comment = true;
      cursor += 4;
      continue;
    }
    output += line[cursor];
    cursor += 1;
  }
  return output;
}

function visibleMarkdown(text) {
  const kept = [];
  let fence = null;
  let htmlBlockEnd = null;
  let paragraphOpen = false;
  const inlineState = { comment: false, codeSpan: null };
  const sourceLines = String(text ?? '').split('\n');
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const rawLine = sourceLines[lineIndex];
    let line = rawLine;
    if (htmlBlockEnd !== null) {
      if (htmlBlockEnd === 'blank') {
        if (line.trim() === '') htmlBlockEnd = null;
      } else if (htmlBlockEnd.test(line)) {
        htmlBlockEnd = null;
      }
      paragraphOpen = false;
      continue;
    }
    if (fence !== null) {
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1] ?? null;
      if (closing !== null && closing[0] === fence.character && closing.length >= fence.length) {
        fence = null;
      }
      paragraphOpen = false;
      continue;
    }
    const rawOpening = fenceOpening(line);
    if (!inlineState.comment && inlineState.codeSpan === null && rawOpening !== null) {
      fence = { character: rawOpening[0], length: rawOpening.length };
      paragraphOpen = false;
      continue;
    }
    if (
      !paragraphOpen &&
      !inlineState.comment &&
      inlineState.codeSpan === null &&
      /^(?: {4}|\t)/.test(line)
    ) {
      continue;
    }
    line = stripHtmlCommentsOutsideCode(line, inlineState, (cursor, length) =>
      hasMatchingBacktickRun(sourceLines, lineIndex, cursor, length),
    );
    const opening = fenceOpening(line);
    if (opening !== null) {
      fence = { character: opening[0], length: opening.length };
      paragraphOpen = false;
      continue;
    }
    if (!paragraphOpen && /^(?: {4}|\t)/.test(line)) continue;
    if (line.trim() === '') {
      kept.push(line);
      paragraphOpen = false;
      continue;
    }
    const rawStart = /^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.exec(line)?.[1];
    if (rawStart) {
      htmlBlockEnd = new RegExp(`</${rawStart}>`, 'i');
      if (htmlBlockEnd.test(line)) htmlBlockEnd = null;
      paragraphOpen = false;
      continue;
    }
    if (/^ {0,3}<\?/.test(line)) {
      if (!line.includes('?>')) htmlBlockEnd = /\?>/;
      paragraphOpen = false;
      continue;
    }
    if (/^ {0,3}<!\[CDATA\[/.test(line)) {
      if (!line.includes(']]>')) htmlBlockEnd = /\]\]>/;
      paragraphOpen = false;
      continue;
    }
    if (/^ {0,3}<![A-Z]/.test(line)) {
      if (!line.includes('>')) htmlBlockEnd = />/;
      paragraphOpen = false;
      continue;
    }
    const typeSix =
      /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hgroup|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i.test(
        line,
      );
    const typeSeven = /^ {0,3}<\/?[A-Za-z][^>]*>\s*$/.test(line);
    if (typeSix || (!paragraphOpen && typeSeven)) {
      htmlBlockEnd = 'blank';
      paragraphOpen = false;
      continue;
    }
    kept.push(line);
    paragraphOpen = !(
      /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
      /^ {0,3}(?:=+|-+)\s*$/.test(line) ||
      /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)
    );
  }
  return kept.join('\n');
}

function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (!match) return null;
  const rawContent = match[2] ?? '';
  return {
    level: match[1].length,
    content: rawContent.replace(/[ \t]+#+[ \t]*$/, '').trim(),
  };
}

function markdownSection(text, heading) {
  const source = visibleMarkdown(text).split('\n');
  const wantedLevel = /^#+/.exec(heading)?.[0].length ?? 0;
  const wantedContent = heading.replace(/^#+\s+/, '');
  const start = source.findIndex((line) => {
    const parsed = atxHeading(line);
    return parsed?.level === wantedLevel && parsed.content === wantedContent;
  });
  if (start === -1) return null;
  let end = source.length;
  for (let index = start + 1; index < source.length; index += 1) {
    const next = atxHeading(source[index]);
    if (next && next.level <= wantedLevel) {
      end = index;
      break;
    }
  }
  return source.slice(start + 1, end).join('\n');
}

function isCanonicalDatedPass(content, gateName) {
  const match = new RegExp(`^\\[${gateName}\\] — ✅ PASS \\| (\\d{4}-\\d{2}-\\d{2})$`).exec(
    content,
  );
  if (!match) return false;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1];
}

function canonicalPassEntries(section, gateName) {
  const lines = String(section ?? '').split('\n');
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = atxHeading(lines[index]);
    if (heading?.level !== 3 || !isCanonicalDatedPass(heading.content, gateName)) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = atxHeading(lines[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    entries.push(lines.slice(index + 1, end).join('\n'));
  }
  return entries;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExactMarkdownToken(text, token) {
  return new RegExp(`(^|[\\s\`])${escapeRegExp(token)}(?=$|[\\s\`])`, 'm').test(text);
}

function completeGateImplementEntry(body, binding = null) {
  const structurallyComplete =
    /^\*\*Status upgrade:\*\* approved → in-progress\s*$/m.test(body) &&
    /\.agents\/tasks\/[A-Z][A-Z0-9]*-\d+[^\s`]*\.md/.test(body) &&
    /SCENARIO DRAFTED:\s*(?:not-applicable|automatable|manual)\s*\|\s*\d+/.test(body) &&
    // Contained — HARNESS-128. The catalogue writes `whole worktree` (soft-wrapped in its
    // Evidence-to-record line); the fixture and every committed checkpoint wrote `Whole-worktree`.
    // Both spellings of one phrase are accepted. The token is still the scan's own, not a form the
    // catalogue declares — that is the root item. (issue #2378)
    /whole[-\s]+worktree/i.test(body);
  if (!structurallyComplete || binding === null) return structurallyComplete;
  const taskPath = `${TASK_PREFIX}${binding.basename}`;
  const hasSpecPath = ['todo', 'active'].some((state) =>
    hasExactMarkdownToken(body, `.agents/spec-docs/${state}/${binding.basename}`),
  );
  const evidenceSignals = [
    ...body.matchAll(
      /SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)(?!\d)/g,
    ),
  ];
  const hasExactSignal = evidenceSignals.some(
    (match) => match[1] === binding.signal.outcome && Number(match[2]) === binding.signal.count,
  );
  return hasExactMarkdownToken(body, taskPath) && hasSpecPath && hasExactSignal;
}

function normalizedScenarioLines(body) {
  return body
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, '')
        .replaceAll('**', ''),
    )
    .filter(Boolean);
}

function scenarioEntries(section) {
  const source = String(section ?? '').split('\n');
  const entries = [];
  for (let index = 0; index < source.length; index += 1) {
    const heading = atxHeading(source[index]);
    const identity =
      heading?.level === 3 ? /^Scenario ([1-9]\d*)(?::\s+.+)?$/.exec(heading.content) : null;
    if (!identity) continue;
    let end = source.length;
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const next = atxHeading(source[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    entries.push({
      number: Number(identity[1]),
      name: heading.content,
      body: source.slice(index + 1, end).join('\n'),
    });
  }
  return entries;
}

function scenarioField(fields, label) {
  const matches = fields.filter((line) => label.test(line));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(matches[0].indexOf(':') + 1).trim();
  return value || null;
}

function scenarioFieldCount(fields, label) {
  return fields.filter((line) => label.test(line)).length;
}

function tokenizeCanonicalShell(value) {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1).trim() : trimmed;
  if (!unwrapped || /[\r\n]/.test(unwrapped)) return null;
  const tokens = [];
  const operators = [];
  let token = '';
  let tokenStarted = false;
  let quote = null;
  let escaped = false;
  const finishToken = () => {
    if (tokenStarted) tokens.push(token);
    token = '';
    tokenStarted = false;
  };
  for (let index = 0; index < unwrapped.length; index += 1) {
    const character = unwrapped[index];
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '\\') {
        const next = unwrapped[index + 1];
        if (next !== undefined && '$`"\\\n'.includes(next)) escaped = true;
        else token += character;
      } else if (character === '`' || (character === '$' && unwrapped[index + 1] === '('))
        return null;
      else token += character;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      finishToken();
      continue;
    }
    if ('&;<>'.includes(character) || character === '`') return null;
    if (character === '$' && unwrapped[index + 1] === '(') return null;
    if (character === '|') {
      finishToken();
      operators.push({ tokenIndex: tokens.length, operator: '|' });
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote !== null || escaped) return null;
  finishToken();
  if (operators.length > 1) return null;
  if (operators.length === 1) {
    const pipe = operators[0];
    if (tokens[pipe.tokenIndex] !== 'grep' || pipe.tokenIndex === 0) return null;
  }
  return tokens.length > 0 ? { invocation: unwrapped, tokens, operators } : null;
}

function canonicalExamplePath(candidate) {
  if (!candidate || path.posix.isAbsolute(candidate) || /[$*?\[\]{}~]/.test(candidate)) return null;
  const segments = candidate.replace(/^\.\//, '').split('/');
  if (segments.includes('..') || !['examples', 'scratch'].includes(segments[0])) return null;
  const normalized = path.posix.normalize(segments.join('/'));
  return /^(?:examples|scratch)\/.+/.test(normalized) ? normalized : null;
}

function commandScriptPath(tokens) {
  let cursor = tokens[0] === 'pnpm' ? 3 : 1;
  const safeOptions = new Set(['--enable-source-maps', '--no-warnings', '--trace-warnings']);
  while (cursor < tokens.length && tokens[cursor].startsWith('-')) {
    const option = tokens[cursor];
    if (option === '--') {
      cursor += 1;
      break;
    }
    if (!safeOptions.has(option)) return null;
    cursor += 1;
  }
  return tokens[cursor] ?? null;
}

function canonicalProductStatePath(candidate) {
  if (
    !candidate ||
    path.posix.isAbsolute(candidate) ||
    /[$*?\[\]{}~\\]/.test(candidate) ||
    candidate.split('/').includes('..')
  ) {
    return null;
  }
  const normalized = path.posix.normalize(candidate.replace(/^\.\//, ''));
  return /^\.robota\/.*[^/]$/.test(normalized) ? normalized : null;
}

function productSurfaceInvocation(surface, command, uiSteps, browserSteps) {
  const shell = command === null ? null : tokenizeCanonicalShell(command);
  const invocation = shell?.invocation ?? browserSteps?.trim() ?? uiSteps?.trim() ?? null;
  if (!invocation) return null;
  if (surface === 'robota-cli' || surface === 'robota-tui') {
    const prefix = shell?.tokens.slice(0, 3).join(' ') ?? '';
    return shell && (shell.tokens[0] === 'robota' || prefix === 'pnpm exec robota')
      ? invocation
      : null;
  }
  if (surface === 'robota-browser-ui') {
    return browserSteps !== null || uiSteps !== null ? invocation : null;
  }
  if (surface === 'public-sdk-example') {
    if (!shell) return null;
    const direct =
      shell.tokens[0] === 'node' || shell.tokens[0] === 'tsx'
        ? commandScriptPath(shell.tokens)
        : shell.tokens.slice(0, 3).join(' ') === 'pnpm exec tsx'
          ? commandScriptPath(shell.tokens)
          : null;
    const hasPnpmDirectoryShape =
      shell.tokens[0] === 'pnpm' &&
      (shell.tokens[1] === '--dir' || shell.tokens[1] === '-C') &&
      shell.tokens[3] === 'run' &&
      Boolean(shell.tokens[4]) &&
      !shell.tokens[4].startsWith('-') &&
      !/[$*?\[\]{}~]/.test(shell.tokens[4]);
    const workingDirectory = hasPnpmDirectoryShape ? shell.tokens[2] : null;
    return canonicalExamplePath(direct ?? workingDirectory) !== null ? invocation : null;
  }
  return null;
}

function scenarioContract(body, outcome) {
  const fields = normalizedScenarioLines(body);
  const knownField =
    /^(?:executability|product surface|surface rationale|prerequisites?|command|browser steps?|ui steps?|automation barrier|unavailable capability|attempted automation|observable type|observable rationale|product state path|expected (?:observable|result)|cleanup|reset|evidence):\s*\S/i;
  if (!fields.every((line) => knownField.test(line))) return null;
  const executability = scenarioField(fields, /^executability:/i);
  const surface = scenarioField(fields, /^product surface:/i);
  const surfaceRationale = scenarioField(fields, /^surface rationale:/i);
  const command = scenarioField(fields, /^command:/i);
  const browserSteps = scenarioField(fields, /^browser steps?:/i);
  const uiSteps = scenarioField(fields, /^ui steps?:/i);
  const barrier = scenarioField(fields, /^automation barrier:/i);
  const unavailableCapability = scenarioField(fields, /^unavailable capability:/i);
  const attemptedAutomation = scenarioField(fields, /^attempted automation:/i);
  const observableType = scenarioField(fields, /^observable type:/i);
  const observableRationale = scenarioField(fields, /^observable rationale:/i);
  const productStatePath = scenarioField(fields, /^product state path:/i);
  const observable = scenarioField(fields, /^expected (?:observable|result):/i);
  const prerequisites = scenarioField(fields, /^prerequisites?:/i);
  const cleanup = scenarioField(fields, /^(?:cleanup|reset):/i);
  const evidence = scenarioField(fields, /^evidence:/i);
  const invocation = productSurfaceInvocation(surface, command, uiSteps, browserSteps);
  const allowedObservableTypes = new Map([
    ['robota-cli', new Set(['product-output', 'product-state-file'])],
    ['robota-tui', new Set(['product-output', 'ui-state', 'product-state-file'])],
    ['robota-browser-ui', new Set(['ui-state'])],
    ['public-sdk-example', new Set(['sdk-result'])],
  ]);
  const observableMatchesSurface =
    observableType !== null && allowedObservableTypes.get(surface)?.has(observableType) === true;
  const surfaceRationaleMatches =
    surfaceRationale ===
    new Map([
      ['robota-cli', 'shipped-entrypoint=robota'],
      ['robota-tui', 'shipped-entrypoint=robota'],
      ['robota-browser-ui', 'shipped-interface=robota-browser-ui'],
      ['public-sdk-example', 'shipped-interface=public-sdk-example'],
    ]).get(surface);
  const observableRationaleMatches =
    observableRationale ===
    new Map([
      ['product-output', 'source=product-process'],
      ['ui-state', 'source=rendered-product-ui'],
      ['sdk-result', 'source=public-sdk-return'],
      ['product-state-file', 'source=robota-state-artifact'],
    ]).get(observableType);
  const observableMatchesType =
    observableType === 'product-output'
      ? /^exit=(?:0|[1-9]\d*);\s*output-contains=\S.*$/.test(observable ?? '')
      : observableType === 'ui-state'
        ? /^visible=\S.*$/.test(observable ?? '')
        : observableType === 'sdk-result'
          ? /^result=\S.*$/.test(observable ?? '')
          : observableType === 'product-state-file'
            ? /^change=(?:created|updated|deleted)$/.test(observable ?? '')
            : false;
  const normalizedStatePath = canonicalProductStatePath(productStatePath);
  const statePathMatches =
    observableType === 'product-state-file'
      ? normalizedStatePath !== null
      : scenarioFieldCount(fields, /^product state path:/i) === 0;
  const allowedBarrier =
    /^(?:physical-device|credential-bound-service|platform-api-unavailable|accessibility-tree-unavailable|sandbox-restriction)$/.test(
      barrier ?? '',
    );
  const matchingExecutability =
    outcome === 'automatable'
      ? executability === 'agent-executable' &&
        (surface === 'robota-browser-ui'
          ? browserSteps !== null && scenarioFieldCount(fields, /^command:/i) === 0
          : command !== null && scenarioFieldCount(fields, /^browser steps?:/i) === 0) &&
        scenarioFieldCount(fields, /^ui steps?:/i) === 0 &&
        scenarioFieldCount(
          fields,
          /^(?:automation barrier|unavailable capability|attempted automation):/i,
        ) === 0
      : outcome === 'manual' &&
        /^manual-only:\s*\S/i.test(executability ?? '') &&
        uiSteps !== null &&
        (surface === 'robota-tui'
          ? command !== null
          : surface === 'robota-browser-ui' && scenarioFieldCount(fields, /^command:/i) === 0) &&
        scenarioFieldCount(fields, /^browser steps?:/i) === 0 &&
        allowedBarrier &&
        (unavailableCapability?.length ?? 0) >= 20 &&
        (attemptedAutomation?.length ?? 0) >= 30;
  const complete =
    matchingExecutability &&
    surface !== null &&
    surfaceRationaleMatches &&
    invocation !== null &&
    prerequisites !== null &&
    observableMatchesSurface &&
    observableMatchesType &&
    statePathMatches &&
    observable !== null &&
    observableRationaleMatches &&
    cleanup !== null &&
    evidence !== null;
  return complete
    ? {
        surface,
        invocation,
        barrier,
        unavailableCapability,
        attemptedAutomation,
        observableType,
        observable,
        surfaceRationale,
        observableRationale,
        productStatePath: normalizedStatePath,
        uiSteps,
      }
    : null;
}

function completeStageOneEntry(body, scenarios, outcome) {
  if (!/^\*\*Status upgrade:\*\* scenario drafted → scenario written\s*$/m.test(body)) {
    return false;
  }
  const evidence = normalizedScenarioLines(body);
  return scenarios.every((scenario) => {
    const contract = scenarioContract(scenario.body, outcome);
    if (contract === null) return false;
    const barrierEvidence =
      outcome === 'manual'
        ? `; barrier=${contract.barrier}; unavailable-capability=${contract.unavailableCapability}; attempted-automation=${contract.attemptedAutomation}`
        : '';
    const statePathEvidence = contract.productStatePath
      ? `; product-state-path=${contract.productStatePath}`
      : '';
    const uiStepEvidence =
      outcome === 'manual' && contract.surface === 'robota-tui'
        ? `; ui-steps=${contract.uiSteps}`
        : '';
    const exactBinding = `${scenario.name} — surface=${contract.surface}; surface-rationale=${contract.surfaceRationale}; invocation=${contract.invocation}${uiStepEvidence}; observable-type=${contract.observableType}; observable=${contract.observable}; observable-rationale=${contract.observableRationale}${statePathEvidence}${barrierEvidence}; guardian-observable-verdict=product-behavior; `;
    const line = evidence.find((candidate) => candidate.startsWith(exactBinding));
    return (
      line?.startsWith(exactBinding) === true &&
      /executability/i.test(line) &&
      /prerequisite/i.test(line) &&
      /command|browser steps?|ui steps?/i.test(line) &&
      /expected (?:observable|result)/i.test(line) &&
      /cleanup|reset/i.test(line) &&
      /evidence/i.test(line)
    );
  });
}

function gateImplementPassCount(spec, binding = null) {
  const evidence = markdownSection(spec, '## Evidence Log');
  return canonicalPassEntries(evidence, 'GATE-IMPLEMENT').filter((body) =>
    completeGateImplementEntry(body, binding),
  ).length;
}

function exactPlanSignal(task) {
  const section = markdownSection(task, '## User Execution Test Scenarios');
  const matches = [
    ...(section ?? '').matchAll(
      /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm,
    ),
  ];
  return matches.length === 1 ? { outcome: matches[0][1], count: Number(matches[0][2]) } : null;
}

function isCheckpointTransition({ basename, parentTask, parentSpec, task, spec }) {
  const signal = exactPlanSignal(task);
  return (
    signal !== null &&
    frontmatterStatus(task) === 'in-progress' &&
    frontmatterStatus(spec) === 'in-progress' &&
    frontmatterStatus(parentTask) !== 'in-progress' &&
    frontmatterStatus(parentSpec) !== 'in-progress' &&
    gateImplementPassCount(parentSpec) === 0 &&
    gateImplementPassCount(spec, { basename, signal }) === 1
  );
}

function evaluatePlanTexts({ basename, parentTask = null, parentSpec = null, task, spec }) {
  const problems = [];
  const id = subjectId(basename);
  if (!id) problems.push(`cannot derive a Task ID from paired basename \`${basename}\`.`);
  if (frontmatterStatus(task) !== 'in-progress') {
    problems.push(
      `paired Task \`${basename}\` is not status \`in-progress\` in the checkpoint tree.`,
    );
  }
  if (frontmatterStatus(spec) !== 'in-progress') {
    problems.push(
      `paired spec \`${basename}\` is not status \`in-progress\` in the checkpoint tree.`,
    );
  }
  const taskHeadings = visibleMarkdown(task).split('\n').map(atxHeading).filter(Boolean);
  const hasBoundH1 =
    id !== null &&
    taskHeadings.some(
      (heading) =>
        heading.level === 1 &&
        new RegExp(`^${id.replace('-', '\\-')}(?::|\\s|$)`).test(heading.content),
    );
  if (id && !hasBoundH1) {
    problems.push(`Task subject binding does not name exact ID \`${id}\`.`);
  }
  const tasksSection = markdownSection(spec, '## Tasks');
  const boundTaskPath = `.agents/tasks/${basename}`;
  if (
    !tasksSection ||
    !new RegExp(
      `(^|[\\s\`])${boundTaskPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s\`]|$)`,
      'm',
    ).test(tasksSection)
  ) {
    problems.push(`paired spec does not bind its Tasks section to \`.agents/tasks/${basename}\`.`);
  }
  if (!isCheckpointTransition({ basename, parentTask, parentSpec, task, spec })) {
    problems.push(
      'checkpoint does not add the first GATE-IMPLEMENT PASS while transitioning the exact Task/spec pair into in-progress.',
    );
  }

  const scenarioSection = markdownSection(task, '## User Execution Test Scenarios');
  const signals = [
    ...(scenarioSection ?? '').matchAll(
      /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm,
    ),
  ];
  if (signals.length !== 1) {
    problems.push(
      'paired Task must have exactly one subject-bound `SCENARIO DRAFTED` author verdict.',
    );
    return problems;
  }
  const signal = signals[0];
  const outcome = signal[1];
  const count = Number(signal[2]);
  if (outcome === 'not-applicable') {
    const tail = scenarioSection.slice(
      (signal.index ?? 0) + signal[0].length,
      (signal.index ?? 0) + 800,
    );
    if (
      count !== 0 ||
      tail.replace(/\s+/g, ' ').trim().length < 50 ||
      !/not applicable/i.test(tail)
    ) {
      problems.push('not-applicable PLAN lacks its zero count and a concrete recorded reason.');
    }
  } else {
    if (count < 1) problems.push(`applicable PLAN outcome \`${outcome}\` declares no scenario.`);
    const scenarios = scenarioEntries(scenarioSection);
    const hasCompleteScenarioSet =
      scenarios.length === count &&
      scenarios.every(
        (scenario, index) =>
          scenario.number === index + 1 && scenarioContract(scenario.body, outcome) !== null,
      );
    if (!hasCompleteScenarioSet) {
      problems.push(
        'applicable PLAN scenario count or required executability/prerequisite/command/UI/observable/cleanup/evidence fields are incomplete.',
      );
    }
    const hasStageOnePass = canonicalPassEntries(scenarioSection, 'DONE-GATE-STAGE-1').some(
      (body) => completeStageOneEntry(body, scenarios, outcome),
    );
    if (!hasStageOnePass) {
      problems.push('applicable PLAN has no DONE-GATE-STAGE-1 PASS.');
    }
  }
  return problems;
}

function appendedRecord(before, after) {
  if (!after.startsWith(before)) return false;
  const appended = lines(after.slice(before.length));
  if (appended.length !== 1) return null;
  try {
    return JSON.parse(appended[0]);
  } catch {
    return null;
  }
}

function validLoopRecord(record) {
  const allowedKeys = new Set([
    'runId',
    'opened',
    'closed',
    'roundFindings',
    'extensions',
    'terminal',
    'ref',
  ]);
  return Boolean(
    record &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    Object.keys(record).every((key) => allowedKeys.has(key)) &&
    (record.extensions === undefined ||
      (record.extensions !== null &&
        typeof record.extensions === 'object' &&
        !Array.isArray(record.extensions))) &&
    (record.ref === null || typeof record.ref === 'string') &&
    /^r\d{14}$/.test(String(record.runId ?? '')) &&
    !Number.isNaN(Date.parse(record.opened)) &&
    !Number.isNaN(Date.parse(record.closed)) &&
    Date.parse(record.closed) >= Date.parse(record.opened) &&
    LOOP_TERMINALS.has(record.terminal) &&
    Array.isArray(record.roundFindings) &&
    record.roundFindings.length > 0 &&
    record.roundFindings.every((count) => Number.isInteger(count) && count >= 0),
  );
}

function successfulLoopRecord(record) {
  return (
    validLoopRecord(record) && record.terminal === 'converged' && record.roundFindings.at(-1) === 0
  );
}

function exactSubjectRef(ref, basename) {
  const tokens = String(ref ?? '')
    .split(/[\s;,|]+/)
    .map((token) => token.replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);
  const stem = basename.endsWith('.md') ? basename.slice(0, -3) : basename;
  return (
    tokens.includes(basename) ||
    tokens.includes(stem) ||
    tokens.includes(`${TASK_PREFIX}${basename}`)
  );
}

function validateUesLedgerAppend(root, from, to, basename) {
  const before = gitText(root, from, UES_LEDGER) ?? '';
  const after = gitText(root, to, UES_LEDGER) ?? '';
  const record = appendedRecord(before, after);
  return successfulLoopRecord(record) && exactSubjectRef(record.ref, basename);
}

function planningPreludeProblems(paths, basename, textForPath) {
  const problems = [];
  const unexpected = paths.filter((file) => !isPreCheckpointPlanningPath(file, basename));
  if (unexpected.length > 0) {
    problems.push(`non-planning prelude path(s): ${unexpected.join(', ')}.`);
  }
  for (const file of paths) {
    if (!isPreCheckpointPlanningPath(file, basename)) continue;
    const text = textForPath(file);
    if (text === null) {
      if (file === `${TASK_PREFIX}${basename}`) {
        problems.push(`prelude deletes Task \`${file}\` without a valid destination.`);
        continue;
      }
      const replacement = [...PRE_CHECKPOINT_SPEC_STATUS].some(([folder, expectedStatus]) => {
        const candidateText = textForPath(`${SPEC_PREFIX}${folder}/${basename}`);
        return (
          candidateText !== null &&
          frontmatterStatus(candidateText) === expectedStatus &&
          gateImplementPassCount(candidateText) === 0
        );
      });
      if (!replacement) {
        problems.push(
          `prelude deletes spec \`${file}\` without a valid same-basename destination.`,
        );
      }
      continue;
    }
    const status = frontmatterStatus(text);
    const expectedStatus =
      file === `${TASK_PREFIX}${basename}`
        ? 'todo'
        : PRE_CHECKPOINT_SPEC_STATUS.get(file.slice(SPEC_PREFIX.length).split('/', 1)[0]);
    if (status !== expectedStatus) {
      problems.push(
        `prelude path \`${file}\` has status \`${status ?? '(missing)'}\`; expected \`${expectedStatus}\` for this artifact and folder.`,
      );
    }
    if (specBasename(file) === basename && gateImplementPassCount(text) > 0) {
      problems.push(`prelude spec \`${file}\` already carries GATE-IMPLEMENT PASS.`);
    }
  }
  return problems;
}

function allowedCheckpointPaths(root, from, to, paths, basename) {
  const sourceSpec = `${SPEC_PREFIX}todo/${basename}`;
  const validSourceDeletion =
    frontmatterStatus(gitText(root, from, sourceSpec)) === 'approved' &&
    gitText(root, to, sourceSpec) === null;
  const unexpected = paths.filter(
    (file) =>
      !isExactCheckpointPairPath(file, basename) &&
      !(file === sourceSpec && validSourceDeletion) &&
      !(file === UES_LEDGER && validateUesLedgerAppend(root, from, to, basename)),
  );
  return unexpected;
}

function validateCheckpointCommit(root, parent, commit, paths, basename) {
  const taskPath = `${TASK_PREFIX}${basename}`;
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const task = gitText(root, commit, taskPath);
  const spec = gitText(root, commit, specPath);
  const parentTask = gitText(root, parent, taskPath);
  const parentSpec = gitText(root, parent, specPath);
  const problems = [];
  if (task === null || spec === null) {
    problems.push(
      `checkpoint does not contain exact active pair \`${taskPath}\` + \`${specPath}\`.`,
    );
    return problems;
  }
  problems.push(...evaluatePlanTexts({ basename, parentTask, parentSpec, task, spec }));
  const unexpected = allowedCheckpointPaths(root, parent, commit, paths, basename);
  if (unexpected.length > 0) {
    problems.push(
      `checkpoint mixes planning with implementation path(s): ${unexpected.join(', ')}.`,
    );
  }
  return problems;
}

function validatePostMergeRecord(root, before, after, base) {
  const record = appendedRecord(before, after);
  if (!successfulLoopRecord(record)) return false;
  const prMatches = [...String(record.ref ?? '').matchAll(/\bPR\s+#(\d+)\b/g)];
  const prNumber = prMatches.length === 1 ? prMatches[0][1] : null;
  if (!prNumber || !/\bMERGE VERIFIED PASS\b/.test(String(record.ref ?? ''))) return false;
  const hashes = String(record.ref).match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
  const mergeOid = hashes.length === 1 ? hashes[0] : null;
  if (mergeOid === null) return false;
  const resolves = runGit(root, ['rev-parse', '--verify', '--quiet', `${mergeOid}^{commit}`]);
  if (resolves.code !== 0) return false;
  if (runGit(root, ['merge-base', '--is-ancestor', mergeOid, base]).code !== 0) return false;
  const subject = runGit(root, ['show', '-s', '--format=%s', mergeOid]);
  return (
    subject.code === 0 &&
    (subject.stdout.includes(`(#${prNumber})`) ||
      new RegExp(`\\bpull request #${prNumber}\\b`, 'i').test(subject.stdout))
  );
}

function validatePostMergePrelude(root, parent, commit, paths, base) {
  if (paths.length !== 1 || paths[0] !== POST_MERGE_LEDGER) return false;
  const before = gitText(root, parent, POST_MERGE_LEDGER) ?? '';
  const after = gitText(root, commit, POST_MERGE_LEDGER) ?? '';
  return validatePostMergeRecord(root, before, after, base);
}

export function resolveTopicMergeBase(root, requested, env = process.env) {
  const githubBase = env.GITHUB_BASE_REF
    ? env.GITHUB_BASE_REF.startsWith('origin/')
      ? env.GITHUB_BASE_REF
      : `origin/${env.GITHUB_BASE_REF}`
    : null;
  const candidates = requested
    ? [requested]
    : [env.HARNESS_BASE_REF, githubBase, 'origin/develop'].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = runGit(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (resolved.code !== 0) continue;
    const mergeBase = runGit(root, ['merge-base', 'HEAD', candidate]);
    if (mergeBase.code === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  }
  throw new Error(`no merge base could be resolved from ${candidates.join(', ') || '(none)'}`);
}

function historyAnalysis(root = WORKSPACE_ROOT, requestedBase = undefined) {
  const base = resolveTopicMergeBase(root, requestedBase);
  // Contained — HARNESS-130. `--no-merges`: this scan attributes a commit's content by diffing it
  // against its parent, which is defined for a single-parent commit and undefined for a merge —
  // `commit^` is the FIRST parent, so a merge whose first parent is the base diffs as the other
  // side's whole history. CI evaluates `refs/pull/N/merge`, exactly that shape: the checkpoint's
  // todo → active transition inside the merge's diff read as a second candidate and refused every
  // PR whose spec was still in-progress (issue #2373); on the branch tip a back-merge carrying the
  // base's content was refused the same way. Fail direction, stated: merges are EXCLUDED, so a
  // merge's OWN pre-checkpoint content — a conflict resolution introducing a path in neither
  // parent — is not judged on this path. That residual, and the staged path's mirror of it, is
  // HARNESS-130's.
  const listed = runGit(root, [
    'rev-list',
    '--reverse',
    '--topo-order',
    '--no-merges',
    `${base}..HEAD`,
  ]);
  if (listed.code !== 0) {
    throw new Error(`git rev-list failed: ${listed.stderr || '(no stderr)'}`);
  }
  const commits = lines(listed.stdout);
  let examined = 0;
  const entries = commits.map((commit) => {
    examined += 1;
    const parentResult = runGit(root, ['rev-parse', `${commit}^`]);
    if (parentResult.code !== 0) {
      throw new Error(
        `cannot resolve parent of ${commit}: ${parentResult.stderr || '(no stderr)'}`,
      );
    }
    const parent = parentResult.stdout.trim();
    return { commit, parent, paths: changedPaths(root, parent, commit) };
  });

  const candidates = [];
  for (const entry of entries) {
    // `--no-renames` reports both deleted active paths during completion. A checkpoint candidate
    // must CONTAIN the active pair in its resulting tree, not merely mention their deletion.
    const pairs = activePairCandidates(entry.paths).filter((basename) => {
      const taskPath = `${TASK_PREFIX}${basename}`;
      const specPath = `${SPEC_PREFIX}active/${basename}`;
      const task = gitText(root, entry.commit, taskPath);
      const spec = gitText(root, entry.commit, specPath);
      if (task === null || spec === null) return false;
      return isCheckpointTransition({
        basename,
        parentTask: gitText(root, entry.parent, taskPath),
        parentSpec: gitText(root, entry.parent, specPath),
        task,
        spec,
      });
    });
    if (pairs.length > 0) candidates.push({ ...entry, pairs });
  }
  const findings = [];
  if (candidates.length === 0) {
    let postMergePreludes = 0;
    let pendingBasename = null;
    let planningStarted = false;
    for (const entry of entries) {
      if (entry.paths.length === 0) continue;
      if (validatePostMergePrelude(root, entry.parent, entry.commit, entry.paths, base)) {
        postMergePreludes += 1;
        if (postMergePreludes > 1 || planningStarted) {
          findings.push(
            finding(
              'more than one predecessor post-merge prelude exists, or the prelude appears after planning began.',
              entry.commit,
            ),
          );
        }
        continue;
      }
      if (entry.paths.includes(POST_MERGE_LEDGER)) {
        findings.push(
          finding(
            'predecessor post-merge ledger is not one append-only closed record exactly bound to a verified PR merge ancestor of the topic base.',
            entry.commit,
          ),
        );
        continue;
      }
      const basenames = planningBasenames(entry.paths);
      const basename = basenames.length === 1 ? basenames[0] : null;
      const preludeProblems =
        basename === null
          ? ['paths do not identify exactly one planning unit.']
          : planningPreludeProblems(entry.paths, basename, (file) =>
              gitText(root, entry.commit, file),
            );
      if (
        preludeProblems.length > 0 ||
        (pendingBasename !== null && pendingBasename !== basename)
      ) {
        findings.push(
          finding(
            `implementation exists with no planning checkpoint: ${entry.paths.join(', ') || '(empty commit)'}${preludeProblems.length > 0 ? ` (${preludeProblems.join(' ')})` : ''}.`,
            entry.commit,
          ),
        );
        continue;
      }
      planningStarted = true;
      pendingBasename = basename;
    }
    return { base, commits, examined, checkpoint: null, pendingBasename, findings };
  }

  const first = candidates[0];
  if (first.pairs.length !== 1) {
    findings.push(
      finding(
        `checkpoint is ambiguous: multiple Task/spec pairs changed (${first.pairs.join(', ')}).`,
        first.commit,
      ),
    );
    return { base, commits, examined, checkpoint: null, findings };
  }
  const basename = first.pairs[0];
  let postMergePreludes = 0;
  let planningStarted = false;
  for (const entry of entries) {
    if (entry.commit === first.commit) break;
    if (validatePostMergePrelude(root, entry.parent, entry.commit, entry.paths, base)) {
      postMergePreludes += 1;
      if (postMergePreludes > 1 || planningStarted) {
        findings.push(
          finding(
            'more than one predecessor post-merge prelude exists, or the prelude appears after planning began.',
            entry.commit,
          ),
        );
      }
      continue;
    }
    if (entry.paths.includes(POST_MERGE_LEDGER)) {
      findings.push(
        finding(
          'predecessor post-merge ledger is not one append-only closed record exactly bound to a verified PR merge ancestor of the topic base.',
          entry.commit,
        ),
      );
    }
    const preludeProblems = planningPreludeProblems(entry.paths, basename, (file) =>
      gitText(root, entry.commit, file),
    );
    if (preludeProblems.length > 0) {
      findings.push(
        finding(
          `implementation or invalid-lifecycle path(s) changed before the planning checkpoint: ${preludeProblems.join(' ')}`,
          entry.commit,
        ),
      );
    }
    if (entry.paths.some((file) => isPreCheckpointPlanningPath(file, basename))) {
      planningStarted = true;
    }
  }
  for (const problem of validateCheckpointCommit(
    root,
    first.parent,
    first.commit,
    first.paths,
    basename,
  )) {
    findings.push(finding(problem, first.commit));
  }
  if (candidates.length > 1) {
    findings.push(
      finding(
        `multiple planning checkpoint candidates exist (${candidates.map((c) => c.commit.slice(0, 9)).join(', ')}).`,
      ),
    );
  }
  for (const entry of entries.slice(entries.indexOf(first) + 1)) {
    const secondary = activePairCandidates(entry.paths).filter((candidateBasename) => {
      if (candidateBasename === basename) return false;
      const taskPath = `${TASK_PREFIX}${candidateBasename}`;
      const specPath = `${SPEC_PREFIX}active/${candidateBasename}`;
      const task = gitText(root, entry.commit, taskPath);
      const spec = gitText(root, entry.commit, specPath);
      return isCheckpointTransition({
        basename: candidateBasename,
        parentTask: gitText(root, entry.parent, taskPath),
        parentSpec: gitText(root, entry.parent, specPath),
        task,
        spec,
      });
    });
    if (secondary.length > 0) {
      findings.push(
        finding(
          `second work-unit planning checkpoint transition exists after \`${basename}\`: ${secondary.join(', ')}.`,
          entry.commit,
        ),
      );
    }
  }
  return {
    base,
    commits,
    examined,
    checkpoint: { commit: first.commit, basename },
    pendingBasename: null,
    findings,
  };
}

export function findHistoryFindings(root = WORKSPACE_ROOT, requestedBase = undefined) {
  try {
    return historyAnalysis(root, requestedBase).findings;
  } catch (error) {
    return [
      finding(
        `history query failed closed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

/** Exported so the self-reported traversal size is asserted as an output. */
export function readExaminedPlanOrderCount(root = WORKSPACE_ROOT, requestedBase = undefined) {
  return historyAnalysis(root, requestedBase).examined;
}

function stagedCheckpoint(root, paths) {
  const pairs = activePairCandidates(paths);
  if (pairs.length !== 1) return { pairs, problems: [] };
  const basename = pairs[0];
  const taskPath = `${TASK_PREFIX}${basename}`;
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const task = indexText(root, taskPath);
  const spec = indexText(root, specPath);
  const parentTask = gitText(root, 'HEAD', taskPath);
  const parentSpec = gitText(root, 'HEAD', specPath);
  const problems = [];
  if (task === null || spec === null) {
    problems.push(
      `proposed checkpoint does not stage the exact active Task/spec pair \`${basename}\`.`,
    );
  } else {
    problems.push(...evaluatePlanTexts({ basename, parentTask, parentSpec, task, spec }));
  }
  const sourceSpec = `${SPEC_PREFIX}todo/${basename}`;
  const validSourceDeletion =
    frontmatterStatus(gitText(root, 'HEAD', sourceSpec)) === 'approved' &&
    indexText(root, sourceSpec) === null;
  const unexpected = paths.filter(
    (file) =>
      !isExactCheckpointPairPath(file, basename) &&
      !(file === sourceSpec && validSourceDeletion) &&
      file !== UES_LEDGER,
  );
  if (unexpected.length > 0) {
    problems.push(`proposed checkpoint mixes implementation path(s): ${unexpected.join(', ')}.`);
  }
  if (paths.includes(UES_LEDGER)) {
    const before = gitText(root, 'HEAD', UES_LEDGER) ?? '';
    const after = indexText(root, UES_LEDGER) ?? '';
    const record = appendedRecord(before, after);
    if (!successfulLoopRecord(record) || !exactSubjectRef(record.ref, basename)) {
      problems.push(
        'proposed PLAN ledger is not one append-only closed record subject-bound to the exact Task.',
      );
    }
  }
  return { pairs, basename, problems };
}

export function findStagedFindings(root = WORKSPACE_ROOT, requestedBase = undefined) {
  try {
    const staged = stagedPaths(root);
    if (staged.length === 0) return [];
    const history = historyAnalysis(root, requestedBase);
    if (history.findings.length > 0) return history.findings;
    if (staged.includes(POST_MERGE_LEDGER)) {
      const before = gitText(root, 'HEAD', POST_MERGE_LEDGER) ?? '';
      const after = indexText(root, POST_MERGE_LEDGER) ?? '';
      const priorTopicLedgerChange = history.commits.some((commit) =>
        changedPaths(root, `${commit}^`, commit).includes(POST_MERGE_LEDGER),
      );
      const residue = worktreePaths(root);
      const validPrelude =
        staged.length === 1 &&
        history.checkpoint == null &&
        history.pendingBasename == null &&
        !priorTopicLedgerChange &&
        residue.length === 0 &&
        validatePostMergeRecord(root, before, after, history.base);
      return validPrelude
        ? []
        : [
            finding(
              'staged predecessor post-merge ledger is not one planning-free append-only verified PR merge record, or is mixed with other worktree paths.',
            ),
          ];
    }
    if (history.checkpoint) {
      const secondary = activePairCandidates(staged).filter((basename) => {
        const taskPath = `${TASK_PREFIX}${basename}`;
        const specPath = `${SPEC_PREFIX}active/${basename}`;
        return isCheckpointTransition({
          basename,
          parentTask: gitText(root, 'HEAD', taskPath),
          parentSpec: gitText(root, 'HEAD', specPath),
          task: indexText(root, taskPath),
          spec: indexText(root, specPath),
        });
      });
      return secondary.length === 0
        ? []
        : [
            finding(
              `second work-unit planning checkpoint transition is staged after \`${history.checkpoint.basename}\`: ${secondary.join(', ')}.`,
            ),
          ];
    }

    const proposed = stagedCheckpoint(root, staged);
    const findings = proposed.problems.map((problem) => finding(problem));
    if (proposed.pairs.length === 0) {
      const basenames = planningBasenames(staged);
      const basename = basenames.length === 1 ? basenames[0] : null;
      const preludeProblems =
        basename === null
          ? ['paths do not identify exactly one planning unit.']
          : planningPreludeProblems(staged, basename, (file) => indexText(root, file));
      if (
        preludeProblems.length > 0 ||
        (history.pendingBasename !== null && history.pendingBasename !== basename)
      ) {
        findings.push(finding('staged implementation has no planning checkpoint ancestor.'));
      }
      const residue = worktreePaths(root);
      if (residue.length > 0) {
        findings.push(
          finding(
            `unstaged or untracked path(s) exist during planning prelude: ${residue.join(', ')}.`,
          ),
        );
      }
      return findings;
    }
    if (proposed.pairs.length > 1) {
      findings.push(
        finding(`proposed checkpoint is ambiguous: multiple pairs (${proposed.pairs.join(', ')}).`),
      );
      return findings;
    }
    if (history.pendingBasename !== null && history.pendingBasename !== proposed.basename) {
      findings.push(
        finding(
          `proposed checkpoint \`${proposed.basename}\` does not match pending planning unit \`${history.pendingBasename}\`.`,
        ),
      );
    }
    const outside = worktreePaths(root);
    if (outside.length > 0) {
      findings.push(
        finding(`non-planning worktree path(s) exist during checkpoint: ${outside.join(', ')}.`),
      );
    }
    return findings;
  } catch (error) {
    return [
      finding(
        `staged query failed closed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

function argumentValue(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export function scanUserExecutionPlanOrder(args = process.argv.slice(2)) {
  const staged = args.includes('--staged');
  const requestedBase = argumentValue(args, '--base');
  const result = staged
    ? {
        findings: findStagedFindings(WORKSPACE_ROOT, requestedBase),
        examined: stagedPaths(WORKSPACE_ROOT).length,
      }
    : (() => {
        try {
          const analysis = historyAnalysis(WORKSPACE_ROOT, requestedBase);
          return { findings: analysis.findings, examined: analysis.examined };
        } catch (error) {
          return {
            findings: [
              finding(
                `history query failed closed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ],
            examined: 0,
          };
        }
      })();
  return { staged, ...result };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = scanUserExecutionPlanOrder();
  for (const item of result.findings) {
    const where = item.commit ? ` (${item.commit.slice(0, 9)})` : '';
    console.error(`✗ user-execution-plan-order${where}: ${item.problem}`);
  }
  if (result.examined === 0) {
    console.log(
      result.staged
        ? '::examined:: 0 staged path(s) ::expected-empty:: the proposed commit index is empty'
        : '::examined:: 0 topic commit(s) ::expected-empty:: no non-merge commits beyond the integration merge base (merges are excluded from the enumeration)',
    );
  } else {
    console.log(
      `::examined:: ${result.examined} ${result.staged ? 'staged path(s)' : 'topic commit(s)'}`,
    );
  }
  process.exit(result.findings.length > 0 ? 1 : 0);
}
