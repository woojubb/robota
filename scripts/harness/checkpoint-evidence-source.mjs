import { createHash } from 'node:crypto';

import { visibleMarkdown } from './markdown-visibility.mjs';

function failure(error) {
  return { ok: false, error };
}

function isRepositoryPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function levelTwoSectionLines(text, headingPattern) {
  const source = String(text).split('\n');
  let fenced = false;
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (start === -1) {
      if (/^##\s+/.test(line) && headingPattern.test(line.replace(/^##\s+/, '').trim())) {
        start = index;
      }
      continue;
    }
    if (/^##\s+/.test(line)) return source.slice(start + 1, index);
  }
  return start === -1 ? null : source.slice(start + 1);
}

export function checkpointCheckboxItems(lines) {
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)[-*]\s+\[([ xX])\]\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const parts = [match[3]];
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '') break;
      const lead = /^(\s*)/.exec(line)[1].length;
      if (lead <= indent) break;
      parts.push(line.trim());
    }
    items.push({ checked: match[2] !== ' ', text: parts.join(' ').trim(), line: index, indent });
    index = next - 1;
  }
  return items;
}

export function checkpointCompletionCriteria(text) {
  const section = levelTwoSectionLines(text, /^Completion Criteria$/i);
  return section === null
    ? null
    : checkpointCheckboxItems(section).filter((item) => item.indent === 0);
}

export function taskItemsForCheckpoint(specText, taskText) {
  const criterionItems = checkpointCompletionCriteria(specText) ?? [];
  const criteria = criterionItems
    .map((item) => /^(TC-\d{2,}):/.exec(item.text)?.[1] ?? null)
    .filter(Boolean);
  if (criteria.every((id) => String(taskText).includes(id))) {
    return { ok: true, items: criteria.map((value) => ({ kind: 'tc-id', value })) };
  }
  const checkboxes = checkpointCheckboxItems(String(taskText).split('\n')).map((item) => item.text);
  if (checkboxes.length < criterionItems.length) {
    return failure(
      `Task names ${criteria.filter((id) => String(taskText).includes(id)).length}/${criteria.length} TC ids and carries ${checkboxes.length} checkbox task(s)`,
    );
  }
  return { ok: true, items: checkboxes.map((value) => ({ kind: 'checkbox', value })) };
}

function projectedHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    content: (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
  };
}

function projectedSection(projection, level, title) {
  const start = projection.lines.findIndex((line) => {
    const heading = projectedHeading(line);
    return heading?.level === level && heading.content === title;
  });
  if (start === -1) return null;
  let end = projection.lines.length;
  for (let index = start + 1; index < projection.lines.length; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (heading && heading.level <= level) {
      end = index;
      break;
    }
  }
  return { start, end };
}

export function rawGateImplementPassEntries(specText) {
  const projection = visibleMarkdown(specText, true);
  const section = projectedSection(projection, 2, 'Evidence Log');
  if (section === null) return [];
  const entries = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (
      heading?.level !== 3 ||
      !/^\[GATE-IMPLEMENT\] — ✅ PASS \| \d{4}-\d{2}-\d{2}$/.test(heading.content)
    ) {
      continue;
    }
    let end = section.end;
    for (let cursor = index + 1; cursor < section.end; cursor += 1) {
      const next = projectedHeading(projection.lines[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    let rawBoundaryLine =
      end === projection.lines.length ? projection.sourceLines.length : projection.rawIndices[end];
    if (end === projection.lines.length || projectedHeading(projection.lines[end])) {
      const rawEntryStartLine = projection.rawIndices[index];
      while (rawBoundaryLine > rawEntryStartLine + 1) {
        if (projection.sourceLines[rawBoundaryLine - 1].trim() !== '') break;
        rawBoundaryLine -= 1;
      }
    }
    const rawStart = projection.lineStarts[projection.rawIndices[index]];
    const rawEnd =
      rawBoundaryLine === projection.sourceLines.length
        ? projection.source.length
        : projection.lineStarts[rawBoundaryLine];
    entries.push(projection.source.slice(rawStart, rawEnd));
  }
  return entries;
}

export function priorPassDigest(rawEntry) {
  return `sha256:${createHash('sha256').update(String(rawEntry), 'utf8').digest('hex')}`;
}

function decisionSectionLines(contract, specText) {
  const [parentTitle, childTitle] = contract.decisionArtifacts.section.split('/');
  const projection = visibleMarkdown(specText, true);
  const parent = projectedSection(projection, 2, parentTitle);
  if (parent === null) return failure(`missing ${contract.decisionArtifacts.section} section`);
  const childStart = projection.lines.findIndex((line, index) => {
    if (index <= parent.start || index >= parent.end) return false;
    const heading = projectedHeading(line);
    return heading?.level === 3 && heading.content === childTitle;
  });
  if (childStart === -1) return failure(`missing ${contract.decisionArtifacts.section} section`);
  let childEnd = parent.end;
  for (let index = childStart + 1; index < parent.end; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (heading && heading.level <= 3) {
      childEnd = index;
      break;
    }
  }
  return { ok: true, lines: projection.lines.slice(childStart + 1, childEnd) };
}

export function continuationArtifacts(contract, specText) {
  const section = decisionSectionLines(contract, specText);
  if (!section.ok) return section;
  const prefix = contract.decisionArtifacts.linePrefix;
  const lines = section.lines.filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) {
    return failure(`Continuation artifacts line must occur exactly once, found ${lines.length}`);
  }
  const tokens = lines[0].slice(prefix.length).split(contract.decisionArtifacts.separator);
  if (tokens.length === 0 || tokens.some((token) => !/^`[^`]+`$/.test(token))) {
    return failure('Continuation artifacts must be Markdown code repository paths');
  }
  const paths = tokens.map((token) => token.slice(1, -1));
  if (paths.some((value) => !isRepositoryPath(value))) {
    return failure('Continuation artifacts contains an invalid repository path');
  }
  if (new Set(paths).size !== paths.length) {
    return failure('Continuation artifacts contains a duplicate path');
  }
  return { ok: true, artifacts: paths };
}

export function checkpointDelivery(contract, specText) {
  if (!contract.decisionDelivery) return failure('contract does not declare decisionDelivery');
  const section = decisionSectionLines(contract, specText);
  if (!section.ok) return section;
  const prefix = contract.decisionDelivery.linePrefix;
  const modeLines = section.lines.filter((line) => line.startsWith(prefix));
  if (modeLines.length !== 1) {
    return failure(`Delivery mode line must occur exactly once, found ${modeLines.length}`);
  }
  const match = /^`(single|sequenced)`$/.exec(modeLines[0].slice(prefix.length));
  if (!match) return failure('Delivery mode must be Markdown code `single` or `sequenced`');
  const deliveryMode = match[1];
  const artifactLines = section.lines.filter((line) =>
    line.startsWith(contract.decisionArtifacts.linePrefix),
  );
  if (deliveryMode === 'single') {
    return artifactLines.length === 0
      ? { ok: true, deliveryMode, artifacts: [] }
      : failure('single delivery forbids a Continuation artifacts line');
  }
  if (artifactLines.length === 0) {
    return failure('sequenced delivery requires one Continuation artifacts line');
  }
  const artifacts = continuationArtifacts(contract, specText);
  return artifacts.ok ? { ok: true, deliveryMode, artifacts: artifacts.artifacts } : artifacts;
}

export function checkpointDeliveryBindingError({
  contract,
  formName,
  isCurrentIntroduction,
  payload,
  spec,
  baseSpec,
  introductionSpec,
  introducesContinuation,
}) {
  if (
    contract.version === 1 &&
    formName === 'gateImplementFirst' &&
    introducesContinuation &&
    introductionSpec !== undefined
  ) {
    if (introductionSpec === null) {
      return 'legacy v1 first PASS introduction revision is unavailable';
    }
    const historical = continuationArtifacts(contract, introductionSpec);
    if (!historical.ok) {
      return `legacy v1 first PASS historical Decision is not sequenced; a corrective checkpoint is required: ${historical.error}`;
    }
    const current = continuationArtifacts(contract, baseSpec ?? spec);
    if (!current.ok) return current.error;
    if (JSON.stringify(historical.artifacts) !== JSON.stringify(current.artifacts)) {
      return 'legacy v1 first PASS introduction artifacts do not bind the current Decision contract';
    }
  }
  if (contract.version === 2 && isCurrentIntroduction) {
    const delivery = checkpointDelivery(
      contract,
      formName === 'gateImplementContinuation' ? (baseSpec ?? spec) : spec,
    );
    if (!delivery.ok) return delivery.error;
    if (
      payload.deliveryMode !== delivery.deliveryMode ||
      JSON.stringify(payload.sequencedArtifacts) !== JSON.stringify(delivery.artifacts)
    ) {
      return `${formName} deliveryMode/sequencedArtifacts do not bind the Decision contract`;
    }
  }
  return null;
}
