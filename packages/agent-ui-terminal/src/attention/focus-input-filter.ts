import { Readable } from 'node:stream';

/**
 * SCREEN-1992: the stdin proxy handed to Ink's `render({ stdin })`.
 *
 * Ink tokenizes `ESC [ I` as a keypress and every `useInput` listener would receive `[I`, so the
 * composer would type it. The proxy sits in front of the real stdin, strips the two focus sequences
 * while mode 1004 is negotiated, reports focus and keystrokes, and forwards every other byte
 * unchanged — including a split escape sequence and a bracketed paste, which are Ink's to parse.
 */
const ESC = 0x1b;
const FOCUS_IN = '\x1b[I';
const FOCUS_OUT = '\x1b[O';

export interface IFocusInputFilterResult {
  /** The bytes Ink receives, byte-identical to the input apart from the stripped focus sequences. */
  readonly forwarded: Buffer;
  readonly focusIn: number;
  readonly focusOut: number;
}

/** Pure: split one chunk into focus events and the bytes that remain. */
export function filterFocusSequences(chunk: Buffer, negotiated: boolean): IFocusInputFilterResult {
  if (!negotiated || !chunk.includes(ESC)) return { forwarded: chunk, focusIn: 0, focusOut: 0 };
  const text = chunk.toString('latin1');
  let focusIn = 0;
  let focusOut = 0;
  let forwarded = '';
  let index = 0;
  while (index < text.length) {
    if (text.startsWith(FOCUS_IN, index)) {
      focusIn += 1;
      index += FOCUS_IN.length;
    } else if (text.startsWith(FOCUS_OUT, index)) {
      focusOut += 1;
      index += FOCUS_OUT.length;
    } else {
      forwarded += text[index];
      index += 1;
    }
  }
  return { forwarded: Buffer.from(forwarded, 'latin1'), focusIn, focusOut };
}

export interface IFocusReportingStdinHooks {
  /** Whether mode 1004 is currently negotiated; read per chunk so a handoff can flip it. */
  readonly negotiated: () => boolean;
  readonly onFocusIn: () => void;
  readonly onFocusOut: () => void;
  /** Any byte that was not a focus sequence. */
  readonly onKeystroke: () => void;
}

type TStdinDataListener = (chunk: Buffer | string) => void;

/** What ink 7.1.1 reads from the stream it is given (`App.js` input handling, `ink.js` kitty probe). */
type TInkStdinSurface = Pick<
  Readable,
  'read' | 'setEncoding' | 'unshift' | 'on' | 'addListener' | 'removeListener'
> & {
  readonly isTTY: boolean;
  // `tty.ReadStream` types these as returning itself; Ink discards the return value.
  setRawMode(mode: boolean): TInkStdinSurface;
  ref(): TInkStdinSurface;
  unref(): TInkStdinSurface;
};

/** The subset of the real stdin the proxy touches (what `process.stdin` provides). */
export interface IFocusReportingStdinSource {
  readonly isTTY?: boolean;
  on(event: 'data', listener: TStdinDataListener): void;
  off(event: 'data', listener: TStdinDataListener): void;
  setRawMode?: (mode: boolean) => void;
  ref?: () => void;
  unref?: () => void;
}

export class FocusReportingStdin extends Readable {
  private readonly onData = (data: Buffer | string): void => {
    const chunk = typeof data === 'string' ? Buffer.from(data) : data;
    const result = filterFocusSequences(chunk, this.hooks.negotiated());
    for (let i = 0; i < result.focusOut; i += 1) this.hooks.onFocusOut();
    for (let i = 0; i < result.focusIn; i += 1) this.hooks.onFocusIn();
    if (result.forwarded.length === 0) return;
    this.hooks.onKeystroke();
    this.push(result.forwarded);
  };

  constructor(
    private readonly source: IFocusReportingStdinSource,
    private readonly hooks: IFocusReportingStdinHooks,
  ) {
    super({ read() {} });
    source.on('data', this.onData);
  }

  get isTTY(): boolean {
    return this.source.isTTY === true;
  }

  setRawMode(mode: boolean): this {
    this.source.setRawMode?.(mode);
    return this;
  }

  ref(): this {
    this.source.ref?.();
    return this;
  }

  unref(): this {
    this.source.unref?.();
    return this;
  }

  /**
   * Ink declares `stdin?: NodeJS.ReadStream` (a `tty.ReadStream`, which cannot be constructed
   * without an fd) but touches only the members named in `TInkStdinSurface` — verified against ink
   * 7.1.1's App and Ink classes. Assigning `this` to that surface is a typed check that every one of
   * them exists here; the final narrowing is from the surface Ink reads to the type it declares.
   */
  asInkStdin(): NodeJS.ReadStream {
    const surface: TInkStdinSurface = this;
    return surface as NodeJS.ReadStream;
  }

  /** Detach from the underlying stdin; the proxy emits nothing afterwards. */
  detach(): void {
    this.source.off('data', this.onData);
  }
}
