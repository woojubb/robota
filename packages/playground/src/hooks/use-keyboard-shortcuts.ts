import { useEffect, useCallback } from 'react';

interface KeyboardShortcut {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
    handler: () => void;
    description: string;
}

interface UseKeyboardShortcutsProps {
    shortcuts: KeyboardShortcut[];
    enabled?: boolean;
}

export function useKeyboardShortcuts({ shortcuts, enabled = true }: UseKeyboardShortcutsProps) {
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
    save: (handler: () => void): KeyboardShortcut => ({
        key: 's',
        ctrl: true,
        handler,
        description: 'Save current project'
    }),

    run: (handler: () => void): KeyboardShortcut => ({
        key: 'r',
        ctrl: true,
        handler,
        description: 'Run code'
    }),

    new: (handler: () => void): KeyboardShortcut => ({
        key: 'n',
        ctrl: true,
        handler,
        description: 'New project'
    }),

    open: (handler: () => void): KeyboardShortcut => ({
        key: 'o',
        ctrl: true,
        handler,
        description: 'Open project browser'
    }),

    export: (handler: () => void): KeyboardShortcut => ({
        key: 'e',
        ctrl: true,
        shift: true,
        handler,
        description: 'Export project'
    }),

    templates: (handler: () => void): KeyboardShortcut => ({
        key: 't',
        ctrl: true,
        handler,
        description: 'Open template gallery'
    }),

    quickRun: (handler: () => void): KeyboardShortcut => ({
        key: 'Enter',
        ctrl: true,
        handler,
        description: 'Quick run (Ctrl+Enter)'
    }),

    escape: (handler: () => void): KeyboardShortcut => ({
        key: 'Escape',
        handler,
        description: 'Close dialogs/panels'
    }),

    toggleSidebar: (handler: () => void): KeyboardShortcut => ({
        key: '\\',
        ctrl: true,
        handler,
        description: 'Toggle sidebar'
    }),

    search: (handler: () => void): KeyboardShortcut => ({
        key: 'f',
        ctrl: true,
        handler,
        description: 'Search'
    }),

    formatCode: (handler: () => void): KeyboardShortcut => ({
        key: 'f',
        ctrl: true,
        shift: true,
        handler,
        description: 'Format code'
    }),

    toggleComments: (handler: () => void): KeyboardShortcut => ({
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
    ] as KeyboardShortcut[]
}; 