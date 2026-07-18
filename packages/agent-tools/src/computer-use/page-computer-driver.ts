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
    const bytes = await this.page.screenshot({ type: 'png' });
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
        for (const key of action.keys) {
          await keyboard.press(key);
        }
        break;
      case 'scroll':
        await mouse.move(action.x, action.y);
        await mouse.wheel(action.deltaX, action.deltaY);
        break;
      case 'drag': {
        const [first, ...rest] = action.path;
        await mouse.move(first.x, first.y);
        await mouse.down(action.button ? { button: action.button } : undefined);
        for (const point of rest) {
          await mouse.move(point.x, point.y);
        }
        await mouse.up(action.button ? { button: action.button } : undefined);
        break;
      }
      case 'wait':
        await this.wait(action.ms ?? this.defaultWaitMs);
        break;
    }

    return { screenshot: await this.capture() };
  }

  async beginTakeover(_reason?: string): Promise<void> {
    this.suspended = true;
  }

  async endTakeover(): Promise<void> {
    this.suspended = false;
  }
}
