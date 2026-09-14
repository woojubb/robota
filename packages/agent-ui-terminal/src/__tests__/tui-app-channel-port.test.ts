import { describe, expectTypeOf, it } from 'vitest';

import type {
  ITuiAppChannelPort,
  ITuiCommandQueryPort,
  ITuiSessionUiEventPort,
} from '../tui-app-channel-port.js';

describe('TUI React capability boundary', () => {
  it('excludes concrete channel and state-manager escape hatches', () => {
    expectTypeOf<ITuiAppChannelPort>().not.toHaveProperty('getSession');
    expectTypeOf<ITuiAppChannelPort>().not.toHaveProperty('getRegistry');
    expectTypeOf<ITuiAppChannelPort>().not.toHaveProperty('stateManager');
  });

  it('limits autocomplete to command queries', () => {
    expectTypeOf<ITuiCommandQueryPort>().toHaveProperty('getCommands');
    expectTypeOf<ITuiCommandQueryPort>().toHaveProperty('getSubcommands');
    expectTypeOf<ITuiCommandQueryPort>().not.toHaveProperty('addModule');
    expectTypeOf<ITuiCommandQueryPort>().not.toHaveProperty('execute');
  });

  it('limits React event effects to the two UI event names', () => {
    expectTypeOf<Parameters<ITuiSessionUiEventPort['on']>[0]>().toEqualTypeOf<
      'ui_intent' | 'session_renamed'
    >();
    expectTypeOf<Parameters<ITuiSessionUiEventPort['off']>[0]>().toEqualTypeOf<
      'ui_intent' | 'session_renamed'
    >();
  });
});
