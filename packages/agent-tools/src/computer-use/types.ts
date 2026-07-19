/**
 * SELFHOST-010: computer-use driver port + perceive→act contract (v1).
 *
 * Mirrors the sandbox port precedent (`ISandboxClient` in `../sandbox/types.ts`): the port + the typed
 * action contract live in `agent-tools`, and the tool factory (`createComputerTool({ driver })`) composes
 * over the port. A neutral `ScriptedComputerDriver` (test-support, under `./testing`) and a zero-dependency
 * duck-typed `PageComputerDriver` reference adapter (`./page-computer-driver.ts`, mirror `E2BSandboxClient`)
 * implement this port — so NO heavy browser SDK and NO concrete target (URL/host) live in this package; the
 * surface supplies the concrete driver + target env.
 *
 * The contract is the OpenAI/Hermes perceive→act loop expressed once, neutrally: `screenshot()` perceives,
 * and `act(action)` executes one typed mutating action and returns the resulting screenshot so the model
 * re-perceives. The permission-bearing tool boundary splits in two (`ComputerView` perceives, `Computer`
 * acts) but the typed action union stays WHOLE here in the driver contract.
 */

/** A perceived screenshot: encoded image bytes the surface produced. */
export interface IComputerScreenshot {
  /** Base64-encoded image bytes. */
  data: string;
  /** IANA media type of the encoded bytes (e.g. `image/png`). */
  mediaType: string;
  /** Optional pixel width of the captured surface. */
  width?: number;
  /** Optional pixel height of the captured surface. */
  height?: number;
}

/** Mouse button for click/drag actions. */
export type TComputerMouseButton = 'left' | 'right' | 'middle';

/** A screen coordinate (device-independent pixels from the top-left of the perceived surface). */
export interface IComputerPoint {
  x: number;
  y: number;
}

/** Click at a coordinate. */
export interface IComputerClickAction {
  type: 'click';
  x: number;
  y: number;
  button?: TComputerMouseButton;
}

/** Double-click at a coordinate. */
export interface IComputerDoubleClickAction {
  type: 'double_click';
  x: number;
  y: number;
  button?: TComputerMouseButton;
}

/** Type literal text at the current focus. */
export interface IComputerTypeAction {
  type: 'type';
  text: string;
}

/** Press a chord/sequence of keys (e.g. `['Control', 'a']`). */
export interface IComputerKeypressAction {
  type: 'keypress';
  keys: string[];
}

/** Scroll at a coordinate by a wheel delta. */
export interface IComputerScrollAction {
  type: 'scroll';
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

/** Drag along a path of points (press at the first point, move through the rest, release at the last). */
export interface IComputerDragAction {
  type: 'drag';
  path: IComputerPoint[];
  button?: TComputerMouseButton;
}

/** Wait for the surface to settle. */
export interface IComputerWaitAction {
  type: 'wait';
  /** Milliseconds to wait; the driver applies a sensible default when omitted. */
  ms?: number;
}

/**
 * Hand control to the human (halt-for-user). Executing this suspends the action loop and PAUSES perception
 * (no screenshot is captured for its duration) so a secret the human types never enters the model context;
 * control resumes only on an explicit resume signal (`endTakeover()`).
 */
export interface IComputerTakeoverAction {
  type: 'takeover';
  /** Optional human-readable reason surfaced to the user (e.g. `enter your password`). */
  reason?: string;
}

/** The whole typed mutating-action union — stays WHOLE in the driver contract. */
export type TComputerAction =
  | IComputerClickAction
  | IComputerDoubleClickAction
  | IComputerTypeAction
  | IComputerKeypressAction
  | IComputerScrollAction
  | IComputerDragAction
  | IComputerWaitAction
  | IComputerTakeoverAction;

/** The discriminant literals of {@link TComputerAction}. */
export type TComputerActionType = TComputerAction['type'];

/**
 * The result of executing one action through the driver.
 *
 * For every non-takeover action the fresh post-action `screenshot` is present so the model re-perceives.
 * While a takeover suspends the action loop, perception is paused: `screenshot` is ABSENT and
 * `takeover` is `true`.
 */
export interface IComputerActionResult {
  /** Fresh screenshot AFTER the action; absent while a takeover pauses perception. */
  screenshot?: IComputerScreenshot;
  /** True while a human takeover suspends the action loop (perception is paused for its duration). */
  takeover?: boolean;
}

/**
 * The computer-use driver port (mirror `ISandboxClient`). `createComputerTool` composes over this.
 *
 * `screenshot()` perceives (returns `undefined` while a takeover pauses perception). `act(action)` executes
 * one typed mutating action and returns the resulting screenshot. `beginTakeover()`/`endTakeover()` are the
 * optional halt-for-user hooks the surface implements (surface the real window, block/resume perception).
 */
export interface IComputerDriver {
  /** Perceive the current surface; `undefined` while a takeover pauses perception. */
  screenshot(): Promise<IComputerScreenshot | undefined>;
  /** Execute one typed mutating action and return its result (a fresh screenshot, unless paused). */
  act(action: TComputerAction): Promise<IComputerActionResult>;
  /** Optional: begin a human takeover (surface the real window, pause perception). */
  beginTakeover?(reason?: string): Promise<void>;
  /** Optional: end a human takeover and resume the action loop + perception. */
  endTakeover?(): Promise<void>;
}

/** Tool options carrying the computer-use driver (mirror `ISandboxToolOptions`). */
export interface IComputerToolOptions {
  driver?: IComputerDriver;
}

/**
 * Duck-typed browser-page port for the zero-dep `PageComputerDriver` reference adapter (mirror
 * `IE2BSandboxAdapter`). It is a STRUCTURAL description of a browser-page-shaped object (Playwright/CDP
 * page); the surface passes the real page. Declaring it here keeps `agent-tools` free of any browser SDK
 * import — the neutrality invariant (TC-06).
 */
export interface IBrowserPageMouseAdapter {
  click(
    x: number,
    y: number,
    options?: { button?: TComputerMouseButton; clickCount?: number },
  ): Promise<void>;
  move(x: number, y: number): Promise<void>;
  down(options?: { button?: TComputerMouseButton }): Promise<void>;
  up(options?: { button?: TComputerMouseButton }): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

export interface IBrowserPageKeyboardAdapter {
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
}

export interface IBrowserPageAdapter {
  /** Capture the page as encoded image bytes. */
  screenshot(options?: { type?: string }): Promise<Uint8Array | string>;
  mouse: IBrowserPageMouseAdapter;
  keyboard: IBrowserPageKeyboardAdapter;
  /** Optional wait; the driver falls back to a timer when the page does not expose one. */
  waitForTimeout?(ms: number): Promise<void>;
}
