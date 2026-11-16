/**
 * The person's own notification address: one `https` address the agent sends each notification to, such
 * as the topic address of a push-to-phone service or the incoming address of a team chat.
 *
 * The address is the person's alone. It usually carries a token, so it is kept like a credential: in an
 * owner-only file of its own, never in a record, an answer, a log or an error. What anything outside this
 * module can learn of it is whether one is set, its host and the message format. No tool, no mail and no
 * text the agent reads reaches it; it is only ever the destination of the person's own notifications.
 * Whether a destination may be reached is the host's outbound-request policy, asked when the address is
 * saved and again by the request that sends, because a name can resolve differently later. A message is
 * sent once and a redirect is never followed, so what is sent goes to the address the person gave and
 * nowhere else. Anything but a 2xx answer means the address did not take it.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { DeliveryRefusedError } from './policy.js';

import type { IDeliveryMessage, IDeliverySink } from './types.js';

export const WEBHOOK_FORMATS = ['plain', 'json'] as const;
export type TWebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/** The address as kept, and how a message is written to it. */
export interface IWebhookTarget {
  readonly url: string;
  readonly format: TWebhookFormat;
}

/** Where the address lives between runs; a host supplies one. Only this module reads it. */
export interface IWebhookStore {
  read(): Promise<IWebhookTarget | undefined>;
  write(value: IWebhookTarget): Promise<void>;
  clear(): Promise<void>;
}

export interface IWebhookRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** The whole exchange, answer included, is given up after this long. */
  readonly timeoutMs: number;
}

/** The status of the answer, or why the destination was not reached; the words name no address. */
export type TWebhookAnswer = { readonly status: number } | { readonly refused: string };

/** What the host lends for the network: its outbound-request policy and its way to send. */
export interface IWebhookTransport {
  /** Why this destination may not be reached, or `undefined` when it may. Words name no address. */
  admit(url: URL): Promise<string | undefined>;
  /**
   * One request to the address, which is judged by the same policy again, with no redirect followed. It
   * throws when the destination cannot be reached or does not answer in time.
   */
  post(request: IWebhookRequest): Promise<TWebhookAnswer>;
}

/** What the person is told about the address: never the address itself. */
export interface INotificationAddressView {
  readonly configured: boolean;
  /** The host (and port) the notifications go to; present only when one is set. */
  readonly host?: string;
  readonly format: TWebhookFormat;
}

const ADDRESS_LIMIT = 2048;
const BODY_LIMIT = 4000;
const TITLE_LIMIT = 100;
const WEBHOOK_TIMEOUT_MS = 10_000;
const FILE = 'webhook.json';
const TEST_MESSAGE: IDeliveryMessage = {
  kind: 'test',
  title: 'Test',
  text: 'Test from your agent',
};

export function createMemoryWebhookStore(initial?: IWebhookTarget): IWebhookStore {
  let held = initial;
  return {
    read: async () => held,
    write: async (value) => {
      held = value;
    },
    clear: async () => {
      held = undefined;
    },
  };
}

/** The address as stored, or `undefined` when the file is not what this module writes. */
function targetOf(raw: unknown): IWebhookTarget | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { url, format } = raw as Record<string, unknown>;
  if (typeof url !== 'string' || !URL.canParse(url)) return undefined;
  if (!WEBHOOK_FORMATS.includes(format as TWebhookFormat)) return undefined;
  return { url, format: format as TWebhookFormat };
}

/**
 * The address in an owner-only file of its own, in an owner-only directory, written atomically. A file
 * that cannot be read as an address means no address: nothing is sent until the person sets one again.
 */
export function createFileWebhookStore(directory: string): IWebhookStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // A directory that already existed keeps no looser mode than the one asked for.
  chmodSync(directory, 0o700);
  const path = join(directory, FILE);
  return {
    read: async () => {
      try {
        return existsSync(path)
          ? targetOf(JSON.parse(readFileSync(path, 'utf8')) as unknown)
          : undefined;
      } catch {
        // allow-fallback: a file that cannot be read means no address, so nothing is sent.
        return undefined;
      }
    },
    write: async (value) => {
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    },
    clear: async () => rmSync(path, { force: true }),
  };
}

/**
 * The address a person typed, as a URL to judge, or a refusal in plain words that never repeats it. A
 * secret-looking value inside the address is expected and is no reason to refuse it.
 */
export function parseNotificationAddress(value: unknown): URL {
  if (typeof value !== 'string' || value.trim() === '')
    throw new DeliveryRefusedError('The notification address must be a web address');
  const text = value.trim();
  if (text.length > ADDRESS_LIMIT)
    throw new DeliveryRefusedError(
      `The notification address must be at most ${ADDRESS_LIMIT} characters`,
    );
  if (!URL.canParse(text))
    throw new DeliveryRefusedError('The notification address is not a valid web address');
  const url = new URL(text);
  if (url.protocol !== 'https:')
    throw new DeliveryRefusedError('The notification address must start with https://');
  if (url.username !== '' || url.password !== '')
    throw new DeliveryRefusedError(
      'The notification address must not hold a user name or password; a token belongs in the path or the query',
    );
  return url;
}

/** One line of printable ASCII, so it is safe as a header value whatever the receiver decodes. */
function headerTitle(title: string): string {
  const line = title
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/gu, '?')
    .trim();
  if (line === '') return 'Personal agent';
  return line.length <= TITLE_LIMIT ? line : `${line.slice(0, TITLE_LIMIT - 3).trimEnd()}...`;
}

function boundedText(text: string): string {
  const points = [...text];
  return points.length <= BODY_LIMIT ? text : `${points.slice(0, BODY_LIMIT - 3).join('')}...`;
}

/** How one message is written to the address: the headers and the body. */
export function webhookMessage(
  message: IDeliveryMessage,
  format: TWebhookFormat,
): { readonly headers: Record<string, string>; readonly body: string } {
  const text = boundedText(message.text);
  if (format === 'json')
    return {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, title: message.title }),
    };
  return {
    headers: { 'content-type': 'text/plain; charset=utf-8', title: headerTitle(message.title) },
    body: text,
  };
}

export interface INotificationAddressOptions {
  readonly store: IWebhookStore;
  readonly transport: IWebhookTransport;
}

export class NotificationAddress {
  private readonly options: INotificationAddressOptions;
  /** Takes a message to the address, once. It throws when the address did not take it. */
  readonly sink: IDeliverySink;

  constructor(options: INotificationAddressOptions) {
    this.options = options;
    this.sink = { id: 'notification-address', deliver: (message) => this.send(message) };
  }

  /** Whether an address is set, which is when its sink is worth offering a message. */
  async configured(): Promise<boolean> {
    return (await this.options.store.read()) !== undefined;
  }

  async view(): Promise<INotificationAddressView> {
    const target = await this.options.store.read();
    return target === undefined
      ? { configured: false, format: 'plain' }
      : { configured: true, host: new URL(target.url).host, format: target.format };
  }

  /**
   * Keep the address the person gave, in place of any earlier one. `format` is `plain` when left out. It
   * is refused whole, in words that never repeat the address, when it is not an `https` address without
   * a user name or when the outbound-request policy does not allow its destination.
   */
  async set(change: unknown): Promise<INotificationAddressView> {
    if (typeof change !== 'object' || change === null || Array.isArray(change))
      throw new DeliveryRefusedError('The change must be an object');
    const body = change as Record<string, unknown>;
    for (const key of Object.keys(body))
      if (key !== 'url' && key !== 'format')
        throw new DeliveryRefusedError(`The notification address has no setting named ${key}`);
    const url = parseNotificationAddress(body['url']);
    const format = body['format'] ?? 'plain';
    if (!WEBHOOK_FORMATS.includes(format as TWebhookFormat))
      throw new DeliveryRefusedError(`The format must be one of ${WEBHOOK_FORMATS.join(', ')}`);
    const refusal = await this.options.transport.admit(url);
    if (refusal !== undefined)
      throw new DeliveryRefusedError(
        `The notification address (${url.host}) cannot be used: ${refusal}`,
      );
    await this.options.store.write({ url: url.href, format: format as TWebhookFormat });
    return this.view();
  }

  /** Forget the address: nothing is sent to it again. */
  async clear(): Promise<INotificationAddressView> {
    await this.options.store.clear();
    return this.view();
  }

  /** Send the fixed test message to the address alone, and say in words that name no address if it did not take it. */
  test(): Promise<void> {
    return this.send(TEST_MESSAGE);
  }

  private async send(message: IDeliveryMessage): Promise<void> {
    const target = await this.options.store.read();
    if (target === undefined) throw new DeliveryRefusedError('No notification address is set');
    const host = new URL(target.url).host;
    const { headers, body } = webhookMessage(message, target.format);
    let answer: TWebhookAnswer;
    try {
      answer = await this.options.transport.post({
        url: target.url,
        headers,
        body,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      });
    } catch {
      // The cause of a failed request can name the address; the person is told the host and that it failed.
      throw new DeliveryRefusedError(
        `The notification address (${host}) could not be reached or did not answer in time`,
      );
    }
    if ('refused' in answer)
      throw new DeliveryRefusedError(
        `The notification address (${host}) cannot be used: ${answer.refused}`,
      );
    if (answer.status < 200 || answer.status > 299)
      throw new DeliveryRefusedError(
        `The notification address (${host}) answered with status ${answer.status}`,
      );
  }
}
