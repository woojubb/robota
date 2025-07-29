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
import { ActionTrackingEventService, setGlobalLogLevel } from '@robota-sdk/agents';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set log level to debug to see all logs including ToolExecutionService initialization
setGlobalLogLevel('debug');

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

        // Create providers optimized for test speed
        console.log(chalk.yellow('\n2. Creating AI providers...'));

        // Single OpenAI provider - team will use different models internally
        const openaiProvider = new OpenAIProvider({
            apiKey: openaiApiKey,
            enablePayloadLogging: false, // Reduce noise
        });

        console.log(chalk.cyan('   Using OpenAI provider'));
        console.log(chalk.cyan('   Team Leader: gpt-4o-mini (via template), Team Members: gpt-3.5-turbo (optimized)'));

        // Create team with enhanced EventService
        console.log(chalk.yellow('\n3. Creating team with Enhanced EventService...'));
        const team = createTeam({
            aiProviders: [openaiProvider as any], // Single provider, models configured internally
            maxMembers: 3,
            maxTokenLimit: 8000,
            debug: false,
            eventService: enhancedEventService // 🎯 Key: Enhanced EventService injection
        });

        console.log(chalk.green('✅ Team created with ActionTrackingEventService'));

        // Execute team task that should create branching structure  
        const result = await team.execute(`카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.`);

        // Get raw hierarchy data from Enhanced EventService
        const enhancedService = enhancedEventService as any;
        if (enhancedService.getHierarchy) {
            console.log(chalk.cyan('\n6. Raw Hierarchy Data Structure:'));
            console.log(chalk.gray('='.repeat(80)));

            const rawHierarchy = enhancedService.getHierarchy();
            console.log('📋 Raw Hierarchy Object:');
            console.log(JSON.stringify(rawHierarchy, null, 2));

            console.log(chalk.cyan('\n7. Hierarchy Map Entries:'));
            if (enhancedService.hierarchyMap) {
                const hierarchyEntries = Array.from(enhancedService.hierarchyMap.entries());
                hierarchyEntries.forEach((entry, index) => {
                    const [key, value] = entry as [string, any];
                    console.log(`\n[${index + 1}] Key: ${key}`);
                    console.log(`    Value:`, JSON.stringify(value, null, 4));
                });
            }

            console.log(chalk.cyan('\n8. Tree Structure Analysis:'));
            // Try different ways to access the hierarchy data
            console.log('🔍 Available properties on enhancedService:');
            console.log(Object.keys(enhancedService).filter(key => !key.startsWith('_')));

            // Check if rawHierarchy is a Map
            if (rawHierarchy instanceof Map) {
                console.log(`📊 Total Nodes in Map: ${rawHierarchy.size}`);

                // Group by parent to show tree structure
                const nodesByParent: { [key: string]: any[] } = {};
                rawHierarchy.forEach((node: any, id: string) => {
                    const parentId = node.parentId || 'ROOT';
                    if (!nodesByParent[parentId]) {
                        nodesByParent[parentId] = [];
                    }
                    nodesByParent[parentId].push({ id, ...node });
                });

                console.log('\n🌳 Tree Structure by Parent:');
                Object.entries(nodesByParent).forEach(([parentId, children]) => {
                    console.log(`\n📦 Parent: ${parentId}`);
                    children.forEach((child, index) => {
                        const isLast = index === children.length - 1;
                        const prefix = isLast ? '└── ' : '├── ';
                        console.log(`    ${prefix}${child.id} (Level: ${child.level})`);
                        if (child.metadata) {
                            console.log(`        Metadata: ${JSON.stringify(child.metadata, null, 0)}`);
                        }
                    });
                });
            } else if (rawHierarchy && typeof rawHierarchy === 'object') {
                console.log('📊 Raw hierarchy object keys:', Object.keys(rawHierarchy));
                console.log('📊 Raw hierarchy data:', JSON.stringify(rawHierarchy, null, 2));
            }
        }

        console.log(chalk.yellow('\n5. Task completed, analyzing results...'));

        // Generate visual tree
        verificationService.generateEventTree();
        const isSuccess = verificationService.verifyHierarchy();

        // 🔍 Debug: Check registered hierarchy in Enhanced EventService
        console.log(chalk.blue.bold('\n🔍 Enhanced EventService Hierarchy Debug:'));
        const hierarchy = enhancedService.getHierarchy();
        console.log(chalk.cyan(`Registered Execution Nodes: ${hierarchy.size}`));

        for (const [id, node] of hierarchy.entries()) {
            console.log(chalk.yellow(`  - ID: ${id}`));
            console.log(chalk.gray(`    Level: ${node.level}, Parent: ${node.parentId || 'none'}`));
            console.log(chalk.gray(`    Metadata: ${JSON.stringify(node.metadata || {})}`));
        }

        // Display final summary
        const summary = verificationService.getEventSummary();
        console.log(chalk.blue.bold('\n📋 Final Summary:'));
        console.log(chalk.white(`🎯 Enhanced EventService Integration: ${isSuccess ? 'SUCCESS' : 'FAILED'}`));
        console.log(chalk.white(`📊 Event Count: ${summary.count} (improvement: ${Math.round((summary.count - 4) / 4 * 100)}%)`));
        console.log(chalk.white(`🏗️  Hierarchy Levels: ${summary.levels.length} levels [${summary.levels.join(', ')}]`));
        console.log(chalk.white(`🔗 Parent-Child Relationships: ${summary.hasHierarchy ? 'Established' : 'Missing'}`));

        // Display task result
        console.log(chalk.blue.bold('\n💬 Task Result:'));
        console.log(chalk.gray(result));

        return isSuccess;

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