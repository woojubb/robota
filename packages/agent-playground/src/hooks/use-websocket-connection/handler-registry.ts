export function notifyHandlers<TValue>(
  handlers: Set<(value: TValue) => void>,
  value: TValue,
): void {
  handlers.forEach((handler) => handler(value));
}

export function registerHandler<TValue>(
  handlers: Set<(value: TValue) => void>,
  handler: (value: TValue) => void,
): () => void {
  handlers.add(handler);

  return () => {
    handlers.delete(handler);
  };
}
