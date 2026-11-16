import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CaseBook,
  DEFAULT_DELIVERY_SETTINGS,
  DeliveryRefusedError,
  GoalBook,
  QuestionDelivery,
  createFileDeliveryStores,
  createMemoryCaseStore,
  createMemoryDeliveryStore,
  createMemoryGoalStore,
  decideDelivery,
} from '../index.js';
import { applySettingsChange } from '../delivery/policy.js';

import type {
  IDeliveryMessage,
  IDeliverySettings,
  IDeliverySink,
  IDeliveryState,
  IDeliveryStore,
  TCaseUrgency,
  TDelivery,
} from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-'));
  dirs.push(dir);
  return dir;
}

/** A local time on the sixteenth of November, or on `day`: the machine's own clock is what delivery reads. */
const at = (hours: number, minutes = 0, day = 16): Date => new Date(2026, 10, day, hours, minutes);

const withSettings = (change: unknown): IDeliverySettings =>
  applySettingsChange(DEFAULT_DELIVERY_SETTINGS, change);

describe('what becomes of a question', () => {
  const NOON = at(12);
  const cases: readonly [string, TCaseUrgency, Date, IDeliverySettings, number, TDelivery][] = [
    ['feed stays in the feed', 'feed', NOON, DEFAULT_DELIVERY_SETTINGS, 0, 'feed'],
    ['feed stays in the feed in quiet hours', 'feed', at(23), DEFAULT_DELIVERY_SETTINGS, 0, 'feed'],
    [
      'feed stays in the feed with no digest',
      'feed',
      NOON,
      withSettings({ digest: { enabled: false } }),
      0,
      'feed',
    ],
    ['digest waits for the summary', 'digest', NOON, DEFAULT_DELIVERY_SETTINGS, 0, 'digest'],
    [
      'digest waits for the summary in quiet hours',
      'digest',
      at(23),
      DEFAULT_DELIVERY_SETTINGS,
      9,
      'digest',
    ],
    [
      'digest stays in the feed when the summary is off',
      'digest',
      NOON,
      withSettings({ digest: { enabled: false } }),
      0,
      'feed',
    ],
    ['now is pushed', 'now', NOON, DEFAULT_DELIVERY_SETTINGS, 0, 'notify'],
    ['now is pushed below the limit', 'now', NOON, DEFAULT_DELIVERY_SETTINGS, 2, 'notify'],
    ['now waits once the limit is reached', 'now', NOON, DEFAULT_DELIVERY_SETTINGS, 3, 'digest'],
    ['now waits beyond the limit', 'now', NOON, DEFAULT_DELIVERY_SETTINGS, 8, 'digest'],
    [
      'now stays in the feed at the limit with no summary',
      'now',
      NOON,
      withSettings({ digest: { enabled: false } }),
      3,
      'feed',
    ],
    ['a limit of 0 pushes nothing', 'now', NOON, withSettings({ dailyLimit: 0 }), 0, 'digest'],
    [
      'a limit of 0 and no summary leaves it in the feed',
      'now',
      NOON,
      withSettings({ dailyLimit: 0, digest: { enabled: false } }),
      0,
      'feed',
    ],
    [
      'the largest limit still pushes the twentieth',
      'now',
      NOON,
      withSettings({ dailyLimit: 20 }),
      19,
      'notify',
    ],
    [
      'the largest limit stops at twenty',
      'now',
      NOON,
      withSettings({ dailyLimit: 20 }),
      20,
      'digest',
    ],
    [
      'one minute before quiet hours begin',
      'now',
      at(21, 59),
      DEFAULT_DELIVERY_SETTINGS,
      0,
      'notify',
    ],
    ['exactly when quiet hours begin', 'now', at(22, 0), DEFAULT_DELIVERY_SETTINGS, 0, 'digest'],
    ['late in quiet hours', 'now', at(23, 59), DEFAULT_DELIVERY_SETTINGS, 0, 'digest'],
    [
      'at midnight, inside a window that crosses it',
      'now',
      at(0, 0),
      DEFAULT_DELIVERY_SETTINGS,
      0,
      'digest',
    ],
    ['one minute before quiet hours end', 'now', at(7, 59), DEFAULT_DELIVERY_SETTINGS, 0, 'digest'],
    ['exactly when quiet hours end', 'now', at(8, 0), DEFAULT_DELIVERY_SETTINGS, 0, 'notify'],
    [
      'quiet hours in quiet hours with no summary',
      'now',
      at(23),
      withSettings({ digest: { enabled: false } }),
      0,
      'feed',
    ],
    [
      'quiet hours turned off',
      'now',
      at(23),
      withSettings({ quietHours: { enabled: false } }),
      0,
      'notify',
    ],
    [
      'a window inside one day: before it',
      'now',
      at(12, 59),
      withSettings({ quietHours: { from: '13:00', to: '15:00' } }),
      0,
      'notify',
    ],
    [
      'a window inside one day: its start',
      'now',
      at(13, 0),
      withSettings({ quietHours: { from: '13:00', to: '15:00' } }),
      0,
      'digest',
    ],
    [
      'a window inside one day: its last minute',
      'now',
      at(14, 59),
      withSettings({ quietHours: { from: '13:00', to: '15:00' } }),
      0,
      'digest',
    ],
    [
      'a window inside one day: its end',
      'now',
      at(15, 0),
      withSettings({ quietHours: { from: '13:00', to: '15:00' } }),
      0,
      'notify',
    ],
    [
      'a window inside one day does not cover the night',
      'now',
      at(23),
      withSettings({ quietHours: { from: '13:00', to: '15:00' } }),
      0,
      'notify',
    ],
  ];

  it.each(cases)('%s', (_name, urgency, now, settings, sentToday, expected) => {
    expect(decideDelivery({ urgency, now, settings, sentToday })).toBe(expected);
  });

  it('takes the person’s limits to the letter: seconds do not move a boundary', () => {
    const just = (seconds: number) => new Date(2026, 10, 16, 21, 59, seconds);
    expect(
      decideDelivery({
        urgency: 'now',
        now: just(59),
        settings: DEFAULT_DELIVERY_SETTINGS,
        sentToday: 0,
      }),
    ).toBe('notify');
    expect(
      decideDelivery({
        urgency: 'now',
        now: new Date(2026, 10, 16, 22, 0, 0),
        settings: DEFAULT_DELIVERY_SETTINGS,
        sentToday: 0,
      }),
    ).toBe('digest');
  });
});

describe('the person’s limits', () => {
  it('start as three a day, quiet from 22:00 to 08:00, and a digest at 08:00', () => {
    expect(DEFAULT_DELIVERY_SETTINGS).toEqual({
      dailyLimit: 3,
      quietHours: { enabled: true, from: '22:00', to: '08:00' },
      digest: { enabled: true, at: '08:00' },
    });
  });

  it('change only what a change names, and take the edges of what is allowed', () => {
    expect(withSettings({ dailyLimit: 0 })).toEqual({
      ...DEFAULT_DELIVERY_SETTINGS,
      dailyLimit: 0,
    });
    expect(withSettings({ dailyLimit: 20 }).dailyLimit).toBe(20);
    expect(withSettings({ quietHours: { enabled: false } }).quietHours).toEqual({
      enabled: false,
      from: '22:00',
      to: '08:00',
    });
    expect(withSettings({ quietHours: { from: '00:00', to: '23:59' } }).quietHours).toEqual({
      enabled: true,
      from: '00:00',
      to: '23:59',
    });
    expect(withSettings({ digest: { at: '12:30' } }).digest).toEqual({
      enabled: true,
      at: '12:30',
    });
    expect(withSettings({})).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });

  it.each([
    [{ dailyLimit: 1.5 }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: -1 }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: 21 }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: '3' }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: null }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: Number.NaN }, /daily limit must be a whole number from 0 to 20/u],
    [{ dailyLimit: Number.POSITIVE_INFINITY }, /daily limit must be a whole number from 0 to 20/u],
    [{ quietHours: { from: '24:00' } }, /Quiet hours start must be a time of day as HH:MM/u],
    [{ quietHours: { from: '8:00' } }, /Quiet hours start must be a time of day as HH:MM/u],
    [{ quietHours: { to: '12:60' } }, /Quiet hours end must be a time of day as HH:MM/u],
    [{ quietHours: { to: '' } }, /Quiet hours end must be a time of day as HH:MM/u],
    [{ quietHours: { to: 800 } }, /Quiet hours end must be a time of day as HH:MM/u],
    [{ digest: { at: '08:00 ' } }, /digest time must be a time of day as HH:MM/u],
    [{ quietHours: { enabled: 'yes' } }, /Quiet hours on or off must be true or false/u],
    [{ digest: { enabled: 1 } }, /digest on or off must be true or false/u],
    [{ volume: 3 }, /Delivery has no setting named volume/u],
    [{ quietHours: { start: '22:00' } }, /Quiet hours has no setting named start/u],
    [{ digest: { when: '08:00' } }, /digest has no setting named when/u],
    [{ quietHours: 'always' }, /Quiet hours must be an object/u],
    [{ digest: [] }, /digest must be an object/u],
    [{ quietHours: { from: '08:00' } }, /Quiet hours must start and end at different times/u],
    [null, /change must be an object/u],
    [[], /change must be an object/u],
    ['dailyLimit', /change must be an object/u],
  ])('refuses %j in plain words', (change, message) => {
    expect(() => applySettingsChange(DEFAULT_DELIVERY_SETTINGS, change)).toThrow(
      DeliveryRefusedError,
    );
    expect(() => applySettingsChange(DEFAULT_DELIVERY_SETTINGS, change)).toThrow(message);
  });
});

interface IFakeSink extends IDeliverySink {
  readonly received: IDeliveryMessage[];
  attempts: number;
}

function sink(id: string, behaviour: 'works' | 'fails' | 'hangs' = 'works'): IFakeSink {
  const received: IDeliveryMessage[] = [];
  const fake: IFakeSink = {
    id,
    received,
    attempts: 0,
    deliver: async (message) => {
      fake.attempts += 1;
      if (behaviour === 'fails') throw new Error('The messenger is down');
      if (behaviour === 'hangs') return new Promise<void>(() => undefined);
      received.push(message);
    },
  };
  return fake;
}

interface IWorld {
  readonly delivery: QuestionDelivery;
  readonly book: CaseBook;
  readonly goals: GoalBook;
  readonly clock: { now: Date };
  /** Ask a question on a new case, and wait until delivery has dealt with it. */
  ask(
    urgency: TCaseUrgency | undefined,
    title?: string,
    question?: string,
  ): Promise<{ caseId: string; feedItemId: string }>;
}

function world(
  options: {
    sinks?: readonly IDeliverySink[];
    settings?: IDeliverySettings;
    start?: Date;
    stores?: {
      settings: IDeliveryStore<IDeliverySettings>;
      state: IDeliveryStore<IDeliveryState>;
    };
    sinkTimeoutMs?: number;
  } = {},
): IWorld {
  const clock = { now: options.start ?? at(10) };
  const goals = new GoalBook({ store: createMemoryGoalStore() });
  const stores = options.stores ?? {
    settings: createMemoryDeliveryStore<IDeliverySettings>(options.settings),
    state: createMemoryDeliveryStore<IDeliveryState>(),
  };
  const delivery = new QuestionDelivery({
    settings: stores.settings,
    state: stores.state,
    sinks: options.sinks ?? [],
    feed: goals,
    now: () => clock.now,
    ...(options.sinkTimeoutMs !== undefined && { sinkTimeoutMs: options.sinkTimeoutMs }),
  });
  const book = new CaseBook({
    store: createMemoryCaseStore(),
    feed: goals,
    onAsked: (event) => delivery.onAsked(event),
  });
  let sequence = 0;
  return {
    delivery,
    book,
    goals,
    clock,
    ask: async (
      urgency,
      title = 'New sign-in to your account',
      question = 'Did you sign in just now?',
    ) => {
      sequence += 1;
      const { case: opened } = await book.open({
        title,
        noticed: 'A mail says a new sign-in happened.',
        source: `mail:${sequence}`,
      });
      const { item } = await book.ask(opened.id, {
        question,
        options: ['Yes, it was me', 'No'],
        ...(urgency !== undefined && { urgency }),
      });
      await delivery.idle();
      return { caseId: opened.id, feedItemId: item.id };
    },
  };
}

describe('pushing a question', () => {
  it('pushes a `now` question to every sink and counts it, up to the daily limit', async () => {
    const first = sink('first');
    const second = sink('second');
    const { ask, delivery } = world({
      sinks: [first, second],
      settings: withSettings({ dailyLimit: 2 }),
    });
    await ask('now', 'Sign-in from Lagos');
    await ask('now', 'Bill due tomorrow');
    await ask('now', 'A third thing');

    for (const each of [first, second]) {
      expect(each.received.map((message) => message.kind)).toEqual(['question', 'question']);
      expect(each.received.map((message) => message.text.split('\n')[0])).toEqual([
        'Sign-in from Lagos: Did you sign in just now?',
        'Bill due tomorrow: Did you sign in just now?',
      ]);
      expect(each.received[0]!.text.split('\n').at(-1)).toBe('Open your Feed to answer.');
    }
    expect(await delivery.status()).toEqual({
      settings: withSettings({ dailyLimit: 2 }),
      today: { sent: 2, limit: 2 },
      waitingInDigest: 1,
    });
  });

  it('pushes nothing for a `feed` question, nor for one with no urgency, and holds nothing for it', async () => {
    const only = sink('only');
    const { ask, delivery } = world({ sinks: [only] });
    await ask('feed');
    await ask(undefined);
    expect(only.received).toEqual([]);
    expect(only.attempts).toBe(0);
    expect(await delivery.status()).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 }, waitingInDigest: 0 }),
    );
  });

  it('pushes the title and the question as plain text on one line, cut to a bound, with nothing added but a pointer to the feed', async () => {
    const only = sink('only');
    const { ask } = world({ sinks: [only] });
    const question = `Is this you?\n\nLine two\t${'‮'}${'very long '.repeat(30)}`;
    await ask('now', `Sign-in\nfrom ${'​'}Lagos`, question);
    const [message] = only.received;
    const lines = message!.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Open your Feed to answer.');
    expect(lines[0]!.startsWith('Sign-in from Lagos: Is this you? Line two very long')).toBe(true);
    expect(lines[0]).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(lines[0]!.endsWith('...')).toBe(true);
    expect(lines[0]!.split(': ').slice(1).join(': ').length).toBeLessThanOrEqual(200);
    expect(message!.text).not.toMatch(/https?:/u);
  });

  it('does not let a failing sink fail the ask or count as a push, and tries it once', async () => {
    const broken = sink('broken', 'fails');
    const { ask, delivery, book, clock } = world({ sinks: [broken] });
    const { caseId, feedItemId } = await ask('now');
    // The ask went through: the question waits in the feed, and the case holds it.
    expect((await book.get(caseId))?.question?.feedItemId).toBe(feedItemId);
    expect(await delivery.status()).toEqual(
      expect.objectContaining({ today: { sent: 0, limit: 3 }, waitingInDigest: 0 }),
    );
    clock.now = at(10, 30);
    await delivery.tick();
    clock.now = at(12);
    await delivery.tick();
    expect(broken.attempts).toBe(1);
  });

  it('counts a push once when one sink took it and another did not, and does not count one nobody took', async () => {
    const works = sink('works');
    const broken = sink('broken', 'fails');
    const { ask, delivery } = world({ sinks: [broken, works] });
    await ask('now');
    expect(works.received).toHaveLength(1);
    expect((await delivery.status()).today.sent).toBe(1);

    const nobody = world({ sinks: [] });
    await nobody.ask('now');
    expect((await nobody.delivery.status()).today.sent).toBe(0);
  });

  it('gives up on a sink that does not answer, so one stuck messenger does not stop the rest', async () => {
    const stuck = sink('stuck', 'hangs');
    const works = sink('works');
    const { ask, delivery } = world({ sinks: [stuck, works], sinkTimeoutMs: 20 });
    await ask('now');
    await ask('now');
    expect(works.received).toHaveLength(2);
    expect(stuck.attempts).toBe(2);
    expect((await delivery.status()).today.sent).toBe(2);
  });

  it('lets two questions asked together pass the limit only once', async () => {
    const only = sink('only');
    const { book, delivery } = world({ sinks: [only], settings: withSettings({ dailyLimit: 1 }) });
    const open = async (source: string) => {
      const { case: opened } = await book.open({ title: source, noticed: 'n', source });
      return book.ask(opened.id, { question: 'Was it you?', options: ['Yes'], urgency: 'now' });
    };
    await Promise.all([open('a'), open('b'), open('c')]);
    await delivery.idle();
    expect(only.received).toHaveLength(1);
    expect(await delivery.status()).toEqual(expect.objectContaining({ waitingInDigest: 2 }));
  });

  it('starts the count over on a new local day', async () => {
    const only = sink('only');
    const { ask, delivery, clock } = world({
      sinks: [only],
      settings: withSettings({ dailyLimit: 1 }),
    });
    await ask('now');
    await ask('now');
    expect(only.received).toHaveLength(1);
    clock.now = at(10, 0, 17);
    expect((await delivery.status()).today).toEqual({ sent: 0, limit: 1 });
    await ask('now');
    expect(only.received).toHaveLength(2);
  });
});

describe('quiet hours', () => {
  it('hold a `now` question for the digest instead of pushing it', async () => {
    const only = sink('only');
    const { ask, delivery, clock } = world({ sinks: [only], start: at(23, 30) });
    await ask('now', 'Sign-in from Lagos');
    expect(only.received).toEqual([]);
    expect((await delivery.status()).waitingInDigest).toBe(1);

    // Still quiet: the digest does not go out either.
    clock.now = at(7, 30, 17);
    await delivery.tick();
    expect(only.received).toEqual([]);

    clock.now = at(8, 0, 17);
    await delivery.tick();
    expect(only.received).toHaveLength(1);
    expect(only.received[0]).toEqual({
      kind: 'digest',
      text: '1 question is waiting for you:\n- Sign-in from Lagos\nOpen your Feed to answer.',
    });
  });
});

describe('the digest', () => {
  const asksThree = async () => {
    const only = sink('only');
    const made = world({ sinks: [only] });
    const a = await made.ask('digest', 'Alpha');
    const b = await made.ask('digest', 'Bravo');
    const c = await made.ask('digest', 'Charlie');
    return { ...made, only, a, b, c };
  };

  it('is one message for the day, listing each open question by title, once the time has come', async () => {
    const { only, delivery, clock } = await asksThree();
    clock.now = at(7, 59);
    await delivery.tick();
    expect(only.received).toEqual([]);
    clock.now = at(8, 0);
    await delivery.tick();
    await delivery.tick();
    expect(only.received).toEqual([
      {
        kind: 'digest',
        text: '3 questions are waiting for you:\n- Alpha\n- Bravo\n- Charlie\nOpen your Feed to answer.',
      },
    ]);
    expect(await delivery.status()).toEqual(expect.objectContaining({ waitingInDigest: 0 }));
  });

  it('goes out once a day: what is held after it waits for the next day', async () => {
    const { only, delivery, clock, ask } = await asksThree();
    clock.now = at(8, 0);
    await delivery.tick();
    expect(only.received).toHaveLength(1);

    clock.now = at(9, 0);
    await ask('digest', 'Delta');
    clock.now = at(9, 1);
    await delivery.tick();
    clock.now = at(20, 0);
    await delivery.tick();
    expect(only.received).toHaveLength(1);

    clock.now = at(8, 0, 17);
    await delivery.tick();
    expect(only.received).toHaveLength(2);
    expect(only.received[1]!.text).toBe(
      '1 question is waiting for you:\n- Delta\nOpen your Feed to answer.',
    );
  });

  it('leaves out the questions that were answered or withdrawn', async () => {
    const { only, delivery, clock, book, a, b } = await asksThree();
    await book.answer(a.feedItemId, { choice: 'No' });
    await book.close(b.caseId, 'Settled without the person.');
    expect((await delivery.status()).waitingInDigest).toBe(1);
    clock.now = at(8, 0);
    await delivery.tick();
    expect(only.received).toEqual([
      {
        kind: 'digest',
        text: '1 question is waiting for you:\n- Charlie\nOpen your Feed to answer.',
      },
    ]);
  });

  it('sends nothing when every held question was settled, and forgets them', async () => {
    const only = sink('only');
    const { ask, delivery, clock, book } = world({ sinks: [only] });
    const held = await ask('digest', 'Echo');
    await book.answer(held.feedItemId, { choice: 'Yes, it was me' });
    clock.now = at(8, 0);
    await delivery.tick();
    expect(only.received).toEqual([]);
    expect(only.attempts).toBe(0);
    expect((await delivery.status()).waitingInDigest).toBe(0);
  });

  it('is not sent when the digest is off, and its questions stay in the feed', async () => {
    const only = sink('only');
    const { ask, delivery, clock, goals } = world({
      sinks: [only],
      settings: withSettings({ digest: { enabled: false } }),
    });
    const { feedItemId } = await ask('digest');
    clock.now = at(9, 0);
    await delivery.tick();
    expect(only.received).toEqual([]);
    expect((await goals.feedItem(feedItemId))?.question?.state).toBe('open');
    expect((await delivery.status()).waitingInDigest).toBe(0);
  });

  it('is not sent inside quiet hours, even after its time', async () => {
    const only = sink('only');
    const { ask, delivery, clock } = world({
      sinks: [only],
      settings: withSettings({ digest: { at: '23:00' } }),
    });
    await ask('digest');
    clock.now = at(23, 30);
    await delivery.tick();
    expect(only.received).toEqual([]);
    expect((await delivery.status()).waitingInDigest).toBe(1);
  });

  it('is attempted once: a sink that fails does not bring it back every minute', async () => {
    const broken = sink('broken', 'fails');
    const { ask, delivery, clock } = world({ sinks: [broken] });
    await ask('digest');
    clock.now = at(8, 0);
    await delivery.tick();
    clock.now = at(8, 1);
    await delivery.tick();
    expect(broken.attempts).toBe(1);
  });
});

describe('what delivery keeps', () => {
  it('writes the limits and the counters to owner-only files, atomically', async () => {
    const dir = directory();
    const stores = createFileDeliveryStores(join(dir, 'delivery'));
    const only = sink('only');
    const { ask, delivery } = world({ sinks: [only], stores });
    await delivery.updateSettings({ dailyLimit: 5, digest: { at: '09:15' } });
    await ask('now');
    await ask('digest');

    const settings = JSON.parse(readFileSync(join(dir, 'delivery', 'settings.json'), 'utf8'));
    expect(settings).toEqual(withSettings({ dailyLimit: 5, digest: { at: '09:15' } }));
    const state = JSON.parse(readFileSync(join(dir, 'delivery', 'state.json'), 'utf8'));
    expect(state).toEqual({ day: '2026-11-16', sent: 1, pendingDigest: [expect.any(String)] });
    expect(readdirSync(join(dir, 'delivery')).sort()).toEqual(['settings.json', 'state.json']);
    if (process.platform !== 'win32') {
      for (const name of ['settings.json', 'state.json'])
        expect(statSync(join(dir, 'delivery', name)).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'delivery')).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps the count for the same day across a restart, and starts a new local day afresh', async () => {
    const dir = directory();
    const before = sink('before');
    const first = world({
      sinks: [before],
      stores: createFileDeliveryStores(join(dir, 'delivery')),
    });
    await first.delivery.updateSettings({ dailyLimit: 1 });
    await first.ask('now');
    await first.ask('digest', 'Held over the restart');
    expect(before.received).toHaveLength(1);

    // A new process: new objects over the same files, later on the same day.
    const after = sink('after');
    const second = world({
      sinks: [after],
      start: at(15, 0),
      stores: createFileDeliveryStores(join(dir, 'delivery')),
    });
    expect((await second.delivery.status()).today).toEqual({ sent: 1, limit: 1 });
    await second.ask('now');
    expect(after.received).toEqual([]);

    // The next morning: the count starts over, and the digest held over the restart is still held.
    const third = sink('third');
    const next = world({
      sinks: [third],
      start: at(8, 30, 17),
      stores: createFileDeliveryStores(join(dir, 'delivery')),
    });
    expect((await next.delivery.status()).today).toEqual({ sent: 0, limit: 1 });
    await next.ask('now');
    expect(third.received.map((message) => message.kind)).toEqual(['question']);
  });

  it('keeps what is held for the digest in the counters file', async () => {
    const dir = directory();
    const stores = () => createFileDeliveryStores(join(dir, 'delivery'));
    const first = world({ sinks: [], stores: stores() });
    await first.ask('digest', 'Held');
    const state = JSON.parse(readFileSync(join(dir, 'delivery', 'state.json'), 'utf8'));
    expect(state.pendingDigest).toHaveLength(1);
    const again = stores();
    expect(await again.state.read()).toEqual(state);
  });

  it('starts the day afresh when the counters file is not what delivery writes', async () => {
    const dir = directory();
    const stores = createFileDeliveryStores(join(dir, 'delivery'));
    writeFileSync(join(dir, 'delivery', 'state.json'), '{ not json');
    expect(await stores.state.read()).toBeUndefined();
    writeFileSync(join(dir, 'delivery', 'state.json'), JSON.stringify({ day: 'today', sent: -1 }));
    expect(await stores.state.read()).toBeUndefined();
    const only = sink('only');
    const { ask } = world({ sinks: [only], stores });
    await ask('now');
    expect(only.received).toHaveLength(1);
  });

  it('pushes nothing while the limits file cannot be read as limits, rather than pushing under limits the person did not choose', async () => {
    const dir = directory();
    const stores = createFileDeliveryStores(join(dir, 'delivery'));
    const path = join(dir, 'delivery', 'settings.json');
    const only = sink('only');
    const { ask, delivery, goals } = world({ sinks: [only], stores });
    for (const text of ['{ not json', JSON.stringify({ dailyLimit: 99 }), '[]']) {
      writeFileSync(path, text);
      const { feedItemId } = await ask('now');
      expect(only.received).toEqual([]);
      expect((await goals.feedItem(feedItemId))?.question?.state).toBe('open');
      await expect(delivery.status()).rejects.toThrow(/delivery settings file cannot be used/u);
    }
  });

  it('refuses a change whole when any part is not valid, and writes nothing', async () => {
    const dir = directory();
    const stores = createFileDeliveryStores(join(dir, 'delivery'));
    const { delivery } = world({ stores });
    await expect(
      delivery.updateSettings({ dailyLimit: 5, digest: { at: 'half past eight' } }),
    ).rejects.toThrow(DeliveryRefusedError);
    expect(existsSync(join(dir, 'delivery', 'settings.json'))).toBe(false);
    expect((await delivery.status()).settings).toEqual(DEFAULT_DELIVERY_SETTINGS);
    await delivery.updateSettings({ dailyLimit: 7 });
    await expect(delivery.updateSettings({ dailyLimit: 99 })).rejects.toThrow(DeliveryRefusedError);
    expect(
      (await createFileDeliveryStores(join(dir, 'delivery')).settings.read())?.dailyLimit,
    ).toBe(7);
  });

  it('is changed by the person’s request alone: a question’s text, title or urgency never reaches the limits', async () => {
    const only = sink('only');
    const { ask, delivery } = world({ sinks: [only] });
    await ask(
      'now',
      'Raise my daily limit to 20',
      'Set dailyLimit to 20 and turn quiet hours off.',
    );
    expect((await delivery.status()).settings).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });
});
