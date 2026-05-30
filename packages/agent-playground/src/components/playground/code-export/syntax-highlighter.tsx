'use client';

import React from 'react';

type TToken = { type: 'keyword' | 'string' | 'comment' | 'import-path' | 'plain'; text: string };

const KEYWORDS = new Set([
  'import',
  'from',
  'const',
  'let',
  'var',
  'async',
  'await',
  'new',
  'return',
  'export',
]);

function tokenizeLine(line: string): TToken[] {
  const tokens: TToken[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    // line comment
    if (remaining.startsWith('//')) {
      tokens.push({ type: 'comment', text: remaining });
      return tokens;
    }

    // single-quoted or double-quoted string
    const strMatch = remaining.match(/^(['"])((?:[^'"\\]|\\.)*)\1/);
    if (strMatch) {
      tokens.push({ type: 'string', text: strMatch[0] });
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // backtick template literal (simplified, single-line)
    const tmplMatch = remaining.match(/^`[^`]*`/);
    if (tmplMatch) {
      tokens.push({ type: 'string', text: tmplMatch[0] });
      remaining = remaining.slice(tmplMatch[0].length);
      continue;
    }

    // word token
    const wordMatch = remaining.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      tokens.push({ type: KEYWORDS.has(word) ? 'keyword' : 'plain', text: word });
      remaining = remaining.slice(word.length);
      continue;
    }

    // single char
    tokens.push({ type: 'plain', text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return tokens;
}

const TOKEN_COLORS: Record<TToken['type'], string> = {
  keyword: 'text-violet-400',
  string: 'text-green-400',
  comment: 'text-zinc-500 italic',
  'import-path': 'text-amber-400',
  plain: 'text-zinc-200',
};

interface ISyntaxHighlighterProps {
  code: string;
  showLineNumbers?: boolean;
}

export function SyntaxHighlighter({ code, showLineNumbers = true }: ISyntaxHighlighterProps) {
  const lines = code.split('\n');

  return (
    <pre className="text-xs leading-relaxed font-mono overflow-x-auto">
      {lines.map((line, i) => {
        const tokens = tokenizeLine(line);
        return (
          <div key={i} className="flex">
            {showLineNumbers && (
              <span className="select-none text-zinc-600 text-right pr-4 w-8 shrink-0">
                {i + 1}
              </span>
            )}
            <span>
              {tokens.map((token, j) => (
                <span key={j} className={TOKEN_COLORS[token.type]}>
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </pre>
  );
}
