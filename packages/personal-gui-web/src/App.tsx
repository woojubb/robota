import {
  ProductIdentityProvider,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';
import { useState } from 'react';

import { FeedView } from './views/Feed.js';
import { GoalsView } from './views/Goals.js';
import { IdeasView } from './views/Ideas.js';
import { LibraryView } from './views/Library.js';
import { SearchView } from './views/Search.js';
import { SettingsView } from './views/Settings.js';

import type { IWebProductIdentity } from '@robota-sdk/agent-ui-web/client';
import type { IPersonalApi } from './api.js';

/** The personal agent's identity for the shared surface: its name, and the browser storage it owns. */
export const PERSONAL_IDENTITY: IWebProductIdentity = {
  identity: { displayName: 'Personal agent', cliName: 'personal-agent' },
  storage: { browserNamespace: 'robota-personal-agent' },
};

export type TMenu = 'chat' | 'feed' | 'ideas' | 'goals' | 'library' | 'search' | 'settings';

export const MENUS: readonly {
  readonly id: TMenu;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'chat', label: 'Chat', hint: 'Talk with your agent' },
  { id: 'feed', label: 'Feed', hint: 'Results and what needs you' },
  { id: 'ideas', label: 'Ideas', hint: 'Thoughts kept for later' },
  { id: 'goals', label: 'Goals', hint: 'What your agent keeps working on' },
  { id: 'library', label: 'Library', hint: 'What your agent knows about you' },
  { id: 'search', label: 'Search', hint: 'Find anything your agent keeps' },
  { id: 'settings', label: 'Settings', hint: 'Model, browser and privacy' },
];

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
      </nav>
      <main className="relative min-w-0 flex-1">
        <div className={menu === 'chat' ? 'h-full' : 'hidden'}>
          <SessionSurface state={chat} surface="web" draftMode="persistent" />
        </div>
        {menu === 'feed' && <FeedView api={api} onOpenGoal={showGoal} />}
        {menu === 'ideas' && <IdeasView api={api} onOpenGoal={showGoal} />}
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
