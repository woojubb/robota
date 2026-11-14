import {
  ProductIdentityProvider,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeedView } from './views/Feed.js';
import { GoalsView } from './views/Goals.js';
import { IdeasView } from './views/Ideas.js';
import { SideChat, recentTurns } from './views/SideChat.js';
import { SpacesView } from './views/Spaces.js';
import { LibraryView } from './views/Library.js';
import { SearchView } from './views/Search.js';
import { SettingsView } from './views/Settings.js';

import type { IWebProductIdentity } from '@robota-sdk/agent-ui-web/client';
import type { IPersonalApi, ISideChatView } from './api.js';

/** The personal agent's identity for the shared surface: its name, and the browser storage it owns. */
export const PERSONAL_IDENTITY: IWebProductIdentity = {
  identity: { displayName: 'Personal agent', cliName: 'personal-agent' },
  storage: { browserNamespace: 'robota-personal-agent' },
};

export type TMenu =
  'chat' | 'feed' | 'ideas' | 'goals' | 'spaces' | 'library' | 'search' | 'settings';

export const MENUS: readonly {
  readonly id: TMenu;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'chat', label: 'Chat', hint: 'Talk with your agent' },
  { id: 'feed', label: 'Feed', hint: 'Results and what needs you' },
  { id: 'ideas', label: 'Ideas', hint: 'Thoughts kept for later' },
  { id: 'goals', label: 'Goals', hint: 'What your agent keeps working on' },
  { id: 'spaces', label: 'Spaces', hint: 'Areas with their own way of working' },
  { id: 'library', label: 'Library', hint: 'What your agent knows about you' },
  { id: 'search', label: 'Search', hint: 'Find anything your agent keeps' },
  { id: 'settings', label: 'Settings', hint: 'Model, browser and privacy' },
];

/** The title the side chat record gives a question it does not keep. */
const SIDE_CHAT_FALLBACK_TITLE = 'Side chat';

/**
 * The shell: a menu rail beside the current view. The chat stays mounted while another menu is open,
 * so its session and draft survive a trip to the library.
 */
export function App({
  wsUrl,
  api,
}: {
  readonly wsUrl: string;
  readonly api: IPersonalApi;
}): React.ReactElement {
  // The shared surface's hooks read the product identity, so everything sits inside its provider.
  return (
    <ProductIdentityProvider value={PERSONAL_IDENTITY}>
      <Shell wsUrl={wsUrl} api={api} />
    </ProductIdentityProvider>
  );
}

function Shell({
  wsUrl,
  api,
}: {
  readonly wsUrl: string;
  readonly api: IPersonalApi;
}): React.ReactElement {
  const [menu, setMenu] = useState<TMenu>('chat');
  // The chat connection lives here, so the menu can start a new chat as well as the chat list can.
  const chat = useWsSession(wsUrl);
  // The open side chat: a new one (with the main chat's latest turns to offer) or a listed one.
  const [side, setSide] = useState<
    { readonly key: number; readonly resumeId?: string; readonly context?: string } | undefined
  >(undefined);
  const [sideChats, setSideChats] = useState<readonly ISideChatView[]>([]);
  const reloadSideChats = useCallback(async () => {
    try {
      setSideChats(await api.sideChats());
    } catch {
      // The list is a convenience; the side chats themselves stay in the chat list.
    }
  }, [api]);
  useEffect(() => {
    void reloadSideChats();
  }, [reloadSideChats]);
  const openSide = (resumeId?: string): void => {
    setMenu('chat');
    // The side chat records the chat it was started beside, so the listing has to be current.
    chat.requestSessions();
    const context = resumeId === undefined ? recentTurns(chat.messages) : undefined;
    setSide({
      key: Date.now(),
      ...(resumeId !== undefined && { resumeId }),
      ...(context !== undefined && { context }),
    });
  };
  const sideStarted = useCallback(
    async (sessionId: string, title: string): Promise<string | undefined> => {
      const parentId = chat.sessionListing?.currentSessionId;
      try {
        const { sideChat } = await api.recordSideChat({
          id: sessionId,
          title,
          ...(parentId !== undefined && { parentId }),
        });
        await reloadSideChats();
        // The record's fallback title marks a question it would not keep: the session keeps its name.
        return sideChat.title === SIDE_CHAT_FALLBACK_TITLE ? undefined : sideChat.title;
      } catch {
        return undefined;
      }
    },
    [api, chat.sessionListing, reloadSideChats],
  );
  // A space's opening goes into an empty chat: the current one if it is empty, else a new one, sent
  // once the new chat is current (its conversation starts empty).
  const opening = useRef<string | undefined>(undefined);
  const chatIsEmpty = chat.messages.length === 0;
  useEffect(() => {
    const pending = opening.current;
    if (pending === undefined || !chatIsEmpty || chat.status !== 'connected') return;
    opening.current = undefined;
    chat.send({ type: 'submit', prompt: pending });
  }, [chatIsEmpty, chat]);
  const startChat = (text: string): void => {
    setMenu('chat');
    if (chatIsEmpty) {
      chat.send({ type: 'submit', prompt: text });
      return;
    }
    opening.current = text;
    chat.newSession?.();
  };
  const bringBack = (text: string): void => {
    setMenu('chat');
    chat.send({ type: 'submit', prompt: `From my side chat:\n\n${text}` });
  };
  const [openPage, setOpenPage] = useState<string | undefined>(undefined);
  const [openGoal, setOpenGoal] = useState<string | undefined>(undefined);
  const showGoal = (goalId: string): void => {
    setOpenGoal(goalId);
    setMenu('goals');
  };
  const showPage = (pageId: string): void => {
    setOpenPage(pageId);
    setMenu('library');
  };
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <nav
        aria-label="Menu"
        className="flex w-44 flex-shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-2 py-3"
      >
        <div className="px-2.5 pb-3 text-[15px] font-semibold">Personal agent</div>
        <button
          type="button"
          disabled={chat.newSession === undefined}
          onClick={() => {
            setMenu('chat');
            chat.newSession?.();
          }}
          className="mb-2 rounded-lg border border-border px-2.5 py-2 text-left text-[14px] font-medium hover:bg-hover disabled:opacity-50"
        >
          New chat
        </button>
        <button
          type="button"
          aria-pressed={side !== undefined && side.resumeId === undefined}
          onClick={() => openSide()}
          className="mb-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-muted-foreground hover:bg-hover"
        >
          Side chat
        </button>
        {MENUS.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            aria-current={menu === item.id ? 'page' : undefined}
            onClick={() => setMenu(item.id)}
            className={`rounded-lg px-2.5 py-2 text-left text-[14px] font-medium hover:bg-hover ${menu === item.id ? 'bg-hover text-foreground' : 'text-muted-foreground'}`}
          >
            {item.label}
          </button>
        ))}
        <section
          aria-label="Side chats"
          className="mt-4 flex min-h-0 flex-col gap-1 border-t border-border pt-3"
        >
          <h2 className="px-2.5 text-[12px] font-medium text-muted-foreground">Side chats</h2>
          {sideChats.length === 0 && (
            <p className="px-2.5 text-[12px] text-muted-foreground">
              Side chats you start appear here.
            </p>
          )}
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {sideChats.map((sideChat) => (
              <li key={sideChat.id} className="group flex items-center">
                <button
                  type="button"
                  title={sideChat.title}
                  aria-current={side?.resumeId === sideChat.id ? 'true' : undefined}
                  onClick={() => openSide(sideChat.id)}
                  className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-hover"
                >
                  {sideChat.title}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${sideChat.title} from side chats`}
                  onClick={() =>
                    void api.removeSideChat(sideChat.id).then(reloadSideChats, () => undefined)
                  }
                  className="hidden px-1 text-muted-foreground hover:text-foreground group-hover:block"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      </nav>
      <main className="relative min-w-0 flex-1">
        <div className={menu === 'chat' ? 'flex h-full' : 'hidden'}>
          <div className="min-w-0 flex-1">
            <SessionSurface state={chat} surface="web" draftMode="persistent" />
          </div>
          {side !== undefined && (
            <SideChat
              key={side.key}
              wsUrl={wsUrl}
              {...(side.resumeId !== undefined && { resumeId: side.resumeId })}
              {...(side.context !== undefined && { context: side.context })}
              onStarted={sideStarted}
              onBringBack={bringBack}
              onClose={() => setSide(undefined)}
            />
          )}
        </div>
        {menu === 'feed' && <FeedView api={api} onOpenGoal={showGoal} />}
        {menu === 'ideas' && <IdeasView api={api} onOpenGoal={showGoal} />}
        {menu === 'spaces' && <SpacesView api={api} onStartChat={startChat} />}
        {menu === 'goals' && <GoalsView api={api} openGoal={openGoal} onOpenGoal={setOpenGoal} />}
        {menu === 'library' && (
          <LibraryView api={api} openPage={openPage} onOpenPage={setOpenPage} />
        )}
        {menu === 'search' && <SearchView api={api} onOpenPage={showPage} />}
        {menu === 'settings' && <SettingsView api={api} />}
      </main>
    </div>
  );
}
