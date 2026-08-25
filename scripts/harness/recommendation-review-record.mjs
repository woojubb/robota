#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { marked } from 'marked';

import { parseFrontmatterBlock } from './frontmatter.mjs';

export const RECOMMENDATION_REVIEW_EXTENSION = 'recommendationReview';
export const RECOMMENDATION_REVIEW_OWNER = 'backlog-execution-orchestrator';
export const RECOMMENDATION_REVIEW_AGENT = 'proposal-reviewer';
export const RECOMMENDATION_VERDICTS = new Set(['ENDORSE', 'REVISE', 'REJECT']);

const REQUIRED_SECTIONS = [
  'Problem',
  'Prior Art Research',
  'Architecture Review',
  'Fallback & Degradation Declaration',
  'User Execution Test Scenarios',
  'Solution',
  'Affected Files',
  'Completion Criteria',
  'Test Plan',
];
const OPTIONAL_SECTIONS = ['Tasks', 'Evidence Log'];

function normalizeLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n');
}

const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
]);

function maskThrough(hidden, start, end) {
  for (let index = start; index <= end; index += 1) hidden.add(index);
}

function isAtxHeading(line) {
  return /^ {0,3}#{1,6}(?:[\t ]|$)/.test(line);
}

function isParagraphBoundary(line) {
  return (
    isAtxHeading(line) ||
    /^ {0,3}(?:=+|-+)[ \t]*$/.test(line) ||
    /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)
  );
}

function interruptsInlineParagraph(line) {
  return (
    line.trim() === '' ||
    isParagraphBoundary(line) ||
    /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+)\S/.test(line) ||
    /^ {0,3}>/.test(line)
  );
}

function pairedFenceLineRanges(lines) {
  const ranges = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (opener === null || (opener[1][0] === '`' && opener[2].includes('`'))) continue;
    const marker = opener[1][0];
    const minimumLength = opener[1].length;
    const closer = new RegExp(`^ {0,3}\\${marker}{${minimumLength},}[ \\t]*$`);
    const closeAt = lines.findIndex((line, candidate) => candidate > index && closer.test(line));
    // An incomplete or malformed fence must not make planning text disappear from review.
    if (closeAt === -1) continue;
    ranges.push({ start: index, end: closeAt });
    index = closeAt;
  }
  return ranges;
}

function maskPairedFences(lines, hidden) {
  for (const range of pairedFenceLineRanges(lines)) maskThrough(hidden, range.start, range.end);
}

function maskHtmlBlocks(lines, hidden) {
  let paragraphOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (hidden.has(index)) {
      paragraphOpen = false;
      continue;
    }
    const line = lines[index];
    if (line.trim() === '' || isParagraphBoundary(line)) {
      paragraphOpen = false;
      continue;
    }
    if (/^ {0,3}<!--/.test(line)) {
      let closeAt = index;
      while (closeAt < lines.length && !lines[closeAt].includes('-->')) closeAt += 1;
      maskThrough(hidden, index, Math.min(closeAt, lines.length - 1));
      index = closeAt;
      paragraphOpen = false;
      continue;
    }

    const boundedHtmlBlock = [
      { opener: /^ {0,3}<\?/, closer: '?>' },
      { opener: /^ {0,3}<![A-Z]/, closer: '>' },
      { opener: /^ {0,3}<!\[CDATA\[/, closer: ']]>' },
    ].find(({ opener }) => opener.test(line));
    if (boundedHtmlBlock) {
      let closeAt = index;
      while (closeAt < lines.length && !lines[closeAt].includes(boundedHtmlBlock.closer))
        closeAt += 1;
      maskThrough(hidden, index, Math.min(closeAt, lines.length - 1));
      index = closeAt;
      paragraphOpen = false;
      continue;
    }

    const raw = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(line);
    if (raw) {
      const closing = new RegExp(`</${raw[1]}\\s*>`, 'i');
      let closeAt = index;
      while (closeAt < lines.length && !closing.test(lines[closeAt])) closeAt += 1;
      maskThrough(hidden, index, Math.min(closeAt, lines.length - 1));
      index = closeAt;
      paragraphOpen = false;
      continue;
    }

    const tag = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?:[\t />]|$)/.exec(line)?.[1];
    const completeTag = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?>\s*$/.test(line);
    const typeSevenMayStart = !paragraphOpen;
    if ((tag && HTML_BLOCK_TAGS.has(tag.toLowerCase())) || (completeTag && typeSevenMayStart)) {
      let closeAt = index;
      while (closeAt + 1 < lines.length && lines[closeAt + 1].trim() !== '') closeAt += 1;
      maskThrough(hidden, index, closeAt);
      index = closeAt;
      paragraphOpen = false;
      continue;
    }
    paragraphOpen = true;
  }
}

function maskCodeSpans(lines) {
  const source = lines.join('\n');
  // Fence-shaped lines left visible by the strict paired-fence pass are malformed fences, not a
  // licence for the more permissive code-span pass to hide their contents.
  const scanSource = lines
    .map((line) => (/^\s*`{3,}/.test(line) ? line.replaceAll('`', '\0') : line))
    .join('\n');
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  const lineAt = (offset) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line += 1;
    return line;
  };
  const masked = [...lines];
  const runs = [...scanSource.matchAll(/`+/g)]
    .filter((match) => {
      let escapes = 0;
      for (let at = match.index - 1; at >= 0 && scanSource[at] === '\\'; at -= 1) escapes += 1;
      return escapes % 2 === 0;
    })
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      length: match[0].length,
    }));
  for (let index = 0; index < runs.length; index += 1) {
    const opener = runs[index];
    const openerLine = lineAt(opener.start);
    const closeIndex = runs.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && candidate.length === opener.length,
    );
    if (closeIndex === -1) continue;
    const closer = runs[closeIndex];
    const closerLine = lineAt(closer.start);
    if (openerLine < closerLine) {
      const crossesBlockBoundary = lines
        .slice(openerLine + 1, closerLine)
        .some(interruptsInlineParagraph);
      if (crossesBlockBoundary) continue;
      for (let line = openerLine + 1; line < closerLine; line += 1) {
        if (!interruptsInlineParagraph(lines[line])) masked[line] = '';
      }
      const delimiter = '`'.repeat(opener.length);
      if (lines[openerLine].trim() === delimiter) masked[openerLine] = '';
      if (lines[closerLine].trim() === delimiter) masked[closerLine] = '';
    }
    index = closeIndex;
  }
  return masked;
}

function projectionAndStructuralLines(text) {
  const lines = normalizeLines(text);
  const hidden = new Set();
  maskPairedFences(lines, hidden);
  const projectionLines = lines.map((line, index) => (hidden.has(index) ? '' : line));
  const structuralHidden = new Set(hidden);
  maskHtmlBlocks(lines, structuralHidden);
  const structuralLines = maskCodeSpans(
    lines.map((line, index) => (structuralHidden.has(index) ? '' : line)),
  );
  return { projectionLines, structuralLines };
}

function canonicalBody(lines) {
  const normalized = lines.map((line) => line.trimEnd());
  while (normalized.length > 0 && normalized[0].trim() === '') normalized.shift();
  while (normalized.length > 0 && normalized.at(-1).trim() === '') normalized.pop();
  return normalized.join('\n');
}

function plainEvidenceRenderer() {
  const renderer = new marked.Renderer();
  renderer.code = (code) => `${code}\n`;
  renderer.blockquote = (quote) => `${quote}\n`;
  renderer.html = () => '';
  renderer.heading = (text) => `${text}\n`;
  renderer.hr = () => '\n';
  renderer.list = (body) => `${body}\n`;
  renderer.listitem = (text) => `${text}\n`;
  renderer.checkbox = (checked) => (checked ? '[x] ' : '[ ] ');
  renderer.paragraph = (text) => `${text}\n`;
  renderer.table = (header, body) => `${header}\n${body}\n`;
  renderer.tablerow = (content) => `${content}\n`;
  renderer.tablecell = (content) => `${content}\t`;
  renderer.strong = (text) => text;
  renderer.em = (text) => text;
  renderer.codespan = (text) => text;
  renderer.br = () => '\n';
  renderer.del = (text) => text;
  renderer.link = (_href, _title, text) => text;
  renderer.image = (_href, _title, text) => text;
  renderer.text = (text) => text;
  return renderer;
}

function isHtmlCommentToken(token) {
  if (token.type !== 'html') return false;
  let comments = 0;
  const remainder = token.raw.replace(/<!--[\s\S]*?-->/g, () => {
    comments += 1;
    return '';
  });
  return comments > 0 && remainder.trim() === '';
}

function canonicalVisibleEvidence(lines) {
  const tokens = marked.lexer(lines.join('\n'));
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'html' && !isHtmlCommentToken(token)) {
      throw new Error(
        'recommendation checkpoint: raw HTML other than comments is ambiguous evidence.',
      );
    }
    if (
      (token.type === 'text' || token.type === 'image') &&
      /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/.test(token.raw)
    ) {
      throw new Error(
        'recommendation checkpoint: authored entity references are ambiguous evidence.',
      );
    }
  });
  return marked.parser(tokens, { renderer: plainEvidenceRenderer() }).replace(/\s+/g, ' ').trim();
}

function frontmatterProjection(lines) {
  if (lines[0]?.trim() !== '---')
    throw new Error('recommendation projection: missing opening frontmatter.');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) throw new Error('recommendation projection: unclosed frontmatter.');
  const blockLines = lines.slice(1, end);
  const parsed = parseFrontmatterBlock(lines.slice(0, end + 1).join('\n'));
  const parsedEntries = parsed ? [...parsed.entries()] : [];
  if (parsedEntries.length !== blockLines.length) {
    throw new Error(
      'recommendation projection: frontmatter must use unique top-level scalar key/value lines.',
    );
  }
  const entries = [];
  for (const [index, line] of blockLines.entries()) {
    const [key] = parsedEntries[index];
    const prefix = `${key}:`;
    if (!line.startsWith(prefix)) {
      throw new Error(`recommendation projection: malformed frontmatter line \`${line}\`.`);
    }
    const value = line.slice(prefix.length);
    if (!['status', 'completed'].includes(key)) entries.push([key, value.trim()]);
  }
  return { entries: entries.sort(([left], [right]) => left.localeCompare(right)), end };
}

function sectionRanges(lines, startAt, bodyLines = lines) {
  const headings = [];
  for (let index = startAt; index < lines.length; index += 1) {
    const match = /^ {0,3}(#{1,6})(?:[\t ]+(.*?)[\t ]*|[\t ]*)$/.exec(lines[index]);
    if (match) {
      const title = (match[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '');
      headings.push({ index, level: match[1].length, title });
    }
  }
  const h1 = headings.filter((heading) => heading.level === 1);
  if (h1.length !== 1)
    throw new Error(
      `recommendation projection: expected exactly one visible title, found ${h1.length}.`,
    );
  const allowedH2 = new Set([...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]);
  const unknownH2 = headings.find(
    (heading) => heading.level === 2 && !allowedH2.has(heading.title),
  );
  if (unknownH2) {
    throw new Error(`recommendation projection: unknown visible H2 owner \`${unknownH2.title}\`.`);
  }
  for (const name of OPTIONAL_SECTIONS) {
    const matches = headings.filter((heading) => heading.level === 2 && heading.title === name);
    if (matches.length > 1) {
      throw new Error(
        `recommendation projection: duplicate ${name} section; expected at most one visible owner, found ${matches.length}.`,
      );
    }
  }
  const title = h1[0];
  const firstH2 = headings.find((heading) => heading.level === 2);
  const preTitle = bodyLines.slice(startAt, title.index);
  const postTitle = bodyLines.slice(title.index + 1, firstH2?.index ?? bodyLines.length);
  if (
    title.index < startAt ||
    (firstH2 && firstH2.index < title.index) ||
    [...preTitle, ...postTitle].some((line) => line.trim() !== '')
  ) {
    throw new Error(
      'recommendation projection: nonblank preamble is not owned by a canonical planning section.',
    );
  }
  const result = new Map();
  const structuralResult = new Map();
  for (const name of REQUIRED_SECTIONS) {
    const matches = headings.filter((heading) => heading.level === 2 && heading.title === name);
    if (matches.length !== 1) {
      const reason = matches.length === 0 ? `missing ${name}` : `duplicate ${name}`;
      throw new Error(
        `recommendation projection: ${reason} section; expected one visible owner, found ${matches.length}.`,
      );
    }
    const heading = matches[0];
    const next = headings.find(
      (candidate) => candidate.index > heading.index && candidate.level <= 2,
    );
    const end = next?.index ?? lines.length;
    result.set(name, canonicalBody(bodyLines.slice(heading.index + 1, end)));
    structuralResult.set(name, canonicalBody(lines.slice(heading.index + 1, end)));
  }
  const optionalSectionRanges = new Map();
  for (const name of OPTIONAL_SECTIONS) {
    const heading = headings.find((candidate) => candidate.level === 2 && candidate.title === name);
    if (!heading) continue;
    const next = headings.find(
      (candidate) => candidate.index > heading.index && candidate.level <= 2,
    );
    const end = next?.index ?? lines.length;
    optionalSectionRanges.set(name, { start: heading.index + 1, end });
  }
  return {
    title: title.title,
    sections: result,
    structuralSections: structuralResult,
    optionalSectionRanges,
  };
}

function tcIdsFromCriteria(section) {
  const ids = [];
  for (const line of section.split('\n')) {
    const match = /^\s*[-*]\s+\[[ xX]\]\s+(TC-\d+):\s+\S/.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function tcIdsFromPlan(section) {
  const lines = section.split('\n');
  const rows = lines.map((line) => {
    if (!line.startsWith('|') || !line.endsWith('|')) return null;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    return cells.length === 4 ? cells : null;
  });
  const header = ['TC-ID', 'Test Type', 'Tool / Approach', 'Notes'];
  const valid =
    rows.length >= 3 &&
    rows.every((row) => row !== null) &&
    rows[0].every((cell, index) => cell === header[index]) &&
    rows[1].every((cell) => /^-{3,}$/.test(cell)) &&
    rows.slice(2).every((row) => row.every((cell) => cell !== '') && /^TC-\d+$/.test(row[0]));
  if (!valid) {
    throw new Error(
      'recommendation projection: Test Plan must be one canonical four-column Markdown table.',
    );
  }
  return rows.slice(2).map((row) => row[0]);
}

function assertTcBijection(criteria, plan) {
  const criteriaIds = tcIdsFromCriteria(criteria);
  const planIds = tcIdsFromPlan(plan);
  if (criteriaIds.length === 0)
    throw new Error('recommendation projection: Completion Criteria has no canonical TC rows.');
  if (
    new Set(criteriaIds).size !== criteriaIds.length ||
    new Set(planIds).size !== planIds.length
  ) {
    throw new Error(
      'recommendation projection: duplicate TC id prevents a Completion Criteria/Test Plan bijection.',
    );
  }
  if (
    criteriaIds.length !== planIds.length ||
    criteriaIds.some((id, index) => planIds[index] !== id)
  ) {
    throw new Error(
      `recommendation projection: Completion Criteria/Test Plan TC bijection differs (${criteriaIds.join(',')} vs ${planIds.join(',')}).`,
    );
  }
}

function plannedCompletionCriteria(section) {
  return section.replace(/^(\s*[-*]\s+)\[[ xX]\]/gm, '$1[ ]');
}

/**
 * Canonical planning projection reviewed at the Recommendation Gate.
 *
 * Scope: the spec's non-lifecycle frontmatter, title, and the nine owner sections named above.
 * Excluded by design: lifecycle status/completed fields, Tasks, and Evidence Log. Complete
 * CommonMark fenced blocks are excluded from the projection; raw HTML and multiline code-span body
 * bytes stay bound while their fake structural headings/TC rows are ignored. Malformed fences,
 * unknown H2 owners, nonblank preambles, duplicate visible owners, and non-bijective TC plans fail
 * closed.
 */
export function decisionProjection(markdown) {
  const { projectionLines, structuralLines } = projectionAndStructuralLines(markdown);
  const frontmatter = frontmatterProjection(projectionLines);
  const { title, sections, structuralSections } = sectionRanges(
    structuralLines,
    frontmatter.end + 1,
    projectionLines,
  );
  assertTcBijection(
    structuralSections.get('Completion Criteria'),
    structuralSections.get('Test Plan'),
  );
  return {
    frontmatter: Object.fromEntries(frontmatter.entries),
    title,
    problem: sections.get('Problem'),
    priorArtResearch: sections.get('Prior Art Research'),
    architectureReview: sections.get('Architecture Review'),
    fallbackAndDegradation: sections.get('Fallback & Degradation Declaration'),
    userExecutionPlan: sections.get('User Execution Test Scenarios'),
    solution: sections.get('Solution'),
    affectedFiles: sections.get('Affected Files'),
    completionCriteria: plannedCompletionCriteria(sections.get('Completion Criteria')),
    testPlan: sections.get('Test Plan'),
  };
}

export function decisionProjectionDigest(markdown) {
  return createHash('sha256')
    .update(JSON.stringify(decisionProjection(markdown)))
    .digest('hex');
}

/** Visible canonical Evidence Log content used to prove a substantive endorsement checkpoint. */
export function recommendationCheckpointEvidence(markdown) {
  const rawLines = normalizeLines(markdown);
  const { projectionLines, structuralLines } = projectionAndStructuralLines(markdown);
  const frontmatter = frontmatterProjection(projectionLines);
  const { optionalSectionRanges } = sectionRanges(
    structuralLines,
    frontmatter.end + 1,
    projectionLines,
  );
  const evidenceRange = optionalSectionRanges.get('Evidence Log');
  return evidenceRange
    ? canonicalVisibleEvidence(rawLines.slice(evidenceRange.start, evidenceRange.end))
    : '';
}

export function normalizeRecommendationReviewMetadata(entry) {
  entry.extensions ??= {};
  entry.extensions[RECOMMENDATION_REVIEW_EXTENSION] ??= { expectations: [], observations: [] };
  return entry.extensions[RECOMMENDATION_REVIEW_EXTENSION];
}

function currentRound(entry) {
  return (Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0) + 1;
}

function requireSubject(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9]*-\d+[A-Za-z0-9._-]*\.md$/.test(value)) {
    throw new Error('recommendation review: subject must be one exact Task/spec basename.');
  }
  return value;
}

function requireHex(value, length, field) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(
      `recommendation review: ${field} must be ${length} lowercase hexadecimal characters.`,
    );
  }
  return value;
}

function keyOf(record) {
  return [
    record.round,
    record.subject,
    record.revision,
    record.projectionDigest,
    record.agent,
  ].join('\0');
}

export function recordRecommendationExpectation(entry, { subject, revision, projectionDigest }) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const expectation = {
    round: currentRound(entry),
    subject: requireSubject(subject),
    revision: requireHex(revision, 40, 'revision'),
    projectionDigest: requireHex(projectionDigest, 64, 'projection digest'),
    agent: RECOMMENDATION_REVIEW_AGENT,
  };
  if (metadata.expectations.some((candidate) => keyOf(candidate) === keyOf(expectation))) {
    throw new Error(
      `recommendation review: expectation already exists for ${subject} in round ${expectation.round}.`,
    );
  }
  if (
    metadata.expectations.some(
      (candidate) =>
        candidate.round === expectation.round && candidate.subject === expectation.subject,
    )
  ) {
    throw new Error(
      `recommendation review: round ${expectation.round} already has an expectation for ${subject}.`,
    );
  }
  metadata.expectations.push(expectation);
  return expectation;
}

export function recordRecommendationObservation(
  entry,
  { subject, revision, projectionDigest, verdict, unresolvedFindings },
) {
  const metadata = normalizeRecommendationReviewMetadata(entry);
  const observation = {
    round: currentRound(entry),
    subject: requireSubject(subject),
    revision: requireHex(revision, 40, 'revision'),
    projectionDigest: requireHex(projectionDigest, 64, 'projection digest'),
    agent: RECOMMENDATION_REVIEW_AGENT,
    verdict,
    unresolvedFindings,
  };
  if (!RECOMMENDATION_VERDICTS.has(verdict)) {
    throw new Error(
      `recommendation review: verdict must be ENDORSE, REVISE, or REJECT; got \`${verdict}\`.`,
    );
  }
  if (!Number.isInteger(unresolvedFindings) || unresolvedFindings < 0) {
    throw new Error('recommendation review: unresolved findings must be a non-negative integer.');
  }
  if (verdict === 'ENDORSE' && unresolvedFindings !== 0) {
    throw new Error('recommendation review: ENDORSE requires zero unresolved findings.');
  }
  const matches = metadata.expectations.filter(
    (candidate) => keyOf(candidate) === keyOf(observation),
  );
  if (matches.length !== 1) {
    throw new Error(
      `recommendation review: observation requires exactly one prior expectation for ${subject} in round ${observation.round}; found ${matches.length}.`,
    );
  }
  if (metadata.observations.some((candidate) => keyOf(candidate) === keyOf(observation))) {
    throw new Error(
      `recommendation review: observation already exists for ${subject} in round ${observation.round}.`,
    );
  }
  metadata.observations.push(observation);
  return observation;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

export function recommendationReviewExtensionErrors(entry) {
  const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
  if (extension === undefined) return [];
  const errors = [];
  if (!exactKeys(extension, ['expectations', 'observations'])) {
    return ['recommendationReview must contain exactly expectations and observations arrays'];
  }
  if (!Array.isArray(extension.expectations) || !Array.isArray(extension.observations)) {
    return ['recommendationReview expectations and observations must be arrays'];
  }
  const expectationKeys = ['agent', 'projectionDigest', 'revision', 'round', 'subject'];
  const observationKeys = [...expectationKeys, 'unresolvedFindings', 'verdict'].sort();
  const seenExpectations = new Set();
  const seenObservations = new Set();
  const seenExpectationRounds = new Set();
  const seenObservationRounds = new Set();
  const roundCount = Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0;
  let previousExpectationRound = 0;
  let previousObservationRound = 0;
  for (const expectation of extension.expectations) {
    if (!exactKeys(expectation, expectationKeys)) {
      errors.push('recommendation expectation has unknown or missing keys');
      continue;
    }
    try {
      requireSubject(expectation.subject);
      requireHex(expectation.revision, 40, 'revision');
      requireHex(expectation.projectionDigest, 64, 'projection digest');
    } catch (error) {
      errors.push(error.message);
    }
    if (
      !Number.isInteger(expectation.round) ||
      expectation.round < 1 ||
      expectation.agent !== RECOMMENDATION_REVIEW_AGENT
    ) {
      errors.push('recommendation expectation has invalid round or agent');
    }
    if (Number.isInteger(expectation.round) && expectation.round > roundCount) {
      errors.push('recommendation expectation round is outside the loop round history');
    }
    if (Number.isInteger(expectation.round) && expectation.round <= previousExpectationRound) {
      errors.push('recommendation expectation round order must be strictly increasing');
    }
    previousExpectationRound = expectation.round;
    const subjectRound = `${expectation.subject}\0${expectation.round}`;
    if (seenExpectationRounds.has(subjectRound)) {
      errors.push('duplicate recommendation expectation subject and round');
    }
    seenExpectationRounds.add(subjectRound);
    const key = keyOf(expectation);
    if (seenExpectations.has(key)) errors.push('duplicate recommendation expectation');
    seenExpectations.add(key);
  }
  for (const observation of extension.observations) {
    if (!exactKeys(observation, observationKeys)) {
      errors.push('recommendation observation has unknown or missing keys');
      continue;
    }
    const key = keyOf(observation);
    if (!seenExpectations.has(key))
      errors.push('recommendation observation has no exact expectation');
    if (seenObservations.has(key)) errors.push('duplicate recommendation observation');
    seenObservations.add(key);
    if (Number.isInteger(observation.round) && observation.round > roundCount) {
      errors.push('recommendation observation round is outside the loop round history');
    }
    if (Number.isInteger(observation.round) && observation.round <= previousObservationRound) {
      errors.push('recommendation observation round order must be strictly increasing');
    }
    previousObservationRound = observation.round;
    const subjectRound = `${observation.subject}\0${observation.round}`;
    if (seenObservationRounds.has(subjectRound)) {
      errors.push('duplicate recommendation observation subject and round');
    }
    seenObservationRounds.add(subjectRound);
    if (
      !RECOMMENDATION_VERDICTS.has(observation.verdict) ||
      !Number.isInteger(observation.unresolvedFindings) ||
      observation.unresolvedFindings < 0 ||
      (observation.verdict === 'ENDORSE' && observation.unresolvedFindings !== 0)
    ) {
      errors.push('recommendation observation has invalid verdict or unresolved findings');
    }
    if (
      Number.isInteger(observation.round) &&
      observation.round >= 1 &&
      observation.round <= roundCount &&
      entry.roundFindings[observation.round - 1] !== observation.unresolvedFindings
    ) {
      errors.push('recommendation observation findings differ from the canonical loop round');
    }
  }
  for (const expectation of extension.expectations) {
    const key = keyOf(expectation);
    if (!seenObservations.has(key))
      errors.push('recommendation expectation has no exact observation');
  }
  return errors;
}

export function main(args = process.argv.slice(2), out = console.log) {
  if (args[0] !== 'digest' || typeof args[1] !== 'string' || args.length !== 2) {
    throw new Error(
      'usage: node scripts/harness/recommendation-review-record.mjs digest <spec.md>',
    );
  }
  out(decisionProjectionDigest(readFileSync(args[1], 'utf8')));
  return 0;
}

const isDirectExecution = process.argv[1]?.endsWith('recommendation-review-record.mjs') === true;
if (isDirectExecution) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
