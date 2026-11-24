// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { BrowseView } from '../views/Browse.js';
import { newStartKey } from '../views/TaskStart.js';

import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskLaunchStatusView,
  ITaskStartAnswer,
} from '../api.js';

afterEach(cleanup);

const READY = {
  state: 'ready',
  accesses: ["https pages the person names, read in the agent's own browser; nothing is submitted"],
} as const;

const pageCheck = (change: Partial<ITaskDefinitionView> = {}): ITaskDefinitionView => ({
  id: 'check-fact-on-page',
  revision: 1,
  title: 'Check a fact on a page I give you',
  category: 'Research',
  expectedResult: 'A yes, no or not-stated answer with the supporting passage.',
  inputs: [
    { name: 'page', label: 'Page address', kind: 'text', required: true },
    { name: 'question', label: 'What to check', kind: 'text', required: true },
  ],
  capabilities: ['web.read'],
  effectCeiling: 'read-only',
  completionEvidence: { kind: 'source-readback', description: 'The passage is read back.' },
  readiness: READY,
  ...change,
});

const mailbox = (readiness: ITaskDefinitionView['readiness']): ITaskDefinitionView =>
  pageCheck({
    id: 'catch-up-on-mailbox',
    title: 'Catch up on a connected mailbox',
    category: 'Mail',
    inputs: [{ name: 'focus', label: 'Anything in particular', kind: 'text', required: false }],
    capabilities: ['mail.search'],
    readiness,
  });

const ANSWER: ITaskStartAnswer = {
  launch: {
    id: 'launch-1',
    definitionId: 'check-fact-on-page',
    definitionRevision: 1,
    status: 'launched',
    goalId: 'goal-1',
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
  },
  goalId: 'goal-1',
};

/** What the agent says of the launch right after it was started. */
const STARTING: ITaskLaunchStatusView = {
  ...ANSWER.launch,
  progress: 'starting',
  reason: 'Your agent is getting this task going.',
  evidence: [],
};

type TStart = IPersonalApi['startTask'];

function setup(
  options: {
    definitions?: readonly ITaskDefinitionView[];
    start?: TStart;
    onOpenGoal?: (goalId: string) => void;
  } = {},
) {
  const startTask = vi.fn<TStart>(options.start ?? (async () => ANSWER));
  const taskDefinitions = vi.fn(async () => options.definitions ?? [pageCheck()]);
  const api = {
    taskDefinitions,
    taskOffers: async () => ({ offers: [], issues: [] }),
    taskLaunches: async () => [],
    taskLaunch: async () => STARTING,
    startTask,
  } as unknown as IPersonalApi;
  const keys: string[] = [];
  const newKey = (): string => {
    keys.push(`start-key-${keys.length + 1}`);
    return keys.at(-1)!;
  };
  const onOpenGoal = options.onOpenGoal ?? vi.fn();
  render(<BrowseView api={api} newKey={newKey} onOpenGoal={onOpenGoal} />);
  return { startTask, taskDefinitions, keys, onOpenGoal };
}

const card = async (title = 'Check a fact on a page I give you') =>
  within(await screen.findByRole('article', { name: title }));

async function fill(
  title: string | undefined,
  values: Record<string, string>,
): Promise<ReturnType<typeof within>> {
  const scope = await card(title);
  for (const [label, value] of Object.entries(values))
    fireEvent.change(scope.getByLabelText(new RegExp(label, 'u')), { target: { value } });
  return scope;
}

const PAGE = 'https://example.com/pricing';

describe('Start on a Browse card', () => {
  it('is offered only on a task the agent called ready, with no form or disabled button on any other', async () => {
    setup({
      definitions: [
        pageCheck(),
        mailbox({ state: 'unavailable', reason: 'no verified binding for mail.search yet' }),
        pageCheck({
          id: 'draft-reply-to-message',
          title: 'Draft a reply',
          category: 'Mail',
          readiness: { state: 'needs-setup', steps: [{ type: 'connect', kind: 'mail' }] },
        }),
      ],
    });
    await screen.findAllByRole('article');
    expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(1);
    expect(screen.getAllByRole('form')).toHaveLength(1);
    for (const title of ['Catch up on a connected mailbox', 'Draft a reply']) {
      const other = await card(title);
      expect(other.queryByRole('button')).toBeNull();
      expect(other.queryByRole('form')).toBeNull();
      expect(other.queryByRole('textbox')).toBeNull();
    }
    expect(
      (await card('Catch up on a connected mailbox')).getByText(
        'no verified binding for mail.search yet',
      ),
    ).toBeTruthy();
  });

  it('builds the form from what the task asks for: a label, a required marker or (optional), and its default', async () => {
    setup({
      definitions: [
        pageCheck({
          inputs: [
            { name: 'page', label: 'Page address', kind: 'text', required: true },
            { name: 'note', label: 'A note', kind: 'text', required: false },
            {
              name: 'tone',
              label: 'Tone',
              kind: 'choice',
              required: false,
              choices: ['Friendly', 'Formal'],
              default: 'Formal',
            },
            { name: 'days', label: 'How many days', kind: 'number', required: true, default: 7 },
          ],
        }),
      ],
    });
    const scope = await card();
    const page = scope.getByLabelText(/Page address/u) as HTMLInputElement;
    expect(page.required).toBe(true);
    expect(page.value).toBe('');
    expect(scope.getByText('Page address').textContent).toContain('*');
    expect(scope.getByText('A note (optional)')).toBeTruthy();
    expect((scope.getByLabelText(/A note/u) as HTMLInputElement).required).toBe(false);
    const tone = scope.getByLabelText(/Tone/u) as HTMLSelectElement;
    expect(tone.value).toBe('Formal');
    expect([...tone.options].map((option) => option.value)).toEqual(['Friendly', 'Formal']);
    const days = scope.getByLabelText(/How many days/u) as HTMLInputElement;
    expect(days.type).toBe('number');
    expect(days.value).toBe('7');
  });

  it('says what is missing beside the field, and sends nothing, when a needed value is left out', async () => {
    const { startTask } = setup();
    const scope = await fill(undefined, { 'Page address': PAGE });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect(scope.getByText('What to check is needed.')).toBeTruthy();
    expect(scope.getByLabelText(/What to check/u).getAttribute('aria-invalid')).toBe('true');
    expect(scope.queryByText('Page address is needed.')).toBeNull();
    expect(startTask).not.toHaveBeenCalled();
    // The message goes as the value is typed.
    fireEvent.change(scope.getByLabelText(/What to check/u), { target: { value: 'Is it free?' } });
    expect(scope.queryByText('What to check is needed.')).toBeNull();
  });

  it('sends the typed values trimmed, a number as a number, and leaves out what was left empty', async () => {
    const { startTask } = setup({
      definitions: [
        pageCheck({
          inputs: [
            { name: 'page', label: 'Page address', kind: 'text', required: true },
            { name: 'note', label: 'A note', kind: 'text', required: false },
            { name: 'days', label: 'How many days', kind: 'number', required: true, default: 7 },
            {
              name: 'tone',
              label: 'Tone',
              kind: 'choice',
              required: true,
              choices: ['Friendly', 'Formal'],
            },
          ],
        }),
      ],
    });
    const scope = await fill(undefined, {
      'Page address': `  ${PAGE}  `,
      'How many days': '3',
      Tone: 'Friendly',
    });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(startTask).toHaveBeenCalledTimes(1));
    expect(startTask).toHaveBeenCalledWith('check-fact-on-page', {
      idempotencyKey: 'start-key-1',
      inputs: { page: PAGE, days: 3, tone: 'Friendly' },
    });
  });

  it('disables Start while the request is in flight, sends it once for a double click or a double submit, and then shows where the launch stands', async () => {
    let finish: (answer: ITaskStartAnswer) => void = () => undefined;
    const { startTask } = setup({
      start: () => new Promise((resolve) => (finish = resolve)),
    });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    const button = scope.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(scope.getByRole('form'));
    fireEvent.submit(scope.getByRole('form'));
    expect(button.disabled).toBe(true);
    expect(scope.getByRole('status').textContent).toBe('Starting…');
    expect(startTask).toHaveBeenCalledTimes(1);
    finish(ANSWER);
    expect((await scope.findByLabelText('Task status')).textContent).toContain('Starting');
    expect(button.disabled).toBe(false);
    expect(startTask).toHaveBeenCalledTimes(1);
  });

  it('holds the fields while a request is in flight, so the answer is about the values that were sent', async () => {
    let finish: (answer: ITaskStartAnswer) => void = () => undefined;
    const { startTask } = setup({ start: () => new Promise((resolve) => (finish = resolve)) });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    const question = scope.getByLabelText(/What to check/u) as HTMLInputElement;
    expect(question.disabled).toBe(true);
    expect((scope.getByLabelText(/Page address/u) as HTMLInputElement).disabled).toBe(true);
    // An edit that gets through anyway changes nothing, and does not make the answer look like another request's.
    fireEvent.change(question, { target: { value: 'Is it open?' } });
    expect(question.value).toBe('Is it free?');
    expect(scope.getByRole('status').textContent).toBe('Starting…');
    finish(ANSWER);
    await scope.findByLabelText('Task status');
    expect(question.disabled).toBe(false);
    expect(question.value).toBe('Is it free?');
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(startTask.mock.calls[0]![1].inputs).toEqual({ page: PAGE, question: 'Is it free?' });
    // Once it has answered, an edit is another request; the launch that was made stays shown as it is.
    fireEvent.change(question, { target: { value: 'Is it open?' } });
    expect(scope.getByLabelText('Task status')).toBeTruthy();
  });

  it('opens the goal that was made when the person asks, and shows no link before there is one', async () => {
    const onOpenGoal = vi.fn();
    setup({ onOpenGoal });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    expect(scope.queryByRole('button', { name: 'Open goal' })).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    fireEvent.click(await scope.findByRole('button', { name: 'Open goal' }));
    expect(onOpenGoal).toHaveBeenCalledExactlyOnceWith('goal-1');
  });

  it('keeps one key across a retry when no answer came back, and across a double click', async () => {
    let attempts = 0;
    const { startTask, keys } = setup({
      start: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return ANSWER;
      },
    });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect((await scope.findByRole('alert')).textContent).toBe(
      'Your agent could not be reached. Press Start to try again.',
    );
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    expect(startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-1',
    ]);
    expect(keys).toEqual(['start-key-1']);
    expect(scope.queryByRole('alert')).toBeNull();
  });

  it.each([
    [400, 'Page address: The page address must start with https://'],
    [409, 'This key was already used for a different request. Start the task again.'],
    [422, 'This task is not ready to start.'],
    [500, 'Your agent could not set this task up. Try starting it again.'],
  ])(
    'shows the agent’s own words for a %s and starts the next try as a new request',
    async (status, message) => {
      let attempts = 0;
      const { startTask } = setup({
        start: async () => {
          attempts += 1;
          if (attempts === 1) throw new ApiError(status, message);
          return ANSWER;
        },
      });
      const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
      fireEvent.click(scope.getByRole('button', { name: 'Start' }));
      expect((await scope.findByRole('alert')).textContent).toBe(message);
      fireEvent.click(scope.getByRole('button', { name: 'Start' }));
      await scope.findByLabelText('Task status');
      expect(startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
        'start-key-1',
        'start-key-2',
      ]);
      expect(scope.queryByRole('alert')).toBeNull();
    },
  );

  it('reads the cards again when the agent says a task it showed as ready is not', async () => {
    const { taskDefinitions } = setup({
      start: async () => {
        throw new ApiError(422, 'This task is not ready to start.');
      },
    });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    expect(taskDefinitions).toHaveBeenCalledTimes(1);
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(taskDefinitions).toHaveBeenCalledTimes(2));
  });

  it('makes a new request when a value changes, and when Start is pressed after a launch was shown', async () => {
    const { startTask } = setup();
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    // Pressed again with nothing changed: the person saw it start, so this asks again.
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(startTask).toHaveBeenCalledTimes(2));
    await scope.findByLabelText('Task status');
    // A changed value is another request, and the next Start is made as one.
    fireEvent.change(scope.getByLabelText(/What to check/u), { target: { value: 'Is it open?' } });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(startTask).toHaveBeenCalledTimes(3));
    expect(startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-2',
      'start-key-3',
    ]);
  });

  it('changes the key when the person edits a value after a failure with no answer', async () => {
    let attempts = 0;
    const { startTask } = setup({
      start: async () => {
        attempts += 1;
        if (attempts <= 2) throw new TypeError('Failed to fetch');
        return ANSWER;
      },
    });
    const scope = await fill(undefined, { 'Page address': PAGE, 'What to check': 'Is it free?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByRole('alert');
    fireEvent.change(scope.getByLabelText(/What to check/u), { target: { value: 'Is it open?' } });
    expect(scope.queryByRole('alert')).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(startTask).toHaveBeenCalledTimes(2));
    expect(startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-2',
    ]);
  });

  it('shows an error from the agent as the plain text it is', async () => {
    const hostile = '<img src=x onerror=alert(1)> **bold** [link](https://evil.example)';
    const { container } = render(
      <BrowseView
        api={
          {
            taskDefinitions: async () => [pageCheck()],
            taskOffers: async () => ({ offers: [], issues: [] }),
            taskLaunches: async () => [],
            startTask: async () => {
              throw new ApiError(400, hostile);
            },
          } as unknown as IPersonalApi
        }
        onOpenGoal={() => undefined}
      />,
    );
    const form = await screen.findByRole('form', {
      name: 'Start Check a fact on a page I give you',
    });
    fireEvent.change(within(form).getByLabelText(/Page address/u), { target: { value: PAGE } });
    fireEvent.change(within(form).getByLabelText(/What to check/u), { target: { value: 'x' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Start' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(hostile);
    expect(container.querySelector('a, img, strong, b, em')).toBeNull();
  });
});

describe('the key a request goes with', () => {
  it('is a safe key the agent accepts, and a different one each time', () => {
    const keys = new Set(Array.from({ length: 50 }, newStartKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^start-[0-9a-f]{32}$/u);
  });
});
