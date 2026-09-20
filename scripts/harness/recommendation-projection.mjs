import { createHash } from 'node:crypto';

import { parseFrontmatterBlock } from './frontmatter.mjs';
import {
  canonicalRecommendationEvidence,
  normalizeRecommendationLines,
  recommendationProjectionLines,
} from './recommendation-markdown-visibility.mjs';

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

function canonicalBody(lines) {
  const normalized = lines.map((line) => line.trimEnd());
  while (normalized.length > 0 && normalized[0].trim() === '') normalized.shift();
  while (normalized.length > 0 && normalized.at(-1).trim() === '') normalized.pop();
  return normalized.join('\n');
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

function visibleHeadings(lines, startAt) {
  const headings = [];
  for (let index = startAt; index < lines.length; index += 1) {
    const match = /^ {0,3}(#{1,6})(?:[\t ]+(.*?)[\t ]*|[\t ]*)$/.exec(lines[index]);
    if (!match) continue;
    const title = (match[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '');
    headings.push({ index, level: match[1].length, title });
  }
  return headings;
}

function assertKnownHeadingOwners(headings) {
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
}

function titleHeading(headings, startAt, bodyLines) {
  const h1 = headings.filter((heading) => heading.level === 1);
  if (h1.length !== 1) {
    throw new Error(
      `recommendation projection: expected exactly one visible title, found ${h1.length}.`,
    );
  }
  const title = h1[0];
  const firstH2 = headings.find((heading) => heading.level === 2);
  const preTitle = bodyLines.slice(startAt, title.index);
  if (
    title.index < startAt ||
    (firstH2 && firstH2.index < title.index) ||
    preTitle.some((line) => line.trim() !== '')
  ) {
    throw new Error(
      'recommendation projection: nonblank content before the title is not owned by a canonical planning section.',
    );
  }
  return title;
}

function sectionEnd(headings, heading, lineCount) {
  return (
    headings.find((candidate) => candidate.index > heading.index && candidate.level <= 2)?.index ??
    lineCount
  );
}

function requiredSectionBodies(headings, lines, bodyLines) {
  const sections = new Map();
  const structuralSections = new Map();
  for (const name of REQUIRED_SECTIONS) {
    const matches = headings.filter((heading) => heading.level === 2 && heading.title === name);
    if (matches.length !== 1) {
      const reason = matches.length === 0 ? `missing ${name}` : `duplicate ${name}`;
      throw new Error(
        `recommendation projection: ${reason} section; expected one visible owner, found ${matches.length}.`,
      );
    }
    const heading = matches[0];
    const end = sectionEnd(headings, heading, lines.length);
    sections.set(name, canonicalBody(bodyLines.slice(heading.index + 1, end)));
    structuralSections.set(name, canonicalBody(lines.slice(heading.index + 1, end)));
  }
  return { sections, structuralSections };
}

function optionalRanges(headings, lineCount) {
  const ranges = new Map();
  for (const name of OPTIONAL_SECTIONS) {
    const heading = headings.find((candidate) => candidate.level === 2 && candidate.title === name);
    if (!heading) continue;
    ranges.set(name, { start: heading.index + 1, end: sectionEnd(headings, heading, lineCount) });
  }
  return ranges;
}

function sectionRanges(lines, startAt, bodyLines = lines) {
  const headings = visibleHeadings(lines, startAt);
  assertKnownHeadingOwners(headings);
  const title = titleHeading(headings, startAt, bodyLines);
  const { sections, structuralSections } = requiredSectionBodies(headings, lines, bodyLines);
  return {
    title: title.title,
    sections,
    structuralSections,
    optionalSectionRanges: optionalRanges(headings, lines.length),
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

function testPlanRows(section) {
  return section.split('\n').map((line) => {
    if (!line.startsWith('|') || !line.endsWith('|')) return null;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    return cells.length === 4 ? cells : null;
  });
}

function tcIdsFromPlan(section) {
  const rows = testPlanRows(section);
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

export function decisionProjection(markdown) {
  const { projectionLines, structuralLines } = recommendationProjectionLines(markdown);
  const frontmatter = frontmatterProjection(projectionLines);
  const result = sectionRanges(structuralLines, frontmatter.end + 1, projectionLines);
  assertTcBijection(
    result.structuralSections.get('Completion Criteria'),
    result.structuralSections.get('Test Plan'),
  );
  const sections = result.sections;
  return {
    frontmatter: Object.fromEntries(frontmatter.entries),
    title: result.title,
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

export function recommendationCheckpointEvidence(markdown) {
  const rawLines = normalizeRecommendationLines(markdown);
  const { projectionLines, structuralLines } = recommendationProjectionLines(markdown);
  const frontmatter = frontmatterProjection(projectionLines);
  const { optionalSectionRanges } = sectionRanges(
    structuralLines,
    frontmatter.end + 1,
    projectionLines,
  );
  const evidenceRange = optionalSectionRanges.get('Evidence Log');
  return evidenceRange
    ? canonicalRecommendationEvidence(rawLines.slice(evidenceRange.start, evidenceRange.end))
    : '';
}
