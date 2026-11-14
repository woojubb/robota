/**
 * The browser a personal agent acts through, as a port a host implements.
 *
 * The agent sees a page as its visible text plus numbered marks on the elements it can act on, and
 * acts by mark: grounding actions to page elements rather than raw pixels is what makes web agents
 * reliable, and a number is something the model can name exactly. Reading and typing stay inside the
 * agent's own browser; the moment data would leave for a site (a form submission or any other
 * request that writes), the host holds the request and reports it, and only a separate, explicitly
 * approved submission sends it.
 */

export interface IBrowserMark {
  readonly mark: number;
  /** The element's role: link, button, textbox, checkbox, combobox, and so on. */
  readonly role: string;
  /** Its accessible name or visible label, possibly empty. */
  readonly name: string;
}

export interface IBrowserView {
  readonly url: string;
  readonly title: string;
  /** Visible text, bounded by the host. */
  readonly text: string;
  readonly marks: readonly IBrowserMark[];
}

/** A request that would have sent data to a site, held until a person approves it. */
export interface IHeldSubmission {
  readonly id: string;
  readonly method: string;
  readonly url: string;
  /** Field names (never values) that the request carried, when they could be read. */
  readonly fields: readonly string[];
}

export interface IBrowserActionResult {
  readonly view: IBrowserView;
  /** Present when the action tried to send data and was held. */
  readonly held?: IHeldSubmission;
}

export interface IBrowserPort {
  open(url: string): Promise<IBrowserView>;
  view(): Promise<IBrowserView>;
  click(mark: number): Promise<IBrowserActionResult>;
  type(mark: number, text: string, pressEnter?: boolean): Promise<IBrowserActionResult>;
  /** Replay the action that produced a held submission, letting that one request through. */
  submitHeld(id: string): Promise<IBrowserActionResult>;
  close(): Promise<void>;
}

export class BrowserUnavailableError extends Error {
  constructor(reason: string) {
    super(`The browser is not available: ${reason}`);
    this.name = 'BrowserUnavailableError';
  }
}

export class BrowserNavigationRefusedError extends Error {
  constructor(url: string, reason: string) {
    super(`Refused to open ${url}: ${reason}`);
    this.name = 'BrowserNavigationRefusedError';
  }
}
