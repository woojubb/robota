import { MarkdownText } from '@robota-sdk/agent-ui-web/client';
import { useState } from 'react';

import { Button, errorText, inputClass, when } from './ui.js';

import type { IFeedItemView, IFeedQuestionView, TQuestionAnswer } from '../api.js';

/** What the card says once the question is no longer waiting. */
function settled(question: IFeedQuestionView): string {
  if (question.state === 'withdrawn') return 'Your agent closed this case before you answered';
  const answer = question.answer;
  const said = answer?.choice ?? answer?.reply ?? '';
  return `You answered: ${said}${answer === undefined ? '' : ` · ${when(answer.at)}`}`;
}

/**
 * A question the agent asks about one of its cases: what it noted as the evidence, the question, one
 * button per choice, and a reply box when the question allows one. Answering records the answer on the
 * case; it does not approve or send anything.
 */
export function QuestionCard({
  item,
  question,
  onAnswer,
  onOpenThread,
  onDismiss,
}: {
  readonly item: IFeedItemView;
  readonly question: IFeedQuestionView;
  readonly onAnswer: (answer: TQuestionAnswer) => Promise<void>;
  readonly onOpenThread: () => void;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const open = question.state === 'open';
  const send = async (answer: TQuestionAnswer): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await onAnswer(answer);
      setReply('');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`rounded-lg border p-3 ${open ? 'border-warning' : 'border-border'}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wide text-subtle">
          Asks you
        </span>
        <h2 className="text-[14px] font-semibold">{item.title}</h2>
        <span className="ml-auto text-[12px] text-muted-foreground">{when(item.at)}</span>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">What your agent noted</p>
      <MarkdownText className="text-[14px]">{item.body}</MarkdownText>
      <p className="mt-2 whitespace-pre-wrap text-[14px] font-medium">{question.text}</p>
      {open ? (
        <>
          {question.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Button key={option} disabled={busy} onClick={() => void send({ choice: option })}>
                  {option}
                </Button>
              ))}
            </div>
          )}
          {question.allowsReply && (
            <form
              className="mt-2 flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (reply.trim() !== '') void send({ reply });
              }}
            >
              <textarea
                aria-label="Your reply"
                className={`${inputClass} min-w-0 flex-1`}
                rows={2}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
              <span className="flex-shrink-0 whitespace-nowrap">
                <Button type="submit" tone="primary" disabled={busy || reply.trim() === ''}>
                  Send reply
                </Button>
              </span>
            </form>
          )}
        </>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
          {settled(question)}
        </p>
      )}
      {error !== undefined && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={onOpenThread}>Open thread</Button>
        {!open && <Button onClick={onDismiss}>Dismiss</Button>}
      </div>
    </li>
  );
}
