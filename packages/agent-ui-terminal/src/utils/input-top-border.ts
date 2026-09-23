/** Pure builder for the input area's top border line (optional right-aligned session title). */

export interface IInputTopBorder {
  left: string;
  label: string;
  right: string;
}

const TITLE_RIGHT_PAD = 2;

/** Build the top border with an optional session-name title, right-aligned 2 chars from the edge. */
export function buildInputTopBorder(innerWidth: number, sessionName?: string): IInputTopBorder {
  if (sessionName) {
    const label = ` "${sessionName}" `;
    const leftLen = Math.max(0, innerWidth - label.length - TITLE_RIGHT_PAD);
    return { left: '─'.repeat(leftLen), label, right: '─'.repeat(TITLE_RIGHT_PAD) };
  }
  return { left: '─'.repeat(innerWidth), label: '', right: '' };
}
