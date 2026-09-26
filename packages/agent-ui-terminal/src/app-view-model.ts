import type { TStaticItem } from './app-static-items.js';
import type { IAppThemeViewModel } from './hooks/useAppThemeState.js';
import type { IInputAreaHistorySearch } from './hooks/useInputAreaHistorySearch.js';
import type { ITuiCommandQueryPort } from './tui-app-channel-port.js';
import type { ITuiSessionEventNotice } from './tui-session-events.js';
import type { IPendingPermissionRequest } from './types.js';
import type {
  IActionRequest,
  IHistoryEntry,
  TActionResponse,
  TModelEffortSelection,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type {
  ICommandPluginAdapter,
  IStatusLineCommandSettings,
} from '@robota-sdk/agent-interface-command';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type {
  IResumableSessionSummary,
  IToolState,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IAppViewModel {
  readonly staticItems: TStaticItem[];
  /** Printing starts over from the first item when this changes (see `transcriptGeneration`). */
  readonly transcriptKey: number;
  readonly handoffSuspended: boolean;
  readonly updateNotice: string | undefined;
  readonly coordinationError: string | undefined;
  readonly coordinationPending: boolean;
  readonly sessionEventNotices: readonly ITuiSessionEventNotice[];
  readonly isShuttingDown: boolean;
  readonly stream: {
    readonly text: string;
    readonly activeTools: readonly IToolState[];
    readonly isThinking: boolean;
    readonly isStalled: boolean;
    readonly lastErrorMessage: string | null;
  };
  readonly background: IAppBackgroundViewModel;
  readonly permissionRequest: IPendingPermissionRequest | null;
  readonly pendingUserAction: IActionRequest | null;
  readonly resolveUserAction: (request: IActionRequest, response: TActionResponse) => void;
  readonly plugin: IAppPluginViewModel;
  readonly transport: IAppTransportViewModel;
  readonly sessionPicker: IAppSessionPickerViewModel;
  /** SCREEN-2002: the live theme, the resolved motion setting, and the picker over them. */
  readonly theme: IAppThemeViewModel;
  readonly contextPercentage: number;
  readonly input: IAppInputViewModel;
  readonly status: IAppStatusViewModel;
}

export type { IAppThemePickerViewModel, IAppThemeViewModel } from './hooks/useAppThemeState.js';

export interface IAppBackgroundViewModel {
  readonly entries: IExecutionWorkspaceEntry[];
  readonly focusedIndex: number | null;
  readonly selectedEntry: IExecutionWorkspaceEntry | undefined;
  readonly detail: {
    readonly page: IExecutionDetailPage | null;
    readonly loading: boolean;
    readonly error: string | undefined;
  };
  readonly switcherVisible: boolean;
  readonly snapshot: IExecutionWorkspaceSnapshot | null;
  readonly selectedEntryId: string | undefined;
  readonly select: (entryId: string) => void;
  readonly closeSwitcher: () => void;
  readonly attachToFork: (entry: IExecutionWorkspaceEntry) => void;
}

export interface IAppPluginViewModel {
  readonly visible: boolean;
  readonly callbacks: ICommandPluginAdapter;
  readonly close: () => void;
  readonly addMessage: (content: string) => void;
}

export interface IAppTransportViewModel {
  readonly visible: boolean;
  readonly registry: ITransportRegistryView | undefined;
  readonly close: () => void;
}

export interface IAppSessionPickerViewModel {
  readonly visible: boolean;
  readonly sessions: readonly IResumableSessionSummary[];
  readonly select: (sessionId: string) => void;
  readonly cancel: () => void;
}

export interface IAppInputViewModel {
  /** FLOW-2006: the deep link's prefill, present only until the composer takes it. */
  readonly initialValue?: string | undefined;
  /** Called by the composer the first time it seeds itself, so a remount does not re-seed. */
  readonly consumeInitialValue?: (() => void) | undefined;
  /** True while the composer's text is the one a deep link supplied. */
  readonly externalPromptOrigin?: boolean | undefined;
  readonly submit: (input: string) => Promise<void>;
  readonly cancelQueue: () => void;
  readonly disabled: boolean;
  readonly queueCancellationDisabled: boolean;
  readonly isAborting: boolean;
  readonly pendingPrompt: string | null;
  readonly pendingCount: number;
  readonly commandQueryPort: ITuiCommandQueryPort;
  readonly sessionName: string | undefined;
  readonly history: readonly IHistoryEntry[];
  readonly focusBackgroundList: () => void;
  /** SCREEN-1993: the stored-prompt search surface; absent ⇒ the feature is off. */
  readonly historySearch: IInputAreaHistorySearch | undefined;
}

export interface IAppStatusViewModel {
  readonly cwd: string;
  readonly permissionMode: TPermissionMode;
  readonly modelId: string | undefined;
  readonly providerType: string | undefined;
  readonly sessionId: string;
  readonly isThinking: boolean;
  readonly activeToolCount: number;
  readonly activeBackgroundTaskCount: number;
  readonly hasPendingPrompt: boolean;
  readonly contextState: { percentage: number; usedTokens: number; maxTokens: number };
  readonly sessionName: string | undefined;
  readonly settings: IStatusLineCommandSettings;
  readonly activeAgentLabel: string | undefined;
  readonly activePresetId: string | undefined;
  readonly effort: TModelEffortSelection | undefined;
  readonly gitRefreshToken: number;
}
