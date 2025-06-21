import type { Context } from '@robota-sdk/core';

export interface ContextManager {
    getContext(): Context;
    updateContext(context: Partial<Context>): void;
    clearContext(): void;
    addSystemMessage(content: string): void;
    getSystemMessages(): any[];
}

export type { Context }; 