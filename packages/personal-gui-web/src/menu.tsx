import {
  Hash,
  LibraryBig,
  Lightbulb,
  MessageCircle,
  Newspaper,
  Settings,
  SquareCheck,
  SquarePen,
  SquarePlus,
} from 'lucide-react';
import { useState } from 'react';

import type { LucideIcon } from 'lucide-react';
import type { ISideChatView, ISpaceView } from './api.js';

/** The tabs every person has; spaces join them as `space:<id>`. */
export type TFixedTab = 'chat' | 'feed' | 'ideas' | 'goals' | 'library';
export type TTab = TFixedTab | `space:${string}`;

export const FIXED_TABS: readonly {
  readonly id: TFixedTab;
  readonly label: string;
  readonly hint: string;
  readonly icon: LucideIcon;
}[] = [
  { id: 'chat', label: 'Chat', hint: 'Talk with your agent', icon: MessageCircle },
  { id: 'feed', label: 'Feed', hint: 'Results and what needs you', icon: Newspaper },
  { id: 'ideas', label: 'Ideas', hint: 'Thoughts kept for later', icon: Lightbulb },
  { id: 'goals', label: 'Goals', hint: 'What your agent keeps working on', icon: SquareCheck },
  { id: 'library', label: 'Library', hint: 'What your agent knows about you', icon: LibraryBig },
];

export const spaceTab = (spaceId: string): TTab => `space:${spaceId}`;

/**
 * The tabs in the person's order: the saved order first, keeping only tabs that exist, then any tab
 * it does not name yet (a fixed tab, or a space made since) in its natural place at the end.
 */
export function orderTabs(saved: readonly string[], spaces: readonly ISpaceView[]): TTab[] {
  const all: TTab[] = [...FIXED_TABS.map((tab) => tab.id), ...spaces.map((s) => spaceTab(s.id))];
  const known = new Set<string>(all);
  const ordered = saved.filter((tab): tab is TTab => known.has(tab));
  const seen = new Set<string>(ordered);
  return [...new Set([...ordered, ...all.filter((tab) => !seen.has(tab))])];
}

/** Move one tab to another place in the order. */
export function moveTab(order: readonly TTab[], from: number, to: number): TTab[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length)
    return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

const rowClass = (active: boolean): string =>
  `flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-[14px] font-medium hover:bg-hover ${active ? 'bg-hover text-foreground' : 'text-foreground/85'}`;

/**
 * The menu: the person's tabs (fixed menus and spaces, in their order, which they can drag or move
 * with Alt+Up/Down), "Create space", the side chats, and a bottom bar with settings, search and a new
 * chat.
 */
export function Menu({
  order,
  spaces,
  current,
  sideChats,
  openSideChatId,
  onOpen,
  onReorder,
  onCreateSpace,
  onOpenSideChat,
  onRemoveSideChat,
  onSettings,
  onSearch,
  onNewChat,
  settingsOpen,
}: {
  readonly order: readonly TTab[];
  readonly spaces: readonly ISpaceView[];
  readonly current: string;
  readonly sideChats: readonly ISideChatView[];
  readonly openSideChatId: string | undefined;
  readonly onOpen: (tab: TTab) => void;
  readonly onReorder: (order: TTab[]) => void;
  readonly onCreateSpace: () => void;
  readonly onOpenSideChat: (id: string) => void;
  readonly onRemoveSideChat: (id: string) => void;
  readonly onSettings: () => void;
  readonly onSearch: (query: string) => void;
  readonly onNewChat: () => void;
  readonly settingsOpen: boolean;
}): React.ReactElement {
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [query, setQuery] = useState('');
  const describe = (tab: TTab): { label: string; hint: string; icon: LucideIcon } => {
    const fixed = FIXED_TABS.find((entry) => entry.id === tab);
    if (fixed !== undefined) return fixed;
    const space = spaces.find((entry) => spaceTab(entry.id) === tab);
    return { label: space?.name ?? 'Space', hint: 'Your space', icon: Hash };
  };
  return (
    <nav aria-label="Menu" className="flex h-full w-64 flex-shrink-0 flex-col bg-sidebar">
      <div className="px-5 pb-2 pt-5 text-[19px] font-semibold tracking-tight">Personal agent</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <h2 className="px-3 pb-1 pt-3 text-[12px] font-medium text-muted-foreground">Tabs</h2>
        <ul aria-label="Tabs" className="flex flex-col gap-0.5">
          {order.map((tab, index) => {
            const { label, hint, icon: Icon } = describe(tab);
            return (
              <li
                key={tab}
                draggable
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', tab);
                }}
                onDragOver={(event) => {
                  if (dragging !== undefined) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== undefined) onReorder(moveTab(order, dragging, index));
                  setDragging(undefined);
                }}
                onDragEnd={() => setDragging(undefined)}
                className={dragging === index ? 'opacity-50' : undefined}
              >
                <button
                  type="button"
                  title={`${hint} — drag, or Alt+Up/Down, to move`}
                  aria-current={current === tab ? 'page' : undefined}
                  onClick={() => onOpen(tab)}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                    if (step === 0) return;
                    event.preventDefault();
                    onReorder(moveTab(order, index, index + step));
                  }}
                  className={rowClass(current === tab)}
                >
                  <Icon aria-hidden className="h-5 w-5 flex-shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mx-3 my-3 border-t border-border" />
        <button
          type="button"
          onClick={onCreateSpace}
          aria-current={current === 'create-space' ? 'page' : undefined}
          className={rowClass(current === 'create-space')}
        >
          <SquarePlus aria-hidden className="h-5 w-5 flex-shrink-0" strokeWidth={1.75} />
          <span>Create space</span>
        </button>
        <p className="px-3 pt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Make it yours: drag the tabs above to reorder them, or add a space for something you care
          about.
        </p>
        <div className="mx-3 my-3 border-t border-border" />
        <section aria-label="Side chats">
          <h2 className="px-3 pb-1 text-[12px] font-medium text-muted-foreground">Side chats</h2>
          {sideChats.length === 0 ? (
            <p className="px-3 text-[12.5px] text-muted-foreground">
              Side chats you start appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sideChats.map((sideChat) => (
                <li key={sideChat.id} className="group flex items-center">
                  <button
                    type="button"
                    title={sideChat.title}
                    aria-current={openSideChatId === sideChat.id ? 'true' : undefined}
                    onClick={() => onOpenSideChat(sideChat.id)}
                    className="min-w-0 flex-1 truncate rounded-full px-3 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-hover"
                  >
                    {sideChat.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${sideChat.title} from side chats`}
                    onClick={() => onRemoveSideChat(sideChat.id)}
                    className="hidden px-2 text-muted-foreground hover:text-foreground group-hover:block"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 border-t border-border p-3">
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={settingsOpen}
          onClick={onSettings}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border hover:bg-hover"
        >
          <Settings aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <form
          role="search"
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim() !== '') onSearch(query.trim());
          }}
        >
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-full border border-border bg-background px-4 text-[14px] outline-none focus:border-foreground/40"
          />
        </form>
        <button
          type="button"
          aria-label="New chat"
          onClick={onNewChat}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border hover:bg-hover"
        >
          <SquarePen aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
}
