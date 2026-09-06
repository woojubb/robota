/** Catalogue boundary. Gate execution consumes parsed policy; it does not parse the catalogue. */
import { checkboxItems, sectionBody, tableRows } from './gate-document.mjs';

export function parseCatalogue(text) {
  const lines = String(text).split('\n');
  const gates = new Map();
  let current = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^###\s+(GATE-[A-Z]+|DONE-GATE-STAGE-\d)\b(.*)$/.exec(line);
    if (heading) {
      const upgrade = /`([a-z-]+)\s*→\s*([a-z-]+)`/.exec(heading[2]);
      current = {
        gate: heading[1],
        upgrade: upgrade ? { from: upgrade[1], to: upgrade[2] } : null,
        criteria: [],
        lines: [],
      };
      gates.set(heading[1], current);
      continue;
    }
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const gate of gates.values()) {
    for (const item of checkboxItems(gate.lines)) {
      const tags = [...item.text.matchAll(/\s*—\s*`(mechanical|semantic)`(?=\s|$)/g)];
      const last = tags[tags.length - 1];
      gate.criteria.push({
        text: last ? item.text.replace(last[0], '').replace(/\s+/g, ' ').trim() : item.text,
        tag: last ? last[1] : null,
        indent: item.indent,
      });
    }
  }
  return { gates, priorGates: parsePriorGateMap(text) };
}

export function parsePriorGateMap(text) {
  const section = sectionBody(text, /^Prior-gate map$/i);
  const map = new Map();
  if (!section)
    throw new Error(
      'the catalogue states no `## Prior-gate map` section — the ordering checks cannot run without it',
    );
  for (const cells of tableRows(section.body)) {
    const [gate, prior, status, reRun] = cells;
    const statusToken = /`([a-z-]+)`/.exec(status ?? '');
    const reRunToken = /`([a-z-]+)`/.exec(reRun ?? '');
    if (
      /^GATE-[A-Z]+(?: \((?:continuation|correction)\))?$/.test(gate ?? '') &&
      /^GATE-[A-Z]+$/.test(prior ?? '')
    ) {
      const value = { gate: prior, status: statusToken ? statusToken[1] : null };
      if (reRunToken) value.reRun = reRunToken[1];
      map.set(gate, value);
    }
  }
  return map;
}
