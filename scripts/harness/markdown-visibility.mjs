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

export function visibleMarkdown(text, projectRawIndices = false) {
  const source = String(text ?? '');
  const sourceLines = source.split('\n');
  const lineStarts = [];
  let offset = 0;
  for (const line of sourceLines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const kept = [];
  const rawIndices = [];
  let fence = null;
  let htmlBlockEnd = null;
  let paragraphOpen = false;
  const inlineState = { comment: false, codeSpan: null };
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
      rawIndices.push(lineIndex);
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
    rawIndices.push(lineIndex);
    paragraphOpen = !(
      /^ {0,3}#{1,6}(?:\s|$)/.test(line) ||
      /^ {0,3}(?:=+|-+)\s*$/.test(line) ||
      /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)
    );
  }
  return projectRawIndices
    ? { source, lines: kept, rawIndices, sourceLines, lineStarts }
    : kept.join('\n');
}
