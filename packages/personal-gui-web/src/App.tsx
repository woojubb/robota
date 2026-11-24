import {
  ProductIdentityProvider,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';
import { Globe, MessageCircle, Menu as MenuIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BrowseView } from './views/Browse.js';
import { ConnectorsView } from './views/Connectors.js';
import { FeedView } from './views/Feed.js';
import { GoalsView } from './views/Goals.js';
import { IdeasView } from './views/Ideas.js';
import { BrowserPanel } from './views/BrowserPanel.js';
import { SideChat, recentTurns } from './views/SideChat.js';
import { CreateSpaceView, SpaceView } from './views/Spaces.js';
import { Menu, initialTab, orderTabs, spaceTab } from './menu.js';
import { openQuestionCount, usePageNotifications } from './notifications.js';
import { LibraryView } from './views/Library.js';
import { SearchView } from './views/Search.js';
import { SettingsView } from './views/Settings.js';

import type { IWebProductIdentity } from '@robota-sdk/agent-ui-web/client';
import type { IFeedItemView, IPersonalApi, ISideChatView, ISpaceView } from './api.js';
import type { TTab } from './menu.js';

/** The personal agent's identity for the shared surface: its name, and the browser storage it owns. */
export const PERSONAL_IDENTITY: IWebProductIdentity = {
  identity: { displayName: 'Personal agent', cliName: 'personal-agent' },
  storage: { browserNamespace: 'robota-personal-agent' },
};

/** The title the side chat record gives a question it does not keep. */
const SIDE_CHAT_FALLBACK_TITLE = 'Side chat';

/**
 * The shell: the menu (a drawer on narrow screens) beside the current view. The chat stays mounted while
 * another view is open, so its session and draft survive a trip to the library.
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

/** Whether the screen is narrow enough for the menu to be a drawer (Tailwind's `md` breakpoint). */
function useNarrowScreen(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** What the main area shows: a tab, or one of the views the menu's other controls open. */
type TView = TTab | 'search' | 'settings' | 'create-space';

function Shell({
  wsUrl,
  api,
}: {
  readonly wsUrl: string;
  readonly api: IPersonalApi;
}): React.ReactElement {
  const [view, setView] = useState<TView>(() => initialTab(window.location.hash));
  const [drawerOpen, setDrawerOpen] = useState(false);
  // On a narrow screen the closed drawer is off screen: it leaves the focus order and the
  // accessibility tree until it opens.
  const drawer = useRef<HTMLDivElement>(null);
  const narrow = useNarrowScreen();
  useEffect(() => {
    const element = drawer.current;
    if (element === null) return;
    element.inert = narrow && !drawerOpen;
  }, [narrow, drawerOpen]);
  const show = (next: TView): void => {
    setView(next);
    setDrawerOpen(false);
  };
  // The chat connection lives here, so the menu can start a new chat as well as the chat list can.
  const chat = useWsSession(wsUrl);
  // The menu is the navigation: the chat's own session list starts closed, one toggle away.
  const compact = useRef(false);
  useEffect(() => {
    if (compact.current || chat.status !== 'connected') return;
    compact.current = true;
    chat.setSessionSidebarOpen(false);
  }, [chat.status, chat.setSessionSidebarOpen]);

  // The person's tabs: the fixed menus and their spaces, in the order they chose.
  const [spaces, setSpaces] = useState<readonly ISpaceView[]>([]);
  const [savedOrder, setSavedOrder] = useState<readonly string[]>([]);
  // Moving a tab is held until the saved order has loaded once, so a move never starts from a guess,
  // and a load that started before the person's latest move does not undo it.
  const [orderLoaded, setOrderLoaded] = useState(false);
  const moves = useRef(0);
  const reloadTabs = useCallback(async () => {
    const movesAtStart = moves.current;
    const [nextSpaces, nextOrder] = await Promise.allSettled([api.spaces(), api.tabs()]);
    if (nextSpaces.status === 'fulfilled') setSpaces(nextSpaces.value);
    if (nextOrder.status === 'fulfilled' && moves.current === movesAtStart) {
      setSavedOrder(nextOrder.value);
      setOrderLoaded(true);
    }
  }, [api]);
  useEffect(() => {
    void reloadTabs();
  }, [reloadTabs]);
  const order = orderTabs(savedOrder, spaces);
  const reorder = (next: TTab[]): void => {
    if (!orderLoaded) return;
    moves.current += 1;
    setSavedOrder(next);
    void api.saveTabs(next).catch(() => undefined);
  };

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
  // One panel beside the chat at a time: a side chat, or the agent's browser.
  const [browserOpen, setBrowserOpen] = useState(false);
  const openSide = (resumeId?: string): void => {
    show('chat');
    setBrowserOpen(false);
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
    show('chat');
    if (chatIsEmpty) {
      chat.send({ type: 'submit', prompt: text });
      return;
    }
    opening.current = text;
    chat.newSession?.();
  };
  const bringBack = (text: string): void => {
    show('chat');
    chat.send({ type: 'submit', prompt: `From my side chat:\n\n${text}` });
  };
  const [openPage, setOpenPage] = useState<string | undefined>(undefined);
  const [openGoal, setOpenGoal] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState<{ readonly text: string; readonly at: number }>();
  const showGoal = (goalId: string): void => {
    setOpenGoal(goalId);
    show('goals');
  };
  const showPage = (pageId: string): void => {
    setOpenPage(pageId);
    show('library');
  };
  const openSpace = view.startsWith('space:') ? view.slice('space:'.length) : undefined;
  // The agent's messages for the person and the count of questions waiting, whichever tab is showing.
  const { setWaiting } = usePageNotifications(api, () => show('feed'));
  const countWaiting = useCallback(
    (items: readonly IFeedItemView[]) => setWaiting(openQuestionCount(items)),
    [setWaiting],
  );
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-foreground">
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}
      <div
        ref={drawer}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDrawerOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-40 border-r border-border transition-transform md:static md:translate-x-0 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Menu
          order={order}
          spaces={spaces}
          current={view}
          sideChats={sideChats}
          openSideChatId={side?.resumeId}
          onOpen={show}
          onReorder={reorder}
          onCreateSpace={() => show('create-space')}
          onOpenSideChat={(id) => openSide(id)}
          onRemoveSideChat={(id) =>
            void api.removeSideChat(id).then(reloadSideChats, () => undefined)
          }
          onSettings={() => show('settings')}
          settingsOpen={view === 'settings'}
          onSearch={(text) => {
            setSearchQuery({ text, at: Date.now() });
            show('search');
          }}
          onNewChat={() => {
            show('chat');
            chat.newSession?.();
          }}
        />
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          className="absolute left-3 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background md:hidden"
        >
          <MenuIcon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <div className={view === 'chat' ? 'relative flex h-full min-h-0' : 'hidden'}>
          <div className="relative min-w-0 flex-1">
            <SessionSurface state={chat} surface="web" draftMode="persistent" />
            {side === undefined && !browserOpen && (
              <button
                type="button"
                aria-label="Agent browser"
                title="Watch your agent's browser"
                onClick={() => setBrowserOpen(true)}
                className="absolute bottom-56 right-5 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-hover"
              >
                <Globe aria-hidden className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
            {side === undefined && !browserOpen && (
              <button
                type="button"
                aria-label="Side chat"
                title="Ask something on the side"
                onClick={() => openSide()}
                className="absolute bottom-40 right-5 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-hover"
              >
                <MessageCircle aria-hidden className="h-6 w-6" strokeWidth={1.75} />
              </button>
            )}
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
          {browserOpen && side === undefined && (
            <BrowserPanel
              api={api}
              onStop={() => chat.send({ type: 'abort' })}
              onClose={() => setBrowserOpen(false)}
            />
          )}
        </div>
        {view === 'feed' && <FeedView api={api} onOpenGoal={showGoal} onItems={countWaiting} />}
        {view === 'connectors' && <ConnectorsView api={api} />}
        {view === 'browse' && <BrowseView api={api} />}
        {view === 'ideas' && <IdeasView api={api} onOpenGoal={showGoal} />}
        {view === 'goals' && <GoalsView api={api} openGoal={openGoal} onOpenGoal={setOpenGoal} />}
        {view === 'library' && (
          <LibraryView api={api} openPage={openPage} onOpenPage={setOpenPage} />
        )}
        {openSpace !== undefined && (
          <SpaceView
            key={openSpace}
            api={api}
            spaceId={openSpace}
            onStartChat={startChat}
            onChanged={() => void reloadTabs()}
            onRemoved={() => {
              void reloadTabs();
              show('chat');
            }}
          />
        )}
        {view === 'create-space' && (
          <CreateSpaceView
            api={api}
            onCreated={(space) => {
              setSpaces((current) => [...current, space]);
              void reloadTabs();
              show(spaceTab(space.id));
            }}
            onCancel={() => show('chat')}
          />
        )}
        {view === 'search' && (
          <SearchView
            key={searchQuery?.at}
            api={api}
            {...(searchQuery !== undefined && { initialQuery: searchQuery.text })}
            onOpenPage={showPage}
          />
        )}
        {view === 'settings' && <SettingsView api={api} />}
      </main>
    </div>
  );
}
