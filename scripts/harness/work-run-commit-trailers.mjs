import { parseGitTrailerLine } from './frontmatter.mjs';

const WORK_TRAILER_TOKENS = new Set(['Work-Run', 'Work-Receipt']);

function normalizedLines(message) {
  const lines = message.replace(/\r\n?/gu, '\n').split('\n');
  while (lines.length > 0 && /^\s*$/u.test(lines.at(-1))) lines.pop();
  return lines;
}

function terminalTrailerEntries(lines) {
  if (lines.length === 0) return [];
  let start = lines.length - 1;
  while (start > 0 && !/^\s*$/u.test(lines[start - 1])) start -= 1;
  const entries = [];
  for (let index = start; index < lines.length; index += 1) {
    const entry = parseGitTrailerLine(lines[index]);
    if (entry) {
      entries.push({ token: entry.key, value: entry.value.trim(), line: index });
      continue;
    }
    if (/^[ \t]+\S/u.test(lines[index]) && entries.length > 0) {
      entries.at(-1).value += `\n${lines[index].trim()}`;
      continue;
    }
    return [];
  }
  return entries;
}

function allWorkTrailerLines(lines) {
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const entry = parseGitTrailerLine(lines[index]);
    if (entry && WORK_TRAILER_TOKENS.has(entry.key)) {
      entries.push({ token: entry.key, value: entry.value.trim(), line: index });
    }
  }
  return entries;
}

export function workRunReceiptTrailers(message) {
  if (typeof message !== 'string') {
    return { runIds: [], receiptIds: [], misplaced: false };
  }
  const lines = normalizedLines(message);
  const terminal = terminalTrailerEntries(lines).filter(({ token }) =>
    WORK_TRAILER_TOKENS.has(token),
  );
  const terminalLines = new Set(terminal.map(({ line }) => line));
  const misplaced = allWorkTrailerLines(lines).some(({ line }) => !terminalLines.has(line));
  return {
    runIds: terminal.filter(({ token }) => token === 'Work-Run').map(({ value }) => value),
    receiptIds: terminal.filter(({ token }) => token === 'Work-Receipt').map(({ value }) => value),
    misplaced,
  };
}

export function exactWorkRunReceiptTrailers(message) {
  const { runIds, receiptIds, misplaced } = workRunReceiptTrailers(message);
  if (misplaced) {
    throw new Error('Work-Run and Work-Receipt must appear only in the terminal Git trailer block');
  }
  if (runIds.length !== 1 || !/^\S+$/u.test(runIds[0])) {
    throw new Error('GitHub opening closure needs exactly one Work-Run trailer');
  }
  if (receiptIds.length !== 1 || !/^\S+$/u.test(receiptIds[0])) {
    throw new Error('GitHub opening closure needs exactly one Work-Receipt trailer');
  }
  return { runId: runIds[0], receiptId: receiptIds[0] };
}
