import { useEffect, useCallback } from 'react';

export interface IKeyboardShortcut {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
    handler: () => void;
    description: string;
}

interface IUseKeyboardShortcutsProps {
    shortcuts: IKeyboardShortcut[];
    enabled?: boolean;
}

export function useKeyboardShortcuts({ shortcuts, enabled = true }: IUseKeyboardShortcutsProps) {
    const handleKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (!enabled) return;

            // Skip if user is typing in an input or textarea
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.contentEditable === 'true'
            ) {
                // Only allow Ctrl+S, Ctrl+R, and Escape in inputs
                const allowedInInputs = ['s', 'r', 'Escape'];
                if (!allowedInInputs.includes(event.key) || !event.ctrlKey) {
                    return;
                }
            }

            for (const shortcut of shortcuts) {
                const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
                const altMatch = shortcut.alt ? event.altKey : !event.altKey;
                const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
                const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey;

                if (
                    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
                    ctrlMatch &&
                    altMatch &&
                    shiftMatch &&
                    (shortcut.meta === undefined || metaMatch)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    shortcut.handler();
                    break;
                }
            }
        },
        [shortcuts, enabled]
    );

    useEffect(() => {
        if (!enabled) return;

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown, enabled]);

    return shortcuts;
}

// Predefined shortcuts for common actions
export const createShortcuts = {
    save: (handler: () => void): IKeyboardShortcut => ({
        key: 's',
        ctrl: true,
        handler,
        description: 'Save current project'
    }),

    run: (handler: () => void): IKeyboardShortcut => ({
        key: 'r',
        ctrl: true,
        handler,
        description: 'Run code'
    }),

    new: (handler: () => void): IKeyboardShortcut => ({
        key: 'n',
        ctrl: true,
        handler,
        description: 'New project'
    }),

    open: (handler: () => void): IKeyboardShortcut => ({
        key: 'o',
        ctrl: true,
        handler,
        description: 'Open project browser'
    }),

    export: (handler: () => void): IKeyboardShortcut => ({
        key: 'e',
        ctrl: true,
        shift: true,
        handler,
        description: 'Export project'
    }),

    templates: (handler: () => void): IKeyboardShortcut => ({
        key: 't',
        ctrl: true,
        handler,
        description: 'Open template gallery'
    }),

    quickRun: (handler: () => void): IKeyboardShortcut => ({
        key: 'Enter',
        ctrl: true,
        handler,
        description: 'Quick run (Ctrl+Enter)'
    }),

    escape: (handler: () => void): IKeyboardShortcut => ({
        key: 'Escape',
        handler,
        description: 'Close dialogs/panels'
    }),

    toggleSidebar: (handler: () => void): IKeyboardShortcut => ({
        key: '\\',
        ctrl: true,
        handler,
        description: 'Toggle sidebar'
    }),

    search: (handler: () => void): IKeyboardShortcut => ({
        key: 'f',
        ctrl: true,
        handler,
        description: 'Search'
    }),

    formatCode: (handler: () => void): IKeyboardShortcut => ({
        key: 'f',
        ctrl: true,
        shift: true,
        handler,
        description: 'Format code'
    }),

    toggleComments: (handler: () => void): IKeyboardShortcut => ({
        key: '/',
        ctrl: true,
        handler,
        description: 'Toggle comments'
    }),

    switchTab: (handler: (direction: 'next' | 'prev') => void) => [
        {
            key: 'Tab',
            ctrl: true,
            handler: () => handler('next'),
            description: 'Next tab'
        },
        {
            key: 'Tab',
            ctrl: true,
            shift: true,
            handler: () => handler('prev'),
            description: 'Previous tab'
        }
    ] as IKeyboardShortcut[]
}; 