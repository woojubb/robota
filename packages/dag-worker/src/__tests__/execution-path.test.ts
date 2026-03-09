import { describe, expect, it } from 'vitest';
import { replaceAttemptSegment } from '../utils/execution-path.js';

describe('replaceAttemptSegment', () => {
    it('replaces existing attempt segment', () => {
        const path = ['dagId:dag-1', 'dagRunId:run-1', 'attempt:1'];
        const result = replaceAttemptSegment(path, 2);
        expect(result).toEqual(['dagId:dag-1', 'dagRunId:run-1', 'attempt:2']);
    });

    it('appends attempt segment when none exists', () => {
        const path = ['dagId:dag-1', 'dagRunId:run-1'];
        const result = replaceAttemptSegment(path, 3);
        expect(result).toEqual(['dagId:dag-1', 'dagRunId:run-1', 'attempt:3']);
    });

    it('does not mutate original array', () => {
        const path = ['dagId:dag-1', 'attempt:1'];
        const result = replaceAttemptSegment(path, 2);
        expect(path).toEqual(['dagId:dag-1', 'attempt:1']);
        expect(result).toEqual(['dagId:dag-1', 'attempt:2']);
    });
});
