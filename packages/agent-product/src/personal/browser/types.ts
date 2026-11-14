/**
 * The browser a personal agent acts through, as a port a host implements.
 *
 * The agent sees a page as its visible text plus numbered marks on the elements it can act on, and
 * acts by mark: grounding actions to page elements rather than raw pixels is what makes web agents
 * reliable, and a number is something the model can name exactly. When the agent's own action makes a
 * request that writes to a site (a form submission, or any method but GET, HEAD and OPTIONS), the host
 * holds it and reports it, and only a separate submission that names its method and address, approved
 * by a person, sends it.
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
  /** Present when the action made requests that write; they were held, not sent. */
  readonly held?: readonly IHeldSubmission[];
}

export interface IBrowserPort {
  open(url: string): Promise<IBrowserView>;
  view(): Promise<IBrowserView>;
  click(mark: number): Promise<IBrowserActionResult>;
  type(mark: number, text: string, pressEnter?: boolean): Promise<IBrowserActionResult>;
  /**
   * Send one submission the last action held, exactly as it was made. The method and address must
   * match it, so what a person approved is what goes out.
   */
  submitHeld(
    id: string,
    expected: { readonly method: string; readonly url: string },
  ): Promise<IBrowserActionResult>;
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
