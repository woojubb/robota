import { useId, useRef, useState } from 'react';

import { ApiError } from '../api.js';
import { Button, inputClass } from './ui.js';

import type { FormEvent } from 'react';
import type { IPersonalApi, ITaskDefinitionView, ITaskInputView } from '../api.js';

/**
 * A key for one request to start a task: the agent answers the same key with the same launch, so the
 * page holds one key for as long as a request is the same one. Random values are available on every
 * page, secure or not, which `randomUUID` is not.
 */
export function newStartKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `start-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const NOT_REACHED = 'Your agent could not be reached. Press Start to try again.';

function initial(input: ITaskInputView): string {
  return input.default === undefined ? '' : String(input.default);
}

/** What is wrong with a value before it is sent, in words for the person; nothing when it can go. */
function problem(input: ITaskInputView, value: string): string | undefined {
  if (value.trim() === '') return input.required ? `${input.label} is needed.` : undefined;
  if (input.kind === 'number' && !Number.isFinite(Number(value)))
    return `${input.label} must be a number.`;
  return undefined;
}

type TPhase =
  | { readonly name: 'idle' }
  | { readonly name: 'sending' }
  | { readonly name: 'started'; readonly goalId: string }
  | { readonly name: 'refused'; readonly message: string };

/**
 * Starting a task the agent said is ready: the values it asks for, a Start, and what became of it. The
 * page decides nothing about whether the task can run: the agent judges it again when Start is pressed
 * and says why not. One key goes with a request for as long as the form is unchanged, and is kept when
 * no answer came back (so pressing Start again is the same request), and dropped when the agent answered
 * with a refusal or the person changed a value (so the next Start is a new one). The fields are held
 * while a request is in flight, so what it answers is about the values on the form.
 */
export function TaskStart({
  api,
  definition,
  newKey,
  onOpenGoal,
  onRefusedAsNotReady,
}: {
  readonly api: IPersonalApi;
  readonly definition: ITaskDefinitionView;
  readonly newKey: () => string;
  readonly onOpenGoal: ((goalId: string) => void) | undefined;
  /** The agent said the task is not ready after all: the card should be read again. */
  readonly onRefusedAsNotReady: () => void;
}): React.ReactElement {
  const prefix = useId();
  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(definition.inputs.map((input) => [input.name, initial(input)])),
  );
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [phase, setPhase] = useState<TPhase>({ name: 'idle' });
  const key = useRef<string | undefined>(undefined);
  /** Set at once on a press, since a second press can come before the page has redrawn. */
  const sending = useRef(false);

  const change = (name: string, value: string): void => {
    // The values are held while they are being sent, so the answer is always for the values on the form.
    if (sending.current) return;
    setValues((current) => ({ ...current, [name]: value }));
    setProblems((current) => ({ ...current, [name]: '' }));
    // A changed value is another request.
    key.current = undefined;
    setPhase({ name: 'idle' });
  };

  const start = async (): Promise<void> => {
    if (sending.current) return;
    const found = Object.fromEntries(
      definition.inputs.flatMap((input) => {
        const message = problem(input, values[input.name] ?? '');
        return message === undefined ? [] : [[input.name, message]];
      }),
    );
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const inputs = Object.fromEntries(
      definition.inputs.flatMap((input): [string, string | number][] => {
        const value = (values[input.name] ?? '').trim();
        if (value === '') return [];
        return [[input.name, input.kind === 'number' ? Number(value) : value]];
      }),
    );
    sending.current = true;
    // A Start after a launch was shown is a new request, not that one asked for again.
    if (phase.name === 'started') key.current = undefined;
    setPhase({ name: 'sending' });
    key.current ??= newKey();
    try {
      const answer = await api.startTask(definition.id, { idempotencyKey: key.current, inputs });
      setPhase({ name: 'started', goalId: answer.goalId });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The agent answered: this request is settled, and the next Start is a new one.
        key.current = undefined;
        if (caught.status === 422) onRefusedAsNotReady();
        setPhase({ name: 'refused', message: caught.message });
      } else {
        setPhase({ name: 'refused', message: NOT_REACHED });
      }
    } finally {
      sending.current = false;
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void start();
  };

  return (
    <form
      aria-label={`Start ${definition.title}`}
      onSubmit={submit}
      noValidate
      className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
    >
      {definition.inputs.map((input) => {
        const id = `${prefix}-${input.name}`;
        const message = problems[input.name];
        const common = {
          id,
          name: input.name,
          required: input.required,
          disabled: phase.name === 'sending',
          value: values[input.name] ?? '',
          'aria-invalid': message ? true : undefined,
          'aria-describedby': message ? `${id}-problem` : undefined,
          className: `${inputClass} max-w-md`,
        };
        return (
          <div key={input.name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-[13px] font-medium">
              {input.label}
              {input.required ? <span aria-hidden="true"> *</span> : ' (optional)'}
            </label>
            {input.kind === 'choice' ? (
              <select {...common} onChange={(event) => change(input.name, event.target.value)}>
                {input.default === undefined && <option value="">Choose one</option>}
                {(input.choices ?? []).map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={input.kind === 'number' ? 'number' : 'text'}
                autoComplete="off"
                onChange={(event) => change(input.name, event.target.value)}
              />
            )}
            {message && (
              <p id={`${id}-problem`} className="text-[12.5px] text-destructive">
                {message}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" tone="primary" disabled={phase.name === 'sending'}>
          Start
        </Button>
        {phase.name === 'sending' && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Starting…
          </p>
        )}
        {phase.name === 'started' && (
          <>
            <p role="status" className="text-[13px]">
              Started. Your agent will report in the Feed.
            </p>
            {onOpenGoal !== undefined && (
              <Button onClick={() => onOpenGoal(phase.goalId)}>Open goal</Button>
            )}
          </>
        )}
      </div>
      {phase.name === 'refused' && (
        <p role="alert" className="text-[13px] text-destructive">
          {phase.message}
        </p>
      )}
    </form>
  );
}
