'use client';

import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/** One choice in a `PopupMenu`. `kind: 'radio'` (the default) is a value the person picks between,
 *  shown with a checkmark when it is the current one; `kind: 'action'` runs something instead (e.g.
 *  "Manage providers…") and never carries a checked state. */
export interface IPopupMenuItem {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly kind?: 'radio' | 'action';
  readonly checked?: boolean;
  readonly destructive?: boolean;
  readonly onSelect: () => void;
}

export interface IPopupMenuSection {
  readonly heading?: string;
  readonly items: readonly IPopupMenuItem[];
}

/**
 * A HIG pop-up menu (#3282 §2): `role="menu"`, its choices as `menuitemradio` with `aria-checked`
 * (or `menuitem` for a plain action, e.g. "Manage providers…"), grouped into optional labelled
 * sections. Arrow keys move a roving focus, Enter/Space activates the focused item, and Esc — or a
 * click outside — closes the menu and returns focus to the trigger that opened it, so the person
 * never loses their place. Initial focus lands on the current (checked) item, matching a native
 * pop-up menu; nothing else is pre-highlighted beyond that same focus ring.
 */
export function PopupMenu({
  label,
  sections,
  onClose,
  triggerRef,
}: {
  label: string;
  sections: readonly IPopupMenuSection[];
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement {
  const items = sections.flatMap((section) => section.items);
  const idPrefix = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const current = items.findIndex((item) => item.checked);
    return current >= 0 ? current : 0;
  });

  const close = (returnFocus: boolean): void => {
    onClose();
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
    // Registered once (empty deps): `onClose`/`triggerRef` are stable for the life of an open menu —
    // it is remounted fresh (`{open ? <PopupMenu .../> : null}`) rather than kept open across a prop
    // change that would replace them.
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setFocusedIndex((index) => (index + step + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[focusedIndex];
      if (item) {
        item.onSelect();
        close(true);
      }
    }
  };

  let cursor = -1;
  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="gui-rise absolute bottom-full z-30 mb-2 max-h-[360px] w-64 overflow-y-auto rounded-2xl bg-popover p-1.5 shadow-2xl shadow-black/35 focus:outline-none"
    >
      {sections.map((section, sectionIndex) => (
        <div key={section.heading ?? sectionIndex} role="group" aria-label={section.heading}>
          {section.heading ? (
            <div
              role="presentation"
              className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-subtle"
            >
              {section.heading}
            </div>
          ) : null}
          {section.items.map((item) => {
            cursor += 1;
            const index = cursor;
            const isAction = item.kind === 'action';
            // The accessible NAME is the label alone (`aria-label`) — otherwise a screen reader would
            // read the description as part of it (button content is used as the name by default). The
            // description is still announced, as a `aria-describedby` description instead.
            const descId = item.description ? `${idPrefix}-desc-${item.key}` : undefined;
            return (
              <button
                key={item.key}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role={isAction ? 'menuitem' : 'menuitemradio'}
                aria-checked={isAction ? undefined : item.checked === true}
                aria-label={item.label}
                aria-describedby={descId}
                tabIndex={index === focusedIndex ? 0 : -1}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => {
                  item.onSelect();
                  close(true);
                }}
                className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] ${
                  item.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-hover'
                } ${index === focusedIndex ? 'bg-hover' : ''}`}
              >
                {isAction ? null : (
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {item.checked ? <Check size={14} strokeWidth={2.25} aria-hidden="true" /> : null}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description ? (
                    <span id={descId} className="block truncate text-[12px] text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
