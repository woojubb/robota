/** Pure legacy scan-output protocol helpers, separate from the diagnostic result contract. */

export const ADVISORY_MARKER = '::advisory::';
export const EXAMINED_MARKER = '::examined::';
export const EXPECTED_EMPTY_MARKER = '::expected-empty::';

const ANSI_ESCAPE = '\u001b';
const ANSI_SGR_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g');

/** Extract the visible text of marked legacy advisories without depending on the scan runner. */
export function extractAdvisories(output) {
  const advisories = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.replace(ANSI_SGR_PATTERN, '');
    const markerAt = line.indexOf(ADVISORY_MARKER);
    if (markerAt === -1) continue;
    const text = line.slice(markerAt + ADVISORY_MARKER.length).trim();
    if (text.length > 0) advisories.push(text);
  }
  return advisories;
}

/** Extract legacy examined-subject declarations without coupling producers to the scan runner. */
export function extractExamined(output) {
  const found = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.replace(ANSI_SGR_PATTERN, '');
    const at = line.indexOf(EXAMINED_MARKER);
    if (at === -1) continue;
    let rest = line.slice(at + EXAMINED_MARKER.length).trim();
    let expectedEmpty = null;
    const emptyAt = rest.indexOf(EXPECTED_EMPTY_MARKER);
    if (emptyAt !== -1) {
      expectedEmpty = rest.slice(emptyAt + EXPECTED_EMPTY_MARKER.length).trim() || null;
      rest = rest.slice(0, emptyAt).trim();
    }
    const match = /^(-?\d[\d,]*)\s*(.*)$/.exec(rest);
    found.push({
      size: match ? Number(match[1].replace(/,/g, '')) : null,
      subject: match ? match[2].trim() : rest,
      expectedEmpty,
    });
  }
  return found;
}
