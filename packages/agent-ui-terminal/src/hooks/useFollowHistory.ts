import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useEffect, useRef } from 'react';

import { mintUserReadRequest } from '../key-custody/user-read-request-mint.js';
import { useKeybindingActions } from '../keybindings/keybindings-context.js';
import { useTuiCliAdapter, useUnlockCommand } from '../tui-cli-adapter-context.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
} from '@robota-sdk/agent-interface/execution';

interface IOptions {
  readonly entry: IExecutionWorkspaceEntry | undefined;
  readonly enabled: boolean;
  readonly read: (
    entryId: string,
    cursor?: IExecutionDetailCursor,
  ) => Promise<IExecutionDetailPage>;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

/** Read earlier fork output only in response to this terminal's key action. */
export function useFollowHistory({ entry, enabled, read, addEntry }: IOptions): void {
  const custody = useTuiCliAdapter().keyCustody;
  const unlockCommand = useUnlockCommand();
  const position = useRef<{
    cursor: IExecutionDetailCursor;
    seen: Set<string>;
    busy: boolean;
    generation: number;
  }>({ cursor: { offset: 0 }, seen: new Set(), busy: false, generation: 0 });
  useEffect(() => {
    position.current = {
      cursor: { offset: 0 },
      seen: new Set(),
      busy: false,
      generation: position.current.generation + 1,
    };
    return () => {
      position.current.generation++;
    };
  }, [entry?.id]);

  useKeybindingActions(
    'background-detail',
    (actions) => {
      if (!actions.includes('follow-earlier') || !entry?.resumeSessionId || position.current.busy)
        return;
      const cursor = position.current.cursor;
      const say = (text: string): void =>
        addEntry(messageToHistoryEntry(createSystemMessage(text)));
      const generation = position.current.generation;
      position.current.busy = true;
      void (async () => {
        let page = await read(entry.id, cursor);
        if (position.current.generation !== generation) return;
        if ((page.unreadable?.locked ?? 0) > 0) {
          if (!custody || !unlockCommand) {
            say('Earlier output is locked and cannot be unlocked here.');
            return;
          }
          const result = await custody.ensureReadable(mintUserReadRequest('follow-history'));
          if (position.current.generation !== generation) return;
          if (result !== 'readable') {
            say(`Earlier output remains locked. Run ${unlockCommand} and try again.`);
            return;
          }
          page = await read(entry.id, cursor);
          if (position.current.generation !== generation) return;
        }
        if ((page.unreadable?.locked ?? 0) > 0) {
          say(
            `Earlier output remains locked.${unlockCommand ? ` Run ${unlockCommand} and try again.` : ''}`,
          );
          return;
        }
        const unseen = page.records.filter((record) => !position.current.seen.has(record.id));
        for (const record of unseen) {
          say(record.text);
          position.current.seen.add(record.id);
        }
        if (page.unreadable && Object.values(page.unreadable).some((count) => count > 0)) {
          say('Some earlier output could not be read.');
        }
        if (page.nextCursor) {
          position.current.cursor = page.nextCursor;
          position.current.seen.clear();
        }
        if (unseen.length === 0 && !page.unreadable) say('No more earlier output yet.');
      })()
        .catch(() => {
          if (position.current.generation === generation) say('Could not read earlier output.');
        })
        .finally(() => {
          if (position.current.generation === generation) position.current.busy = false;
        });
    },
    { isActive: enabled && entry?.resumeSessionId !== undefined },
  );
}
