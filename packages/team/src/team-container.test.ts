import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TeamContainer } from './team-container';
import type { TeamContainerOptions } from './types';

// Mock dependencies
vi.mock('@robota-sdk/agents', () => ({
    Robota: vi.fn().mockImplementation(() => ({
        run: vi.fn().mockResolvedValue('Test response'),
        getPlugin: vi.fn().mockReturnValue({
            getAggregatedStats: vi.fn().mockReturnValue({
                totalExecutions: 1,
                averageDuration: 1000,
                successRate: 1.0
            })
        })
    })),
    ExecutionAnalyticsPlugin: vi.fn().mockImplementation(() => ({})),
    createZodFunctionTool: vi.fn().mockReturnValue({
        schema: { name: 'assignTask', parameters: {} }
    })
}));

vi.mock('uuid', () => ({
    v4: vi.fn().mockReturnValue('test-uuid')
}));

describe('TeamContainer', () => {
    let teamContainer: TeamContainer;
    let mockOptions: TeamContainerOptions;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Mock Date.now for consistent timing
        const mockDateNow = vi.spyOn(Date, 'now');
        let currentTime = 1000000000; // Starting timestamp
        mockDateNow.mockImplementation(() => {
            const time = currentTime;
            currentTime += 1000; // Add 1 second each time
            return time;
        });

        // Setup mock options
        mockOptions = {
            baseRobotaOptions: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                aiProviders: {
                    openai: {} as any
                },
                currentProvider: 'openai',
                currentModel: 'gpt-4o-mini',
                maxTokens: 8000
            },
            maxMembers: 5,
            debug: false
        };

        teamContainer = new TeamContainer(mockOptions);
    });

    describe('getStats', () => {
        it('should return initial stats with zero values', () => {
            const stats = teamContainer.getStats();

            expect(stats).toEqual({
                tasksCompleted: 0,
                totalAgentsCreated: 0,
                totalExecutionTime: 0
            });
        });

        it('should increment task count and execution time after execute', async () => {
            // Execute a task
            await teamContainer.execute('Test task');

            const stats = teamContainer.getStats();

            expect(stats.tasksCompleted).toBe(1);
            expect(stats.totalAgentsCreated).toBe(0); // No delegation
            expect(stats.totalExecutionTime).toBeGreaterThan(0);
        });

        it('should track multiple executions', async () => {
            // Execute multiple tasks
            await teamContainer.execute('Task 1');
            await teamContainer.execute('Task 2');

            const stats = teamContainer.getStats();

            expect(stats.tasksCompleted).toBe(2);
            expect(stats.totalExecutionTime).toBeGreaterThan(0);
        });
    });

    describe('getTeamStats', () => {
        it('should return comprehensive team statistics', () => {
            const teamStats = teamContainer.getTeamStats();

            expect(teamStats).toEqual({
                activeAgentsCount: 0,
                totalAgentsCreated: 0,
                maxMembers: 5,
                delegationHistoryLength: 0,
                successfulTasks: 0,
                failedTasks: 0,
                tasksCompleted: 0,
                totalExecutionTime: 0
            });
        });
    });

    describe('resetTeamStats', () => {
        it('should reset all statistics to zero', async () => {
            // Execute a task to create some stats
            await teamContainer.execute('Test task');

            // Verify stats exist
            let stats = teamContainer.getStats();
            expect(stats.tasksCompleted).toBe(1);
            expect(stats.totalExecutionTime).toBeGreaterThan(0);

            // Reset stats
            teamContainer.resetTeamStats();

            // Verify stats are reset
            stats = teamContainer.getStats();
            expect(stats.tasksCompleted).toBe(0);
            expect(stats.totalAgentsCreated).toBe(0);
            expect(stats.totalExecutionTime).toBe(0);
        });
    });

    describe('error handling', () => {
        it('should track execution time even when task fails', async () => {
            // Mock a failing execution
            const mockRobota = teamContainer['teamAgent'];
            vi.mocked(mockRobota.run).mockRejectedValueOnce(new Error('Test error'));

            // Attempt to execute task (should fail)
            await expect(teamContainer.execute('Failing task')).rejects.toThrow('Test error');

            // Verify execution time is still tracked
            const stats = teamContainer.getStats();
            expect(stats.totalExecutionTime).toBeGreaterThan(0);
            expect(stats.tasksCompleted).toBe(0); // Task didn't complete successfully
        });
    });
}); 