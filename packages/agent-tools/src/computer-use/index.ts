// SELFHOST-010: computer-use — driver port + perceive/act contract + tool factory + zero-dep reference adapter.
//
// NOTE: the test-support `ScriptedComputerDriver` is deliberately NOT exported here — it lives under
// `./testing/scripted-computer-driver.ts` and is imported by tests via a relative path (test-support, never
// the package main entry), mirroring agent-core's `scripted-provider`.

export type {
  IBrowserPageAdapter,
  IBrowserPageKeyboardAdapter,
  IBrowserPageMouseAdapter,
  IComputerActionResult,
  IComputerClickAction,
  IComputerDoubleClickAction,
  IComputerDragAction,
  IComputerDriver,
  IComputerKeypressAction,
  IComputerPoint,
  IComputerScreenshot,
  IComputerScrollAction,
  IComputerTakeoverAction,
  IComputerToolOptions,
  IComputerTypeAction,
  IComputerWaitAction,
  TComputerAction,
  TComputerActionType,
  TComputerMouseButton,
} from './types.js';

export {
  createComputerActTool,
  createComputerTool,
  createComputerViewTool,
} from './computer-tool.js';
export type { IComputerToolResult } from './computer-tool.js';

export { PageComputerDriver } from './page-computer-driver.js';
export type { IPageComputerDriverOptions } from './page-computer-driver.js';
