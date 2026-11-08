/**
 * SELFHOST-010: deterministic scripted computer-use driver for functional tests.
 *
 * Test-support ONLY — placed under the `./testing` subpath (mirroring agent-core's `scripted-provider`) so
 * it is never shipped in the package main entry and is not a "fake" in production code. It records every
 * issued action and returns caller-provided/scripted screenshots, driving the `ComputerView`/`Computer`
 * factory through the REAL `IComputerDriver` port with no browser.
 *
 * It also implements the takeover contract faithfully: after a `takeover` action the driver enters a
 * SUSPENDED state — perception is paused (`screenshot()` returns `undefined`) and every further action is
 * held (no screenshot, `takeover: true`) — until `endTakeover()` signals resume. This lets a functional
 * test assert the halt-for-user loop-suspension + perception-pause without a real window.
 */

import type {
  IComputerActionResult,
  IComputerDriver,
  IComputerScreenshot,
  TComputerAction,
} from '../types.js';

export interface IScriptedComputerDriverOptions {
  /**
   * Screenshots returned in order, one per perceive/act call that captures. When the script is exhausted
   * the last screenshot is repeated; when empty, a deterministic placeholder is synthesized.
   */
  screenshots?: readonly IComputerScreenshot[];
}

/** Synthesize a deterministic placeholder screenshot so a driver with no script still perceives. */
function placeholderScreenshot(sequence: number): IComputerScreenshot {
  return {
    data: `scripted-screenshot-${sequence}`,
    mediaType: 'image/png',
    width: 1,
    height: 1,
  };
}

export class ScriptedComputerDriver implements IComputerDriver {
  /** Every action issued to the driver, in order — for assertions. */
  readonly actions: TComputerAction[] = [];
  /** Count of perceive (`screenshot()`) calls, in order — for assertions. */
  screenshotCalls = 0;
  /** True while a takeover suspends the action loop and pauses perception. */
  private suspended = false;

  private readonly screenshots: readonly IComputerScreenshot[];
  private captureSequence = 0;

  constructor(options: IScriptedComputerDriverOptions = {}) {
    this.screenshots = options.screenshots ?? [];
  }

  /** Return the next scripted screenshot (repeating the last / synthesizing a placeholder). */
  private nextScreenshot(): IComputerScreenshot {
    if (this.screenshots.length === 0) {
      return placeholderScreenshot(this.captureSequence++);
    }
    const index = Math.min(this.captureSequence, this.screenshots.length - 1);
    this.captureSequence += 1;
    return this.screenshots[index] as IComputerScreenshot;
  }

  async screenshot(): Promise<IComputerScreenshot | undefined> {
    this.screenshotCalls += 1;
    // Perception is paused during a takeover so no screenshot captures the human's secret.
    if (this.suspended) {
      return undefined;
    }
    return this.nextScreenshot();
  }

  async act(action: TComputerAction): Promise<IComputerActionResult> {
    this.actions.push(action);

    if (action.type === 'takeover') {
      this.suspended = true;
      return { takeover: true };
    }

    // While suspended, the action loop is halted — no action is executed and none captures a screenshot.
    if (this.suspended) {
      return { takeover: true };
    }

    return { screenshot: this.nextScreenshot() };
  }

  async beginTakeover(): Promise<void> {
    this.suspended = true;
  }

  async endTakeover(): Promise<void> {
    this.suspended = false;
  }

  /** True while a takeover suspends the action loop — for assertions. */
  isSuspended(): boolean {
    return this.suspended;
  }
}
