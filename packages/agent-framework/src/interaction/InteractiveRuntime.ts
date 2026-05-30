export interface IInteractiveRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}
