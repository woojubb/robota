/**
 * Minimal VT interpreter for cursor-positioning assertions (CLI-062).
 *
 * Tracks the hardware cursor row/col on a rows x cols screen while consuming a raw ANSI stream,
 * recording every DECTCEM show (`ESC[?25h`) event with the cursor cell it lands on and its byte
 * offset in the stream. This is the same evidence a terminal emulator (and the OS IME) acts on —
 * ported from the CLI-062 investigation PoC (.design/investigations/2026-07-25-cli-062-ime-cursor-design.md).
 *
 * Screen bookkeeping treats every printable as width 1 (wide-char display-column math is exercised
 * by the production x computation, which the recorded `cursorTo` columns reflect directly).
 * Understands: CR, LF, CUU/CUD/CUF/CUB (A/B/C/D), CNL/CPL (E/F), CHA (G), CUP (H/f), EL (K),
 * ED (J, state-only), DECSET/DECRST ?25 (show/hide), OSC strings, and skips other escapes.
 */

// eslint-disable-next-line no-control-regex -- a VT interpreter parses control bytes by definition
const CSI_PATTERN = /^\u001b\[([0-9;?]*)([A-Za-z])/;
// eslint-disable-next-line no-control-regex -- a VT interpreter parses control bytes by definition
const OSC_PATTERN = /^\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/;

export interface ICursorShowEvent {
  /** Screen row (0-based) the cursor was on when it was shown. */
  row: number;
  /** Screen column (0-based) the cursor was on when it was shown. */
  col: number;
  /** Byte offset of the show sequence in the interpreted stream (for since-mark filtering). */
  offset: number;
}

export interface IVtInterpretation {
  /** Final cursor row. */
  row: number;
  /** Final cursor column. */
  col: number;
  /** Final DECTCEM visibility. */
  visible: boolean;
  /** Screen contents (width-1 bookkeeping per printable). */
  screen: string[];
  /** Every `ESC[?25h` with the cell it landed on. */
  showEvents: ICursorShowEvent[];
  /** Number of scroll-ups that occurred (content pushed past the bottom row). */
  scrolls: number;
}

interface IVtState {
  row: number;
  col: number;
  visible: boolean;
  screen: string[][];
  scrolls: number;
  showEvents: ICursorShowEvent[];
}

export function interpretVtStream(stream: string, rows: number, cols: number): IVtInterpretation {
  const state: IVtState = {
    row: 0,
    col: 0,
    visible: true,
    screen: Array.from({ length: rows }, () => Array<string>(cols).fill(' ')),
    scrolls: 0,
    showEvents: [],
  };

  let i = 0;
  while (i < stream.length) {
    const ch = stream[i]!;
    if (ch === '\r') {
      state.col = 0;
      i++;
    } else if (ch === '\n') {
      lineFeed(state, rows, cols);
      state.col = 0;
      i++;
    } else if (ch === '\u001b') {
      i += consumeEscape(state, stream, i, rows, cols);
    } else {
      if (ch >= ' ') {
        state.screen[state.row]![state.col] = ch;
        state.col = Math.min(cols - 1, state.col + 1);
      }
      i++;
    }
  }

  return {
    row: state.row,
    col: state.col,
    visible: state.visible,
    screen: state.screen.map((line) => line.join('')),
    showEvents: state.showEvents,
    scrolls: state.scrolls,
  };
}

function lineFeed(state: IVtState, rows: number, cols: number): void {
  if (state.row === rows - 1) {
    state.screen.shift();
    state.screen.push(Array<string>(cols).fill(' '));
    state.scrolls++;
  } else {
    state.row++;
  }
}

/** Consume one escape sequence at `start`; returns its length in the stream. */
function consumeEscape(
  state: IVtState,
  stream: string,
  start: number,
  rows: number,
  cols: number,
): number {
  const csi = CSI_PATTERN.exec(stream.slice(start));
  if (csi) {
    const [full, params = '', cmd = ''] = csi;
    applyCsi(state, params, cmd, start, rows, cols);
    return full.length;
  }
  const osc = OSC_PATTERN.exec(stream.slice(start));
  if (osc) {
    return osc[0].length;
  }
  return 2;
}

function applyCsi(
  state: IVtState,
  params: string,
  cmd: string,
  offset: number,
  rows: number,
  cols: number,
): void {
  if (applyCursorMove(state, params, cmd, rows, cols)) return;
  if (cmd === 'K') {
    const from = params === '1' ? 0 : state.col;
    const to = params === '1' ? state.col + 1 : cols;
    for (let c = from; c < to; c++) state.screen[state.row]![c] = ' ';
  } else if (cmd === 'h' && params === '?25') {
    state.visible = true;
    state.showEvents.push({ row: state.row, col: state.col, offset });
  } else if (cmd === 'l' && params === '?25') {
    state.visible = false;
  }
}

/** Cursor-movement CSI commands; returns true when the command was one of them. */
function applyCursorMove(
  state: IVtState,
  params: string,
  cmd: string,
  rows: number,
  cols: number,
): boolean {
  const n = Number.parseInt(params === '' ? '1' : params, 10) || 1;
  if (cmd === 'A') state.row = Math.max(0, state.row - n);
  else if (cmd === 'B') state.row = Math.min(rows - 1, state.row + n);
  else if (cmd === 'C') state.col = Math.min(cols - 1, state.col + n);
  else if (cmd === 'D') state.col = Math.max(0, state.col - n);
  else if (cmd === 'E') {
    for (let k = 0; k < n; k++) lineFeed(state, rows, cols);
    state.col = 0;
  } else if (cmd === 'F') {
    state.row = Math.max(0, state.row - n);
    state.col = 0;
  } else if (cmd === 'G') {
    state.col = Math.min(cols - 1, n - 1);
  } else if (cmd === 'H' || cmd === 'f') {
    const [r = '1', c = '1'] = params.split(';');
    state.row = Math.min(rows - 1, (Number.parseInt(r, 10) || 1) - 1);
    state.col = Math.min(cols - 1, (Number.parseInt(c, 10) || 1) - 1);
  } else {
    return false;
  }
  return true;
}
