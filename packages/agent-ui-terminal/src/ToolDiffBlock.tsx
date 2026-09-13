import { Box } from 'ink';
import React from 'react';

import { renderMarkdown } from './render-markdown.js';
import { RenderedText, Text } from './SafeText.js';
import { sanitizeTerminalText } from './sanitize-terminal-text.js';
import { useScreenReader } from './screen-reader-context.js';
import { PALETTE } from './tui-palette.js';
import { buildToolDiffSummary } from './utils/tool-diff-summary.js';

import type { IDiffLine } from './utils/edit-diff.js';

interface IProps {
  file?: string;
  lines: readonly IDiffLine[];
}

export default function ToolDiffBlock({ file, lines }: IProps): React.ReactElement {
  const summary = buildToolDiffSummary({ file, lines });
  // CLI-2004: the `\u2502` gutter is a vertical rule a reader announces on every line it prefixes.
  // The mode drops it — indentation already separates the block from the surrounding transcript.
  const screenReader = useScreenReader();
  const gutter = screenReader ? '' : '\u2502 ';

  return (
    <Box flexDirection="column" marginLeft={4}>
      {summary.file && (
        <Text color={PALETTE.text.emphasis} dimColor>
          {gutter}
          {sanitizeTerminalText(summary.file)}
        </Text>
      )}
      {/* `renderMarkdown` sanitizes its input and then styles it; the SGR in its output is ours. */}
      <RenderedText>{renderMarkdown(summary.markdown, { screenReader })}</RenderedText>
      {summary.truncated && (
        <Text color={PALETTE.text.emphasis} dimColor>
          {gutter}... and {summary.remainingLineCount} more lines
        </Text>
      )}
    </Box>
  );
}
