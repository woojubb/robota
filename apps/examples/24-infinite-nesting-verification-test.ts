#!/usr/bin/env npx tsx

/**
 * 🌳 Infinite Nesting Tree Structure Verification Test
 * 
 * Tests the complete Agent → Tool → Agent → Tool infinite nesting capability
 * with proper branching hierarchy tracking.
 * 
 * Expected Structure:
 * ```
 * Team Leader (Level 0)
 * ├── assignTask #1 (Level 1, allowFurtherDelegation: true)
 * │   └── Agent A (Level 2, has assignTask tool)
 * │       ├── assignTask #A1 (Level 3, allowFurtherDelegation: true)  
 * │       │   └── Agent B (Level 4, has assignTask tool)
 * │       │       └── assignTask #B1 (Level 5)
 * │       │           └── Agent C (Level 6)
 * │       └── assignTask #A2 (Level 3)
 * │           └── Agent D (Level 4)
 * └── assignTask #2 (Level 1)
 *     └── Agent E (Level 2)
 * ```
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { ActionTrackingEventService, setGlobalLogLevel } from '@robota-sdk/agents';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set log level to debug to see all logs including ToolExecutionService initialization
setGlobalLogLevel('debug');

// Enhanced EventService for infinite nesting hierarchy verification
class InfiniteNestingVerificationEventService {
    private events: Array<{ eventType: string, data: any, timestamp: Date }> = [];

    constructor() {
        console.log(chalk.magenta.bold('🎯 InfiniteNestingVerificationEventService CREATED'));
    }

    emit(eventType: string, data: any): void {
        this.events.push({ eventType, data, timestamp: new Date() });

        // Real-time event display with infinite nesting hierarchy info
        console.log(chalk.green.bold(`🎯 EVENT: ${eventType}`));
        console.log(chalk.cyan(`   Source: ${data.sourceType}:${data.sourceId}`));
        console.log(chalk.yellow(`   Level: ${data.executionLevel || 'undefined'}, Parent: ${data.parentExecutionId || 'undefined'}`));
        console.log(chalk.magenta(`   Root: ${data.rootExecutionId || 'undefined'}, Path: ${JSON.stringify(data.executionPath || [])}`));
        console.log(chalk.gray(`   Time: ${new Date().toISOString()}`));
        console.log(chalk.gray(`   AllowDelegation: ${data.parameters?.allowFurtherDelegation || 'undefined'}`));
        console.log(chalk.gray('   ---'));
    }

    generateInfiniteNestingTree(): void {
        console.log(chalk.blue.bold('\n🌳 Infinite Nesting Hierarchy Tree:'));

        // Group events by level
        const eventsByLevel: { [level: number]: any[] } = {};
        this.events.forEach(event => {
            const level = event.data.executionLevel || 0;
            if (!eventsByLevel[level]) {
                eventsByLevel[level] = [];
            }
            eventsByLevel[level].push(event);
        });

        // Display infinite nesting hierarchy
        Object.keys(eventsByLevel).sort((a, b) => parseInt(a) - parseInt(b)).forEach(level => {
            const indent = '  '.repeat(parseInt(level));
            const levelNum = parseInt(level);
            const levelType = levelNum % 2 === 1 ? 'Tool Branch' : (levelNum === 0 ? 'Team Root' : 'Agent Execution');

            console.log(chalk.white(`${indent}Level ${level} (${levelType}):`));
            eventsByLevel[levelNum].forEach(event => {
                const delegation = event.data.parameters?.allowFurtherDelegation ? ' [CAN_DELEGATE]' : '';
                console.log(chalk.gray(`${indent}  - ${event.eventType} (${event.data.sourceType}:${event.data.sourceId})${delegation}`));
            });
        });
    }

    verifyInfiniteNestingHierarchy(): boolean {
        console.log(chalk.blue.bold('\n🔍 Infinite Nesting Hierarchy Verification:'));

        // 1. Check for events with proper levels
        const levelsFound = new Set();
        let maxLevel = 0;
        this.events.forEach(event => {
            const level = event.data.executionLevel;
            if (level !== undefined) {
                levelsFound.add(level);
                maxLevel = Math.max(maxLevel, level);
            }
        });

        console.log(`   📊 Levels found: ${Array.from(levelsFound).sort().join(', ')}`);
        console.log(`   📈 Maximum nesting depth: ${maxLevel}`);

        // 2. Check for proper parent-child relationships
        let properHierarchy = 0;
        let totalEvents = 0;
        this.events.forEach(event => {
            totalEvents++;
            if (event.data.parentExecutionId && event.data.executionLevel > 0) {
                properHierarchy++;
            }
        });

        console.log(`   🔗 Events with parent relationships: ${properHierarchy}/${totalEvents}`);

        // 3. Check for delegation capability tracking
        const delegationCapableEvents = this.events.filter(event =>
            event.data.parameters?.allowFurtherDelegation === true
        );
        console.log(`   🎯 Events with delegation capability: ${delegationCapableEvents.length}`);

        // 4. Check for proper execution path chains
        const eventsWithPaths = this.events.filter(event =>
            event.data.executionPath && event.data.executionPath.length > 0
        );
        console.log(`   🛤️  Events with execution paths: ${eventsWithPaths.length}`);

        // 5. Success criteria for infinite nesting
        const criteria = {
            hasMultipleLevels: levelsFound.size >= 3, // At least 3 levels
            hasProperHierarchy: properHierarchy > 0,  // Some parent-child relationships
            hasMaxDepth: maxLevel >= 2,               // At least depth 2
            hasDelegationTracking: delegationCapableEvents.length > 0,
            hasExecutionPaths: eventsWithPaths.length > 0
        };

        console.log(chalk.cyan('\n📋 Infinite Nesting Success Criteria:'));
        Object.entries(criteria).forEach(([key, passed]) => {
            const status = passed ? chalk.green('✅ PASS') : chalk.red('❌ FAIL');
            console.log(`   ${key}: ${status}`);
        });

        const allPassed = Object.values(criteria).every(Boolean);
        const result = allPassed
            ? chalk.green.bold('✅ INFINITE NESTING VERIFICATION PASSED')
            : chalk.red.bold('❌ INFINITE NESTING VERIFICATION FAILED');

        console.log(`\n${result}`);

        return allPassed;
    }

    getEvents() {
        return this.events;
    }

    getEventCount() {
        return this.events.length;
    }
}

// Main test execution
async function runInfiniteNestingTest() {
    console.log(chalk.blue.bold('🚀 Starting Infinite Nesting Tree Structure Test'));

    try {
        // Create verification event service
        const verificationService = new InfiniteNestingVerificationEventService();

        // Create ActionTrackingEventService with verification service as base
        const enhancedEventService = new ActionTrackingEventService(verificationService);

        // Create AI provider optimized for nested team execution
        const openaiProvider = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY || '',
            model: 'gpt-4o-mini', // Fast model for team leader (needs tool calling)
            logger: undefined
        });

        // Create team with infinite nesting capabilities
        const team = createTeam({
            aiProviders: [openaiProvider as any],
            maxMembers: 10, // Allow multiple nested agents
            debug: true,
            eventService: enhancedEventService
        });

        console.log(chalk.green('\n📋 Team created, starting infinite nesting test execution...'));

        // Execute team task that should trigger infinite nesting
        const result = await team.execute(`
MANDATORY DEEP DELEGATION RESEARCH PROJECT: Multi-Level AI Impact Analysis

🚨 CRITICAL INSTRUCTION: You MUST delegate this work through multiple levels of specialists.

REQUIREMENT: Create a 3-level delegation hierarchy:
1. YOU (Team Leader) → Delegate to 2 primary research coordinators with allowFurtherDelegation=true
2. EACH Coordinator → MUST delegate to 2 sub-specialists with allowFurtherDelegation=true  
3. EACH Sub-specialist → MUST delegate final analysis to 1 expert specialist

EXPECTED DELEGATION TREE:
Team Leader
├── Research Coordinator A (allowFurtherDelegation=true)
│   ├── Sub-specialist A1 (allowFurtherDelegation=true)
│   │   └── Expert A1a (final analysis)
│   └── Sub-specialist A2 (allowFurtherDelegation=true)
│       └── Expert A2a (final analysis)
└── Research Coordinator B (allowFurtherDelegation=true)
    ├── Sub-specialist B1 (allowFurtherDelegation=true)
    │   └── Expert B1a (final analysis)
    └── Sub-specialist B2 (allowFurtherDelegation=true)
        └── Expert B2a (final analysis)

DELEGATION REQUIREMENTS:
- ALWAYS use allowFurtherDelegation=true for levels 1 and 2
- ALWAYS use allowFurtherDelegation=false for level 3 (final experts)
- Each delegation MUST specify that the agent should further delegate if capable

RESEARCH TOPIC: "Impact of AI on Software Development"

MANDATORY DELEGATION INSTRUCTIONS FOR EACH LEVEL:

Level 1 (YOU): Delegate to research coordinators with these exact instructions:
"You are a research coordinator. You MUST delegate specific sub-areas to specialist agents using assignTask with allowFurtherDelegation=true. Each specialist MUST further delegate final analysis to expert researchers."

Level 2 (Coordinators): Each MUST delegate with these instructions:
"You are a research specialist. You MUST delegate the final detailed analysis to an expert researcher using assignTask with allowFurtherDelegation=false for the final analysis."

Level 3 (Sub-specialists): Each MUST delegate with these instructions:
"You are an expert analyst. Conduct the final detailed analysis without further delegation."

VERIFICATION: The final result should show evidence of at least 3 levels of delegation depth.

Start the delegation process NOW. Do not attempt to do any analysis yourself - immediately begin delegating to research coordinators.
        `);

        console.log(chalk.green('\n✅ Team execution completed'));
        console.log(chalk.gray('Result:', result.slice(0, 200) + '...'));

        // Wait a moment for all events to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Generate tree visualization
        verificationService.generateInfiniteNestingTree();

        // Enhanced EventService hierarchy debug
        if ('getHierarchy' in enhancedEventService) {
            const hierarchy = (enhancedEventService as any).getHierarchy();
            console.log(chalk.blue.bold('\n🔍 Enhanced EventService Infinite Nesting Hierarchy Debug:'));
            console.log(`Registered Execution Nodes: ${hierarchy.size}`);

            // Display first 10 nodes for debugging
            let count = 0;
            for (const [id, node] of hierarchy.entries()) {
                if (count >= 10) {
                    console.log(`  ... and ${hierarchy.size - 10} more nodes`);
                    break;
                }
                console.log(`  - ID: ${id}`);
                console.log(`    Level: ${node.level}, Parent: ${node.parentId || 'none'}`);
                console.log(`    Children: [${node.children.join(', ') || 'none'}]`);
                console.log(`    Metadata: ${JSON.stringify(node.metadata)}`);
                count++;
            }
        }

        // Run verification
        const success = verificationService.verifyInfiniteNestingHierarchy();

        console.log(chalk.blue.bold(`\n📈 Total events captured: ${verificationService.getEventCount()}`));

        process.exit(success ? 0 : 1);

    } catch (error) {
        console.error(chalk.red.bold('❌ Test execution failed:'), error);
        process.exit(1);
    }
}

// Execute the test
runInfiniteNestingTest().catch(console.error); 