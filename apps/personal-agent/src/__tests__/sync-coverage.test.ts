/**
 * What a connector's sync reads over several runs, against a stand-in mail service that pages its
 * listing and a scripted model that does exactly what the run's own instructions say: it takes the
 * start, the order and the limit from the system prompt, pages through the listing, files one fact per
 * item and reports progress when it is told to. So these tests do not judge a model; they judge what
 * the host tells a run and what it takes from one: whether a backlog larger than one run, an item that
 * became visible late, a restart and a run that confirmed nothing leave something unread.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startHarness } from './harness.js';
import { offeredTools, toolResults } from './scripted-model.js';
import { startStandInConnector, virtualHostFetch } from './stand-in-connector.js';

import type { IHarness } from './harness.js';
import type { IModelRequest, TModelReply } from './scripted-model.js';
import type { IStandInConnector } from './stand-in-connector.js';

const MAIL_HOST = 'mail.stand-in.test';
const PAGE_SIZE = 10;
const MINUTE = 60_000;

interface IItem {
  readonly id: string;
  readonly receivedAt: string;
}

interface IListing {
  readonly after?: string;
  readonly order?: string;
  readonly cursor?: string;
}

/** The mailbox the stand-in service shows; a test adds to it between runs. */
interface IMailbox {
  readonly items: IItem[];
  /** Every listing a run asked for, in order. */
  readonly listings: IListing[];
}

const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** `count` items received one minute apart, the newest a minute before `now`. */
function backlog(count: number, now: number): IItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${String(index + 1).padStart(3, '0')}`,
    receivedAt: new Date(now - (count - index) * MINUTE).toISOString(),
  }));
}

async function startMail(items: readonly IItem[]): Promise<{
  readonly mail: IStandInConnector;
  readonly mailbox: IMailbox;
}> {
  const mailbox: IMailbox = { items: [...items], listings: [] };
  const mail = await startStandInConnector({
    access: 'open',
    publicBase: `https://${MAIL_HOST}`,
    tools: [
      {
        name: 'list_messages',
        description: 'List messages, a page at a time',
        annotations: { readOnlyHint: true },
        run: (args) => {
          const listing: IListing = {
            ...(typeof args['after'] === 'string' && { after: args['after'] }),
            ...(typeof args['order'] === 'string' && { order: args['order'] }),
            ...(typeof args['cursor'] === 'string' && { cursor: args['cursor'] }),
          };
          mailbox.listings.push(listing);
          const after = listing.after === undefined ? -Infinity : Date.parse(listing.after);
          const direction = listing.order === 'oldest' ? 1 : -1;
          const visible = mailbox.items
            .filter((item) => Date.parse(item.receivedAt) >= after)
            .sort(
              (a, b) =>
                direction * (Date.parse(a.receivedAt) - Date.parse(b.receivedAt)) ||
                a.id.localeCompare(b.id),
            );
          const offset = listing.cursor === undefined ? 0 : Number(listing.cursor);
          const next = offset + PAGE_SIZE;
          return JSON.stringify({
            messages: visible.slice(offset, next),
            ...(next < visible.length && { nextCursor: String(next) }),
          });
        },
      },
      {
        name: 'read_message',
        description: 'Read one message',
        annotations: { readOnlyHint: true },
        run: (args) => `message ${String(args['id'])}: nothing in it needs a question`,
      },
    ],
  });
  closers.push(mail.close);
  return { mail, mailbox };
}

interface IWorld {
  readonly harness: IHarness;
  readonly id: string;
  readonly stateDir: string;
}

async function connectedWorld(mail: IStandInConnector, stateDir?: string): Promise<IWorld> {
  const harness = await startHarness({
    ...(stateDir !== undefined && { stateDir }),
    connectorNetwork: {
      fetch: virtualHostFetch({ [MAIL_HOST]: mail.port }),
      lookup: async () => ['203.0.113.10'],
    },
  });
  closers.push(() => harness.close());
  const call = async (method: string, segments: string[], body?: unknown) => {
    const answer = await harness.capabilities.api({
      method,
      path: `/${segments.join('/')}`,
      segments,
      query: new URLSearchParams(),
      body,
    });
    return { status: answer.status, body: answer.body as any };
  };
  let id: string;
  const existing = (await call('GET', ['connectors'])).body.connectors as { id: string }[];
  if (existing.length > 0) id = existing[0]!.id;
  else {
    const made = await call('POST', ['connectors'], {
      title: 'Work mail',
      kind: 'mail',
      endpoint: `https://${MAIL_HOST}/mcp`,
      auth: 'none',
    });
    expect(made.status).toBe(200);
    id = made.body.connector.id as string;
    expect((await call('POST', ['connectors', id, 'sync'], { everyMinutes: 60 })).status).toBe(200);
  }
  return { harness, id, stateDir: harness.stateDir };
}

interface IBehavior {
  /** Report progress when the run names the tool; a model that ends without it confirms nothing. */
  readonly confirm?: boolean;
  /** Break off before the next step once this many facts were filed in a run. */
  readonly cutAfterFiled?: number;
}

interface IRunState {
  from: number;
  order: 'oldest' | 'newest';
  limit: number;
  progressNamed: boolean;
  skipsFiled: boolean;
  listed: boolean;
  queue: IItem[];
  cursor: string | undefined;
  handled: number;
  filed: number;
  through: string | undefined;
  reported: boolean;
  current: IItem | undefined;
  stage: 'list' | 'read' | 'keep' | 'progress' | undefined;
}

/**
 * A model that follows the run's instructions to the letter. What it knows about the run it reads
 * from the system prompt; what it knows about the library it reads from the library, as a model that
 * searched it would.
 */
function obedient(
  world: IWorld,
  behavior: IBehavior = {},
): (request: IModelRequest) => Promise<TModelReply> {
  let run: IRunState | undefined;
  const begin = (system: string): IRunState => {
    const start = /(?:ran at|received from) (\d{4}-\d\d-\d\dT[\d:.]+Z)/u.exec(system)?.[1];
    return {
      from: start === undefined ? Date.now() - 7 * 24 * 60 * MINUTE : Date.parse(start),
      order: /\boldest first\b/u.test(system) ? 'oldest' : 'newest',
      limit: Number(/no more than about (\d+) items/u.exec(system)?.[1] ?? '20'),
      progressNamed: system.includes('ConnectorSyncProgress'),
      skipsFiled: /already have a kept fact/u.test(system),
      listed: false,
      queue: [],
      cursor: undefined,
      handled: 0,
      filed: 0,
      through: undefined,
      reported: false,
      current: undefined,
      stage: undefined,
    };
  };
  const isFiled = async (id: string): Promise<boolean> =>
    (await world.harness.capabilities.wiki.list()).some((page) =>
      page.claims.some(
        (claim) =>
          claim.validTo === undefined && claim.source.reference === `connector:${world.id} ${id}`,
      ),
    );
  const listing = (state: IRunState, cursor?: string): TModelReply => {
    state.stage = 'list';
    return {
      tool: 'ConnectorRead',
      args: {
        connector: world.id,
        tool: 'list_messages',
        argumentsJson: JSON.stringify({
          after: new Date(state.from).toISOString(),
          order: state.order,
          ...(cursor !== undefined && { cursor }),
        }),
      },
    };
  };
  const absorb = (state: IRunState, result: string): void => {
    if (state.stage === 'list') {
      const page = JSON.parse(result.slice(result.indexOf('\n') + 1)) as {
        messages: IItem[];
        nextCursor?: string;
      };
      state.queue = page.messages;
      state.cursor = page.nextCursor;
    } else if (state.stage === 'keep') {
      state.handled += 1;
      state.filed += 1;
      state.through = state.current!.receivedAt;
    }
    state.stage = undefined;
  };
  return async (request) => {
    if (!offeredTools(request).includes('ConnectorRead')) return { text: 'OK' };
    const results = toolResults(request);
    if (results.length === 0 || run === undefined) {
      run = begin(
        String(request.messages.find((message) => message.role === 'system')?.content ?? ''),
      );
    } else if (run.stage === 'read') {
      run.stage = 'keep';
      const item = run.current!;
      return {
        tool: 'ConnectorKeep',
        args: {
          connector: world.id,
          page: `Mail ${item.id}`,
          claim: `Message ${item.id} arrived at ${item.receivedAt}.`,
          reference: item.id,
        },
      };
    } else absorb(run, results.at(-1) ?? '');
    const state = run;
    if (behavior.cutAfterFiled !== undefined && state.filed >= behavior.cutAfterFiled) {
      return { cut: true };
    }
    if (!state.listed) {
      state.listed = true;
      return listing(state);
    }
    while (state.handled < state.limit && state.queue.length > 0) {
      const item = state.queue.shift()!;
      if (await isFiled(item.id)) {
        state.through = item.receivedAt;
        if (!state.skipsFiled) state.handled += 1;
        continue;
      }
      state.current = item;
      state.stage = 'read';
      return {
        tool: 'ConnectorRead',
        args: {
          connector: world.id,
          tool: 'read_message',
          argumentsJson: JSON.stringify({ id: item.id }),
        },
      };
    }
    if (state.handled < state.limit && state.cursor !== undefined) {
      return listing(state, state.cursor);
    }
    if (state.progressNamed && behavior.confirm !== false && !state.reported) {
      state.reported = true;
      state.stage = 'progress';
      return {
        tool: 'ConnectorSyncProgress',
        args: {
          connector: world.id,
          ...(state.through !== undefined && { through: state.through }),
          complete: state.handled < state.limit && state.cursor === undefined,
        },
      };
    }
    return { text: 'Done.' };
  };
}

/** Run the sync goal once, as the runner does when it is due, and wait until it has ended. */
async function sync(
  world: IWorld,
): Promise<{ readonly startedAt: string; readonly outcome: string }> {
  const { goals } = world.harness.capabilities;
  const goal = (await goals.list()).find((candidate) => candidate.connectorId === world.id)!;
  await goals.resume(goal.id);
  const runner = world.harness.capabilities.runner()!;
  await runner.runDue();
  await runner.settled();
  const [latest] = await goals.runs(goal.id, 1);
  return { startedAt: latest!.startedAt, outcome: latest!.outcome ?? 'running' };
}

async function filedIds(world: IWorld): Promise<string[]> {
  const prefix = `connector:${world.id} `;
  return (await world.harness.capabilities.wiki.list())
    .flatMap((page) => page.claims)
    .flatMap((claim) => {
      const reference = claim.source.reference;
      return reference?.startsWith(prefix) === true ? [reference.slice(prefix.length)] : [];
    })
    .sort();
}

/** The `after` each run began its reading with: the first listing without a cursor of each run. */
const starts = (mailbox: IMailbox): (string | undefined)[] =>
  mailbox.listings.filter((entry) => entry.cursor === undefined).map((entry) => entry.after);

describe('what a connector sync reads over several runs', () => {
  it('reaches every item of a backlog larger than one run, a page at a time', async () => {
    const items = backlog(45, Date.now());
    const { mail, mailbox } = await startMail(items);
    const world = await connectedWorld(mail);
    world.harness.model.script(obedient(world));

    for (let run = 0; run < 5; run += 1) {
      expect((await sync(world)).outcome).toBe('done');
    }

    expect(await filedIds(world)).toEqual(items.map((item) => item.id));
    expect(mailbox.listings.some((entry) => entry.cursor !== undefined)).toBe(true);
  });

  it('picks up an item that became visible after the run that passed its receipt time', async () => {
    const items = backlog(3, Date.now());
    const { mail, mailbox } = await startMail(items);
    const world = await connectedWorld(mail);
    world.harness.model.script(obedient(world));

    const first = await sync(world);
    expect(await filedIds(world)).toEqual(items.map((item) => item.id));

    // The service shows it only now, although it was received two minutes before that run began.
    const late: IItem = {
      id: 'msg-late',
      receivedAt: new Date(Date.parse(first.startedAt) - 2 * MINUTE).toISOString(),
    };
    mailbox.items.push(late);
    expect((await sync(world)).outcome).toBe('done');

    expect(await filedIds(world)).toContain(late.id);
  });

  it('carries on from the same point after a restart', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'sync-coverage-'));
    directories.push(stateDir);
    const items = backlog(45, Date.now());
    const { mail, mailbox } = await startMail(items);
    const before = await connectedWorld(mail, stateDir);
    before.harness.model.script(obedient(before));
    await sync(before);
    const firstRunFiled = (await filedIds(before)).length;
    expect(firstRunFiled).toBeGreaterThan(0);
    expect(firstRunFiled).toBeLessThan(items.length);
    await before.harness.close();
    closers.length = 0;
    closers.push(mail.close);

    const after = await connectedWorld(mail, stateDir);
    after.harness.model.script(obedient(after));
    for (let run = 0; run < 4; run += 1) await sync(after);

    expect(await filedIds(after)).toEqual(items.map((item) => item.id));
  });

  /** A mailbox one run has covered, then eight messages that arrive after it. */
  async function coveredThenFresh() {
    const { mail, mailbox } = await startMail(backlog(3, Date.now()));
    const world = await connectedWorld(mail);
    world.harness.model.script(obedient(world));
    await sync(world);
    mailbox.items.push(
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `msg-fresh-${index + 1}`,
        receivedAt: new Date().toISOString(),
      })),
    );
    return { world, mailbox };
  }

  it('does not move past what an interrupted run did not confirm', async () => {
    const { world, mailbox } = await coveredThenFresh();

    // The next run files some of them and is cut off before it reports anything.
    world.harness.model.script(obedient(world, { cutAfterFiled: 5 }));
    expect((await sync(world)).outcome).toBe('failed');
    expect((await filedIds(world)).length).toBeLessThan(11);

    world.harness.model.script(obedient(world));
    await sync(world);
    const [, interrupted, resumed] = starts(mailbox);
    expect(resumed).toBe(interrupted);
    expect(await filedIds(world)).toHaveLength(11);
  });

  it('does not move for a done run that confirms nothing', async () => {
    const { world, mailbox } = await coveredThenFresh();

    world.harness.model.script(obedient(world, { confirm: false }));
    expect((await sync(world)).outcome).toBe('done');

    world.harness.model.script(obedient(world));
    await sync(world);
    const [, silent, next] = starts(mailbox);
    expect(next).toBe(silent);
  });
});
