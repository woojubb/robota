/**
 * Enhanced EventService Hierarchy Verification Test
 * 
 * Tests ActionTrackingEventService integration with automatic hierarchy tracking.
 * Verifies that team execution produces the expected hierarchical event tree.
 * 
 * Expected Results:
 * - 24+ events (vs previous 4 flat events)
 * - 3-level hierarchy (Team=0, Agent=1, Tool=2)
 * - Proper parent-child relationships
 * - Automatic context enrichment
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { ActionTrackingEventService } from '@robota-sdk/agents';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Enhanced EventService for hierarchy verification
class HierarchyVerificationEventService {
    private events: Array<{ eventType: string, data: any, timestamp: Date }> = [];

    constructor() {
        console.log(chalk.magenta.bold('🎯 HierarchyVerificationEventService CREATED'));
    }

    emit(eventType: string, data: any): void {
        this.events.push({ eventType, data, timestamp: new Date() });

        // Real-time event display with hierarchy info
        console.log(chalk.green.bold(`🎯 EVENT: ${eventType}`));
        console.log(chalk.cyan(`   Source: ${data.sourceType}:${data.sourceId}`));
        console.log(chalk.yellow(`   Level: ${data.executionLevel || 'undefined'}, Parent: ${data.parentExecutionId || 'undefined'}`));
        console.log(chalk.gray(`   Time: ${new Date().toISOString()}`));
        console.log(chalk.gray(`   Meta:`, JSON.stringify(data.metadata || {}, null, 2)));
        console.log(chalk.gray('   ---'));
    }

    generateEventTree(): void {
        console.log(chalk.blue.bold('\n📊 Event Hierarchy Tree:'));

        // Group events by level
        const eventsByLevel: { [level: number]: any[] } = {};
        this.events.forEach(event => {
            const level = event.data.executionLevel || 0;
            if (!eventsByLevel[level]) {
                eventsByLevel[level] = [];
            }
            eventsByLevel[level].push(event);
        });

        // Display hierarchy
        Object.keys(eventsByLevel).sort().forEach(level => {
            const indent = '  '.repeat(parseInt(level));
            console.log(chalk.white(`${indent}Level ${level}:`));
            eventsByLevel[parseInt(level)].forEach(event => {
                console.log(chalk.gray(`${indent}  - ${event.eventType} (${event.data.sourceType}:${event.data.sourceId})`));
            });
        });
    }

    verifyHierarchy(): boolean {
        console.log(chalk.blue.bold('\n🔍 Hierarchy Verification:'));

        const eventCount = this.events.length;
        const hasParentChild = this.events.some(e => e.data.parentExecutionId);
        const levels = [...new Set(this.events.map(e => e.data.executionLevel).filter(l => l !== undefined))];
        const maxLevel = Math.max(...levels);

        console.log(chalk.white(`📈 Total Events: ${eventCount} (target: 20+)`));
        console.log(chalk.white(`🏗️  Max Level: ${maxLevel} (target: 2+)`));
        console.log(chalk.white(`🔗 Has Parent-Child: ${hasParentChild} (target: true)`));
        console.log(chalk.white(`📊 Levels Found: [${levels.join(', ')}]`));

        const success = eventCount >= 20 && maxLevel >= 2 && hasParentChild;

        if (success) {
            console.log(chalk.green.bold('\n✅ HIERARCHY VERIFICATION PASSED!'));
            console.log(chalk.green('Enhanced EventService successfully created hierarchical event tree!'));
        } else {
            console.log(chalk.red.bold('\n❌ HIERARCHY VERIFICATION FAILED!'));
            console.log(chalk.red('Enhanced EventService did not meet hierarchy requirements.'));
        }

        return success;
    }

    getEventSummary(): { count: number, levels: number[], hasHierarchy: boolean } {
        const levels = [...new Set(this.events.map(e => e.data.executionLevel).filter(l => l !== undefined))];
        const hasHierarchy = this.events.some(e => e.data.parentExecutionId);

        return {
            count: this.events.length,
            levels: levels.sort(),
            hasHierarchy
        };
    }
}

async function testEnhancedEventServiceHierarchy() {
    try {
        console.log(chalk.blue.bold('\n🧪 Enhanced EventService Hierarchy Verification Test'));

        // Environment validation
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }
        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        // Create verification service
        console.log(chalk.yellow('\n1. Creating Enhanced EventService...'));
        const verificationService = new HierarchyVerificationEventService();
        const enhancedEventService = new ActionTrackingEventService(verificationService);

        console.log(chalk.green('✅ ActionTrackingEventService created with HierarchyVerificationEventService base'));

        // Create providers
        console.log(chalk.yellow('\n2. Creating AI providers...'));
        const openaiProvider = new OpenAIProvider({
            apiKey: openaiApiKey,
            enablePayloadLogging: false, // Reduce noise
        });

        const anthropicProvider = new AnthropicProvider({
            apiKey: anthropicApiKey,
            enablePayloadLogging: false, // Reduce noise
        });

        // Create team with enhanced EventService
        console.log(chalk.yellow('\n3. Creating team with Enhanced EventService...'));
        const team = createTeam({
            aiProviders: [openaiProvider as any, anthropicProvider as any], // Type compatibility
            maxMembers: 3,
            maxTokenLimit: 8000,
            debug: false,
            eventService: enhancedEventService // 🎯 Key: Enhanced EventService injection
        });

        console.log(chalk.green('✅ Team created with ActionTrackingEventService'));

        // Execute complex task to trigger hierarchy
        console.log(chalk.yellow('\n4. Executing complex team task...'));
        console.log(chalk.gray('Task: "Vue.js 프레임워크의 주요 특징 3가지를 분석해줘"'));
        console.log(chalk.gray('Expected: Team → Agent → Tool hierarchy with automatic tracking'));

        const result = await team.execute(
            'Vue.js 프레임워크의 주요 특징 3가지를 분석해줘. 각 특징마다 간단한 예시 코드도 포함해서 설명해줘.'
        );

        console.log(chalk.yellow('\n5. Task completed, analyzing results...'));

        // Generate visual tree
        verificationService.generateEventTree();

        // Verify hierarchy requirements
        const success = verificationService.verifyHierarchy();

        // Display final summary
        const summary = verificationService.getEventSummary();
        console.log(chalk.blue.bold('\n📋 Final Summary:'));
        console.log(chalk.white(`🎯 Enhanced EventService Integration: ${success ? 'SUCCESS' : 'FAILED'}`));
        console.log(chalk.white(`📊 Event Count: ${summary.count} (improvement: ${Math.round((summary.count - 4) / 4 * 100)}%)`));
        console.log(chalk.white(`🏗️  Hierarchy Levels: ${summary.levels.length} levels [${summary.levels.join(', ')}]`));
        console.log(chalk.white(`🔗 Parent-Child Relationships: ${summary.hasHierarchy ? 'Established' : 'Missing'}`));

        // Display task result
        console.log(chalk.blue.bold('\n💬 Task Result:'));
        console.log(chalk.gray(result));

        return success;

    } catch (error) {
        console.error(chalk.red.bold('\n❌ Test failed:'), error);
        return false;
    }
}

// Run the test
testEnhancedEventServiceHierarchy()
    .then(success => {
        console.log(chalk.blue.bold('\n🎯 Enhanced EventService Test Completed'));
        if (success) {
            console.log(chalk.green.bold('🎉 SUCCESS: Enhanced EventService hierarchy system is working!'));
            process.exit(0);
        } else {
            console.log(chalk.red.bold('💥 FAILURE: Enhanced EventService hierarchy system needs fixes!'));
            process.exit(1);
        }
    })
    .catch(error => {
        console.error(chalk.red.bold('\n💥 Unexpected error:'), error);
        process.exit(1);
    }); 