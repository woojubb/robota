import {
  ProductIdentityProvider,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';
import { useState } from 'react';

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

export type TMenu = 'chat' | 'library' | 'search' | 'settings';

export const MENUS: readonly {
  readonly id: TMenu;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'chat', label: 'Chat', hint: 'Talk with your agent' },
  { id: 'library', label: 'Library', hint: 'What your agent knows about you' },
  { id: 'search', label: 'Search', hint: 'Find anything your agent keeps' },
  { id: 'settings', label: 'Settings', hint: 'Model, browser and privacy' },
];

function ChatView({ wsUrl }: { readonly wsUrl: string }): React.ReactElement {
  const state = useWsSession(wsUrl);
  return <SessionSurface state={state} surface="web" draftMode="persistent" />;
}

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
  const [menu, setMenu] = useState<TMenu>('chat');
  const [openPage, setOpenPage] = useState<string | undefined>(undefined);
  const showPage = (pageId: string): void => {
    setOpenPage(pageId);
    setMenu('library');
  };
  return (
    <ProductIdentityProvider value={PERSONAL_IDENTITY}>
      <div className="flex h-full w-full bg-background text-foreground">
        <nav
          aria-label="Menu"
          className="flex w-44 flex-shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-2 py-3"
        >
          <div className="px-2.5 pb-3 text-[15px] font-semibold">Personal agent</div>
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
            <ChatView wsUrl={wsUrl} />
          </div>
          {menu === 'library' && (
            <LibraryView api={api} openPage={openPage} onOpenPage={setOpenPage} />
          )}
          {menu === 'search' && <SearchView api={api} onOpenPage={showPage} />}
          {menu === 'settings' && <SettingsView api={api} />}
        </main>
      </div>
    </ProductIdentityProvider>
  );
}
