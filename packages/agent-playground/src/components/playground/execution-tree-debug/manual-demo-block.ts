import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';

export function createManualDemoBlock(): IRealTimeBlockMessage {
  return {
    role: 'user',
    content: 'Test message from debug',
    timestamp: new Date(),
    blockMetadata: {
      id: 'test_' + Date.now(),
      type: 'user',
      level: 0,
      parentId: undefined,
      children: [],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(),
      endTime: new Date(),
      actualDuration: 100,
      executionContext: {
        timestamp: new Date(),
      },
    },
  };
}
