import { useCallback, useEffect, useState } from 'react';

import { IdeaText } from './IdeaText.js';
import { Button, Notice, ViewFrame, errorText, inputClass, when } from './ui.js';

import type { IIdeaView, IPersonalApi } from '../api.js';

/**
 * Thoughts kept for later. The agent's own suggestions are marked as such and wait for the person;
 * making one a goal is the person taking it up, and the idea remembers what it became.
 */
export function IdeasView({
  api,
  onOpenGoal,
}: {
  readonly api: IPersonalApi;
  readonly onOpenGoal: (goalId: string) => void;
}): React.ReactElement {
  const [ideas, setIdeas] = useState<readonly IIdeaView[] | undefined>(undefined);
  const [allTags, setAllTags] = useState<readonly string[]>([]);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      setIdeas(await api.ideas(tag));
      // The tag choices come from every idea, so choosing one tag never hides the others.
      setAllTags([...new Set((await api.ideas()).flatMap((idea) => idea.tags))].sort());
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, tag]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const act = async (
    idea: IIdeaView,
    action: 'archive' | 'remove' | 'make-goal',
  ): Promise<void> => {
    try {
      const answer = await api.ideaAction(idea.id, action);
      if (action === 'make-goal' && answer.goal !== undefined) {
        onOpenGoal(answer.goal.id);
        return;
      }
      await reload();
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  return (
    <ViewFrame title="Ideas">
      <form
        aria-label="New idea"
        className="flex max-w-3xl flex-col gap-2 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.addIdea({
              text,
              tags: tags.split(/[\s,]+/u).filter((entry) => entry !== ''),
            });
            setText('');
            setTags('');
            await reload();
          } catch (caught) {
            setError(errorText(caught));
          }
        }}
      >
        <textarea
          aria-label="Idea"
          placeholder="Something to come back to…"
          className={inputClass}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
        />
        <div className="flex gap-2">
          <input
            aria-label="Tags"
            placeholder="tags, separated by spaces"
            className={inputClass}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          <Button type="submit" tone="primary">
            Keep
          </Button>
        </div>
      </form>
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          <Button
            tone={tag === undefined ? 'primary' : 'default'}
            onClick={() => setTag(undefined)}
          >
            All
          </Button>
          {allTags.map((entry) => (
            <Button
              key={entry}
              tone={tag === entry ? 'primary' : 'default'}
              onClick={() => setTag(entry)}
            >
              #{entry}
            </Button>
          ))}
        </div>
      )}
      {ideas !== undefined && ideas.length === 0 && (
        <Notice>No ideas yet. Jot one down, or tell your agent to keep one.</Notice>
      )}
      <ul className="flex max-w-3xl flex-col gap-2 px-4 pb-4">
        {(ideas ?? []).map((idea) => (
          <li key={idea.id} className="rounded-lg border border-border p-3">
            <IdeaText idea={idea} className="text-[14px]" />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
              <span>{idea.origin === 'agent' ? 'Suggested by your agent' : 'Yours'}</span>
              <span>{when(idea.createdAt)}</span>
              {idea.tags.map((entry) => (
                <span key={entry}>#{entry}</span>
              ))}
              {idea.status === 'taken-up' && <span>Became a goal</span>}
              <span className="ml-auto flex gap-2">
                {idea.status === 'open' && (
                  <Button onClick={() => void act(idea, 'make-goal')}>Make it a goal</Button>
                )}
                <Button onClick={() => void act(idea, 'archive')}>Archive</Button>
                <Button
                  tone="danger"
                  onClick={() => {
                    if (window.confirm('Delete this idea?')) void act(idea, 'remove');
                  }}
                >
                  Delete
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </ViewFrame>
  );
}
