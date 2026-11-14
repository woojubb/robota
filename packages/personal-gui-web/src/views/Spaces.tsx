import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type { IPersonalApi, ISpaceView } from '../api.js';

/**
 * Areas of the person's life with their own instructions. A chat started in a space opens with those
 * instructions as the person's first message.
 */
export function SpacesView({
  api,
  onStartChat,
}: {
  readonly api: IPersonalApi;
  readonly onStartChat: (opening: string) => void;
}): React.ReactElement {
  const [spaces, setSpaces] = useState<readonly ISpaceView[] | undefined>(undefined);
  const [editing, setEditing] = useState<ISpaceView | 'new' | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      setSpaces(await api.spaces());
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <ViewFrame
      title="Spaces"
      actions={
        <Button tone="primary" onClick={() => setEditing('new')}>
          Create space
        </Button>
      }
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {editing !== undefined && (
        <SpaceForm
          api={api}
          space={editing === 'new' ? undefined : editing}
          onDone={async () => {
            setEditing(undefined);
            await reload();
          }}
        />
      )}
      {spaces !== undefined && spaces.length === 0 && editing === undefined && (
        <Notice>
          No spaces yet. Make one for a trip, a project or anything with its own way of working.
        </Notice>
      )}
      <ul className="flex max-w-3xl flex-col gap-2 p-4">
        {(spaces ?? []).map((space) => (
          <li key={space.id} className="rounded-lg border border-border p-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">{space.name}</h2>
              <span className="text-[12.5px] text-muted-foreground">#{space.tag}</span>
            </div>
            {space.instructions !== '' && (
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-muted-foreground">
                {space.instructions}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button tone="primary" onClick={() => onStartChat(space.opening)}>
                New chat in this space
              </Button>
              <Button onClick={() => setEditing(space)}>Edit</Button>
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
                    await reload();
                  } catch (caught) {
                    setError(errorText(caught));
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </ViewFrame>
  );
}

function SpaceForm({
  api,
  space,
  onDone,
}: {
  readonly api: IPersonalApi;
  readonly space: ISpaceView | undefined;
  readonly onDone: () => Promise<void>;
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
          await api.saveSpace({ ...(space !== undefined && { id: space.id }), name, instructions });
          await onDone();
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
        <Button onClick={() => void onDone()}>Cancel</Button>
      </div>
    </form>
  );
}
