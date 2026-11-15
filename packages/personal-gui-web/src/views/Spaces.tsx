import { useCallback, useEffect, useState } from 'react';

import { IdeaText } from './IdeaText.js';
import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type { IIdeaView, IPageSummary, IPersonalApi, ISpaceView } from '../api.js';

/**
 * One space, as its own tab: an area of the person's life with their instructions, the library pages
 * pinned to it and the ideas carrying its tag. A chat started here opens with those instructions, and
 * the pages to read, as the person's first message.
 */
export function SpaceView({
  api,
  spaceId,
  onStartChat,
  onChanged,
  onRemoved,
}: {
  readonly api: IPersonalApi;
  readonly spaceId: string;
  readonly onStartChat: (opening: string) => void;
  /** The space was renamed or edited: the menu shows its new name. */
  readonly onChanged: () => void;
  readonly onRemoved: () => void;
}): React.ReactElement {
  const [space, setSpace] = useState<ISpaceView | undefined>(undefined);
  const [missing, setMissing] = useState(false);
  const [pages, setPages] = useState<readonly IPageSummary[]>([]);
  const [ideas, setIdeas] = useState<readonly IIdeaView[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      const [spaces, library] = await Promise.all([api.spaces(), api.listPages()]);
      const found = spaces.find((candidate) => candidate.id === spaceId);
      setSpace(found);
      setMissing(found === undefined);
      setPages(library);
      setIdeas(found === undefined ? [] : await api.ideas(found.tag));
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, spaceId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (space === undefined) {
    return (
      <ViewFrame title="Space">
        {error !== undefined ? (
          <Notice tone="error">{error}</Notice>
        ) : missing ? (
          <Notice>This space no longer exists.</Notice>
        ) : (
          <Notice>Loading…</Notice>
        )}
      </ViewFrame>
    );
  }
  return (
    <ViewFrame
      title={space.name}
      actions={
        <>
          <Button tone="primary" onClick={() => onStartChat(space.opening)}>
            New chat in this space
          </Button>
          <Button onClick={() => setEditing(true)}>Edit</Button>
          <Button
            tone="danger"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete the space "${space.name}"? Its chats stay in your chat list.`,
                )
              )
                return;
              try {
                await api.removeSpace(space.id);
                onRemoved();
              } catch (caught) {
                setError(errorText(caught));
              }
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {editing ? (
        <SpaceForm
          api={api}
          space={space}
          onSaved={async () => {
            setEditing(false);
            await reload();
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-4 p-4">
          <section aria-label="Instructions">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              How your agent works here <span className="ml-1">#{space.tag}</span>
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-[14px]">
              {space.instructions === '' ? 'No instructions yet.' : space.instructions}
            </p>
          </section>
          <section aria-label="Pinned pages">
            <h2 className="text-[13px] font-medium text-muted-foreground">Pinned library pages</h2>
            {space.pinned.length === 0 && pages.length === 0 && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Your library has no pages yet.
              </p>
            )}
            <PinnedPages
              space={space}
              pages={pages}
              onPin={async (pageId, pin) => {
                try {
                  await api.pinPage(space.id, pageId, pin);
                  await reload();
                } catch (caught) {
                  setError(errorText(caught));
                }
              }}
            />
          </section>
          <section aria-label="Ideas in this space">
            <h2 className="text-[13px] font-medium text-muted-foreground">Ideas</h2>
            {ideas.length === 0 ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                No ideas tagged #{space.tag} yet.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {ideas.map((idea) => (
                  <li
                    key={idea.id}
                    className="rounded-md border border-border px-3 py-2 text-[13.5px]"
                  >
                    <IdeaText idea={idea} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </ViewFrame>
  );
}

/** Making a space from the menu's "Create space": once saved, it becomes a tab and opens. */
export function CreateSpaceView({
  api,
  onCreated,
  onCancel,
}: {
  readonly api: IPersonalApi;
  readonly onCreated: (space: ISpaceView) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  return (
    <ViewFrame title="Create space">
      <p className="max-w-xl px-4 pt-4 text-[13.5px] text-muted-foreground">
        A space is an area of your life with its own way of working: a trip, a renovation, a job
        search. It becomes a tab in your menu.
      </p>
      <SpaceForm
        api={api}
        space={undefined}
        onSaved={async (space) => onCreated(space)}
        onCancel={onCancel}
      />
    </ViewFrame>
  );
}

/** The library pages pinned to a space, and a picker for the rest of the library. */
function PinnedPages({
  space,
  pages,
  onPin,
}: {
  readonly space: ISpaceView;
  readonly pages: readonly IPageSummary[];
  readonly onPin: (pageId: string, pinned: boolean) => Promise<void>;
}): React.ReactElement {
  const unpinned = pages.filter((page) => !space.pinned.some((pin) => pin.id === page.id));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      {space.pinned.map((page) => (
        <span
          key={page.id}
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
        >
          {page.title}
          <button
            type="button"
            aria-label={`Unpin ${page.title}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void onPin(page.id, false)}
          >
            ×
          </button>
        </span>
      ))}
      {unpinned.length > 0 && (
        <select
          aria-label={`Pin a library page to ${space.name}`}
          className={inputClass}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') void onPin(event.target.value, true);
          }}
        >
          <option value="">Pin a library page…</option>
          {unpinned.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function SpaceForm({
  api,
  space,
  onSaved,
  onCancel,
}: {
  readonly api: IPersonalApi;
  readonly space: ISpaceView | undefined;
  readonly onSaved: (space: ISpaceView) => Promise<void>;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(space?.name ?? '');
  const [instructions, setInstructions] = useState(space?.instructions ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      aria-label={space === undefined ? 'New space' : 'Edit space'}
      className="flex max-w-xl flex-col gap-3 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const saved = await api.saveSpace({
            ...(space !== undefined && { id: space.id }),
            name,
            instructions,
          });
          await onSaved(saved.space);
        } catch (caught) {
          setError(errorText(caught));
        }
      }}
    >
      <label className="flex flex-col gap-1 text-[13px]">
        Name
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        How should your agent work in this space?
        <textarea
          className={inputClass}
          rows={4}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary">
          Save space
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
