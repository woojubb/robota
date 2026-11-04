import type { IAsyncScope } from '../host/framework-host.js';

/**
 * What a host without async-context tracking falls back to: the scope is one slot, set when `run`
 * starts and restored when what it ran settles.
 *
 * A slot is read correctly only by work nested inside the `run` that set it. It cannot follow an
 * independent async chain: two `run`s in flight at once would each read the other's value after an
 * `await`. A caller that uses it must therefore guarantee that the values running concurrently are
 * interchangeable, which is what `SessionSkillRouter` does for commands.
 */
export function createSlotScope<T>(): IAsyncScope<T> {
  const entries: Array<{ readonly value: T }> = [];
  return {
    run<R>(value: T, fn: () => R): R {
      const entry = { value };
      entries.push(entry);
      const leave = (): void => {
        // By identity: runs that overlap settle in any order, and each removes only its own value.
        const index = entries.lastIndexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      };
      let result: R;
      try {
        result = fn();
      } catch (error) {
        leave();
        throw error;
      }
      if (isPromiseLike(result)) {
        // The caller gets the settled value or the rejection it would have had, after the slot is released.
        return result.then(
          (settled) => {
            leave();
            return settled;
          },
          (error: unknown) => {
            leave();
            throw error;
          },
        ) as R;
      }
      leave();
      return result;
    },
    getStore(): T | undefined {
      return entries[entries.length - 1]?.value;
    },
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
