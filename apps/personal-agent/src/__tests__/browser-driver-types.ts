/** The part of a Playwright page the GUI tests use. */
export interface ILocator {
  fill(value: string): Promise<void>;
  count(): Promise<number>;
  click(): Promise<void>;
}

export interface IPage {
  goto(url: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  locator(selector: string): ILocator;
  content(): Promise<string>;
  url(): string;
  waitForFunction<T>(fn: (arg: T) => boolean, arg: T, options?: { timeout?: number }): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
}
