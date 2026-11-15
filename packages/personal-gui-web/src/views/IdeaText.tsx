import { MarkdownText } from '@robota-sdk/agent-ui-web/client';

import type { IIdeaView } from '../api.js';

/** An idea's text: formatted when the agent wrote it, exactly as typed when the person did. */
export function IdeaText({
  idea,
  className = '',
}: {
  readonly idea: IIdeaView;
  readonly className?: string;
}): React.ReactElement {
  return idea.origin === 'agent' ? (
    <MarkdownText className={className}>{idea.text}</MarkdownText>
  ) : (
    <p className={`whitespace-pre-wrap ${className}`.trim()}>{idea.text}</p>
  );
}
