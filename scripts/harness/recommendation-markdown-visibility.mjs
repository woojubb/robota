import { marked } from 'marked';

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

export function normalizeRecommendationLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n');
}

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
    const closer = new RegExp(`^ {0,3}\\${marker}{${opener[1].length},}[ \\t]*$`);
    const closeAt = lines.findIndex((line, candidate) => candidate > index && closer.test(line));
    if (closeAt === -1) continue;
    ranges.push({ start: index, end: closeAt });
    index = closeAt;
  }
  return ranges;
}

function findLineContaining(lines, start, marker) {
  let closeAt = start;
  while (closeAt < lines.length && !lines[closeAt].includes(marker)) closeAt += 1;
  return Math.min(closeAt, lines.length - 1);
}

function htmlBlockEnd(lines, index, paragraphOpen) {
  const line = lines[index];
  if (/^ {0,3}<!--/.test(line)) return findLineContaining(lines, index, '-->');
  const bounded = [
    { opener: /^ {0,3}<\?/, closer: '?>' },
    { opener: /^ {0,3}<![A-Z]/, closer: '>' },
    { opener: /^ {0,3}<!\[CDATA\[/, closer: ']]>' },
  ].find(({ opener }) => opener.test(line));
  if (bounded) return findLineContaining(lines, index, bounded.closer);
  const raw = /^ {0,3}<(script|pre|style|textarea)(?:[\t >]|$)/i.exec(line);
  if (raw) {
    const closing = new RegExp(`</${raw[1]}\\s*>`, 'i');
    let closeAt = index;
    while (closeAt < lines.length && !closing.test(lines[closeAt])) closeAt += 1;
    return Math.min(closeAt, lines.length - 1);
  }
  const tag = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?:[\t />]|$)/.exec(line)?.[1];
  const complete = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?>\s*$/.test(line);
  if (!(tag && HTML_BLOCK_TAGS.has(tag.toLowerCase())) && !(complete && !paragraphOpen)) return -1;
  let closeAt = index;
  while (closeAt + 1 < lines.length && lines[closeAt + 1].trim() !== '') closeAt += 1;
  return closeAt;
}

function maskHtmlBlocks(lines, hidden) {
  let paragraphOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (hidden.has(index) || lines[index].trim() === '' || isParagraphBoundary(lines[index])) {
      paragraphOpen = false;
      continue;
    }
    const closeAt = htmlBlockEnd(lines, index, paragraphOpen);
    if (closeAt !== -1) {
      maskThrough(hidden, index, closeAt);
      index = closeAt;
      paragraphOpen = false;
      continue;
    }
    paragraphOpen = true;
  }
}

function unescapedBacktickRuns(source) {
  return [...source.matchAll(/`+/g)]
    .filter((match) => {
      let escapes = 0;
      for (let at = match.index - 1; at >= 0 && source[at] === '\\'; at -= 1) escapes += 1;
      return escapes % 2 === 0;
    })
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      length: match[0].length,
    }));
}

function lineLocator(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return (offset) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
    return line;
  };
}

function maskMultilineSpan(lines, masked, openerLine, closerLine, delimiter) {
  const crossesBoundary = lines.slice(openerLine + 1, closerLine).some(interruptsInlineParagraph);
  if (crossesBoundary) return;
  for (let line = openerLine + 1; line < closerLine; line += 1) {
    if (!interruptsInlineParagraph(lines[line])) masked[line] = '';
  }
  if (lines[openerLine].trim() === delimiter) masked[openerLine] = '';
  if (lines[closerLine].trim() === delimiter) masked[closerLine] = '';
}

function maskCodeSpans(lines) {
  const source = lines.join('\n');
  const scanSource = lines
    .map((line) => (/^\s*`{3,}/.test(line) ? line.replaceAll('`', '\0') : line))
    .join('\n');
  const lineAt = lineLocator(source);
  const masked = [...lines];
  const runs = unescapedBacktickRuns(scanSource);
  for (let index = 0; index < runs.length; index += 1) {
    const opener = runs[index];
    const closeIndex = runs.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && candidate.length === opener.length,
    );
    if (closeIndex === -1) continue;
    const openerLine = lineAt(opener.start);
    const closerLine = lineAt(runs[closeIndex].start);
    if (openerLine < closerLine) {
      maskMultilineSpan(lines, masked, openerLine, closerLine, '`'.repeat(opener.length));
    }
    index = closeIndex;
  }
  return masked;
}

export function recommendationProjectionLines(text) {
  const lines = normalizeRecommendationLines(text);
  const hidden = new Set();
  for (const range of pairedFenceLineRanges(lines)) maskThrough(hidden, range.start, range.end);
  const projectionLines = lines.map((line, index) => (hidden.has(index) ? '' : line));
  const structuralHidden = new Set(hidden);
  maskHtmlBlocks(lines, structuralHidden);
  const structuralLines = maskCodeSpans(
    lines.map((line, index) => (structuralHidden.has(index) ? '' : line)),
  );
  return { projectionLines, structuralLines };
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

export function canonicalRecommendationEvidence(lines) {
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
