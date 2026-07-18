/**
 * SELFHOST-010: `PageComputerDriver` — a zero-dependency reference adapter (mirror `E2BSandboxClient`).
 *
 * It implements `IComputerDriver` by duck-typing a browser-page-shaped object via the locally-declared
 * `IBrowserPageAdapter` (`./types.ts`) — it imports NO heavy browser SDK (no Playwright/Puppeteer/CDP). The
 * surface passes the real page object, exactly as the sandbox surface passes a real E2B sandbox to
 * `E2BSandboxClient`. This keeps `agent-tools` neutral (TC-06): the environment lives in the surface.
 *
 * Takeover: `beginTakeover()` pauses perception (subsequent `screenshot()` returns `undefined` and further
 * actions are held) until `endTakeover()` resumes — the halt-for-user loop-suspension shape.
 */

import type {
  IBrowserPageAdapter,
  IComputerActionResult,
  IComputerDriver,
  IComputerScreenshot,
  TComputerAction,
} from './types.js';

export interface IPageComputerDriverOptions {
  /** The real browser page (duck-typed; the surface supplies it). */
  page: IBrowserPageAdapter;
  /** Media type of the captured bytes (default `image/png`). */
  mediaType?: string;
  /** Default wait when a `wait` action omits `ms` (default 500ms). */
  defaultWaitMs?: number;
}

const DEFAULT_MEDIA_TYPE = 'image/png';
const DEFAULT_WAIT_MS = 500;

/** Encode raw screenshot bytes to base64 (accepts the page's `Uint8Array` or an already-encoded string). */
function encodeScreenshot(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') {
    return bytes;
  }
  return Buffer.from(bytes).toString('base64');
}

export class PageComputerDriver implements IComputerDriver {
  private readonly page: IBrowserPageAdapter;
  private readonly mediaType: string;
  private readonly defaultWaitMs: number;
  private suspended = false;

  constructor(options: IPageComputerDriverOptions) {
    this.page = options.page;
    this.mediaType = options.mediaType ?? DEFAULT_MEDIA_TYPE;
    this.defaultWaitMs = options.defaultWaitMs ?? DEFAULT_WAIT_MS;
  }

  private async capture(): Promise<IComputerScreenshot> {
    // Honor the configured mediaType so the reported bytes and the label agree (jpeg vs png).
    const type = this.mediaType === 'image/jpeg' ? 'jpeg' : 'png';
    const bytes = await this.page.screenshot({ type });
    return { data: encodeScreenshot(bytes), mediaType: this.mediaType };
  }

  private async wait(ms: number): Promise<void> {
    if (this.page.waitForTimeout) {
      await this.page.waitForTimeout(ms);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async screenshot(): Promise<IComputerScreenshot | undefined> {
    // Perception is paused during a takeover so no screenshot captures the human's secret.
    if (this.suspended) {
      return undefined;
    }
    return this.capture();
  }

  async act(action: TComputerAction): Promise<IComputerActionResult> {
    if (action.type === 'takeover') {
      await this.beginTakeover(action.reason);
      return { takeover: true };
    }

    // While suspended, the action loop is halted — execute nothing and capture nothing.
    if (this.suspended) {
      return { takeover: true };
    }

    const { mouse, keyboard } = this.page;
    switch (action.type) {
      case 'click':
        await mouse.click(
          action.x,
          action.y,
          action.button ? { button: action.button } : undefined,
        );
        break;
      case 'double_click':
        await mouse.click(action.x, action.y, {
          clickCount: 2,
          ...(action.button ? { button: action.button } : {}),
        });
        break;
      case 'type':
        await keyboard.type(action.text);
        break;
      case 'keypress':
        // `keys` is a CHORD (e.g. ['Control','a'] = Ctrl+A), not a sequence — press them together via the
        // `'Control+a'` chord form (a single key like ['a'] presses just 'a').
        await keyboard.press(action.keys.join('+'));
        break;
      case 'scroll':
        await mouse.move(action.x, action.y);
        await mouse.wheel(action.deltaX, action.deltaY);
        break;
      case 'drag':
        await this.performDrag(action);
        break;
      case 'wait':
        await this.wait(action.ms ?? this.defaultWaitMs);
        break;
    }

    return { screenshot: await this.capture() };
  }

  /** Move the pointer along a multi-point path with the button held (mouse down → moves → up). */
  private async performDrag(action: Extract<TComputerAction, { type: 'drag' }>): Promise<void> {
    // Defensive: this reference adapter is public API; a direct caller may bypass the tool boundary's
    // `path.length >= 2` check. A drag needs at least a start + end point.
    if (action.path.length < 2) {
      throw new Error('computer drag requires a path of at least 2 points (start + end)');
    }
    const { mouse } = this.page;
    const [first, ...rest] = action.path;
    const button = action.button ? { button: action.button } : undefined;
    await mouse.move(first.x, first.y);
    await mouse.down(button);
    for (const point of rest) {
      await mouse.move(point.x, point.y);
    }
    await mouse.up(button);
  }

  async beginTakeover(_reason?: string): Promise<void> {
    this.suspended = true;
  }

  async endTakeover(): Promise<void> {
    this.suspended = false;
  }
}
