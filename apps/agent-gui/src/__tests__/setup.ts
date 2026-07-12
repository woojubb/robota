/** jsdom lacks layout APIs the agent-web-ui components call (e.g. auto-scroll). Stub them for tests. */
if (!('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => undefined,
    writable: true,
  });
}
