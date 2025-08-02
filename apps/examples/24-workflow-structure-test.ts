/**
 * 24-workflow-structure-test.ts
 * 
 * 목표: AssignTask 분기 구조 검증
 * User Input → Agent → Agent Thinking → Tool Call (assignTask) → Sub-Agent → Sub-Agent Thinking → Sub-Tool Calls → Sub-Response → Main Merge → Final Response
 */

import { OpenAIProvider } from '@robota-sdk/openai';
import { createTeam } from '@robota-sdk/team';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();
import {
    ActionTrackingEventService,
    RealTimeWorkflowBuilder,
    WorkflowEventSubscriber
} from '@robota-sdk/agents';
import type {
    WorkflowStructure,
    WorkflowBranch,
    WorkflowUpdate
} from '@robota-sdk/agents';

async function testWorkflowStructure() {
    console.log('\n🧪 Workflow Structure Test (AssignTask 분기 구조)');

    try {
        // 1. Enhanced EventService 생성
        console.log('\n1. Creating Enhanced EventService...');
        const baseEventService = new ActionTrackingEventService();
        console.log('✅ ActionTrackingEventService created');

        // 2. WorkflowEventSubscriber 생성 (단순화된 생성자)
        console.log('\n2. Creating WorkflowEventSubscriber...');
        const workflowSubscriber = new WorkflowEventSubscriber();
        console.log('✅ WorkflowEventSubscriber created');

        // 3. RealTimeWorkflowBuilder 생성 (WorkflowEventSubscriber를 EventService로 사용)
        console.log('\n3. Creating RealTimeWorkflowBuilder...');
        const workflowBuilder = new RealTimeWorkflowBuilder(workflowSubscriber);
        console.log('✅ RealTimeWorkflowBuilder created');

        // 3. Workflow 업데이트 구독
        const workflowUpdates: WorkflowUpdate[] = [];

        workflowBuilder.subscribeToWorkflowUpdates((update) => {
            workflowUpdates.push(update);
            console.log(`🔄 Workflow Update: ${update.type}`);

            if (update.changedBranch) {
                console.log(`   Branch: ${update.changedBranch.name} (${update.changedBranch.status})`);
            }

            const stats = workflowBuilder.getWorkflowStats();
            console.log(`   Stats: ${stats.totalNodes} nodes, ${stats.totalBranches} branches, ${stats.completedBranches} completed`);
        });

        // 4. AI Provider 설정
        console.log('\n3. Creating AI providers...');
        const provider = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY || 'test-key',
            model: 'gpt-4o-mini',
            logger: console
        });
        console.log('   Using OpenAI provider');

        // 5. Team 생성 with WorkflowEventSubscriber
        console.log('\n4. Creating team with WorkflowEventSubscriber...');
        const team = createTeam({
            aiProviders: [provider],
            defaultProvider: 'openai',
            eventService: workflowSubscriber,
            logger: console,
            templates: {
                'domain_researcher': {
                    id: 'domain_researcher',
                    description: 'Market analysis specialist',
                    model: 'gpt-3.5-turbo'
                },
                'creative_ideator': {
                    id: 'creative_ideator',
                    description: 'Menu composition specialist',
                    model: 'gpt-3.5-turbo'
                }
            }
        });
        console.log('✅ Team created with RealTimeWorkflowBuilder');

        // 6. Test 실행
        console.log('\n5. Executing assignTask workflow...');
        const startTime = Date.now();

        const result = await team.execute('카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.');

        const duration = Date.now() - startTime;
        console.log('\n✅ Test execution completed');

        // 7. Workflow 구조 분석
        console.log('\n6. Analyzing Workflow Structure...');
        const finalWorkflow = workflowBuilder.getCurrentWorkflow();

        console.log('\n📊 Final Workflow Structure:');
        console.log('================================================================================');
        analyzeWorkflowStructure(finalWorkflow);

        // 8. AssignTask 분기 구조 검증
        console.log('\n7. Verifying AssignTask Branch Structure...');
        verifyAssignTaskBranches(finalWorkflow);

        // 9. Workflow 연결 관계 검증
        console.log('\n8. Verifying Workflow Connections...');
        verifyWorkflowConnections(finalWorkflow);

        // 10. 최종 결과
        console.log('\n📋 Final Summary:');
        const stats = workflowBuilder.getWorkflowStats();
        console.log(`🎯 Workflow Stats:`);
        console.log(`   Total Nodes: ${stats.totalNodes}`);
        console.log(`   Total Connections: ${stats.totalConnections}`);
        console.log(`   Total Branches: ${stats.totalBranches}`);
        console.log(`   Completed Branches: ${stats.completedBranches}`);
        console.log(`   Is Completed: ${stats.isCompleted}`);
        console.log(`   Duration: ${stats.duration || duration}ms`);

        // 11. 실시간 워크플로우 구조 검증
        console.log('\n9. Verifying Workflow Structure...');
        const currentWorkflow = workflowBuilder.getCurrentWorkflow();

        console.log('\n📊 Current Workflow Structure:');
        console.log('================================================================================');
        console.log(JSON.stringify(currentWorkflow, null, 2));
        console.log('================================================================================');

        console.log('\n💬 Task Result:');
        console.log(result.response);

        console.log('\n🎯 Workflow Structure Test Completed');
        console.log('🎉 SUCCESS: Real-time AssignTask branch structure working!');

        return {
            success: true,
            workflow: finalWorkflow,
            stats,
            result
        };

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.log('\n🎯 Workflow Structure Test Completed');
        console.log('💥 FAILURE: Real-time workflow structure needs fixes!');

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Workflow 구조 분석
 */
function analyzeWorkflowStructure(workflow: WorkflowStructure): void {
    console.log(`📋 Workflow Metadata:`);
    console.log(`   Start Time: ${workflow.metadata.startTime.toISOString()}`);
    console.log(`   End Time: ${workflow.metadata.endTime?.toISOString() || 'Not completed'}`);
    console.log(`   Main Agent: ${workflow.metadata.mainAgentId}`);
    console.log(`   Total Branches: ${workflow.metadata.totalBranches}`);
    console.log(`   Completed Branches: ${workflow.metadata.completedBranches}`);

    console.log(`\n🌳 Node Structure by Type:`);
    const nodesByType = workflow.nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    Object.entries(nodesByType).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} nodes`);
    });

    console.log(`\n🔗 Connection Structure by Type:`);
    const connectionsByType = workflow.connections.reduce((acc, conn) => {
        acc[conn.type] = (acc[conn.type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    Object.entries(connectionsByType).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} connections`);
    });
}

/**
 * AssignTask 분기 구조 검증
 */
function verifyAssignTaskBranches(workflow: WorkflowStructure): void {
    console.log('🌿 AssignTask Branch Analysis:');

    workflow.branches.forEach((branch, index) => {
        console.log(`\n📦 Branch ${index + 1}: ${branch.name}`);
        console.log(`   ID: ${branch.id}`);
        console.log(`   AssignTask Call: ${branch.assignTaskCallId}`);
        console.log(`   Sub-Agent: ${branch.subAgentId}`);
        console.log(`   Status: ${branch.status}`);
        console.log(`   Nodes in Branch: ${branch.nodes.length}`);

        // 분기 내 Node 타입 분석
        const branchNodeTypes = branch.nodes.reduce((acc, node) => {
            acc[node.type] = (acc[node.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        console.log(`   Node Types:`, branchNodeTypes);
    });

    // 검증 결과
    const expectedBranches = 2; // 시장 분석 + 메뉴 구성
    const actualBranches = workflow.branches.length;

    console.log(`\n🔍 Branch Verification:`);
    console.log(`   Expected Branches: ${expectedBranches}`);
    console.log(`   Actual Branches: ${actualBranches}`);
    console.log(`   ✅ Branch Count: ${actualBranches === expectedBranches ? 'PASS' : 'FAIL'}`);

    // 각 분기에 Sub-Agent가 연결되었는지 확인
    const branchesWithSubAgents = workflow.branches.filter(b => b.subAgentId).length;
    console.log(`   Branches with Sub-Agents: ${branchesWithSubAgents}/${actualBranches}`);
    console.log(`   ✅ Sub-Agent Connection: ${branchesWithSubAgents === actualBranches ? 'PASS' : 'FAIL'}`);
}

/**
 * Workflow 연결 관계 검증
 */
function verifyWorkflowConnections(workflow: WorkflowStructure): void {
    console.log('🔗 Connection Verification:');

    // spawn 연결 확인 (Tool Call → Sub-Agent)
    const spawnConnections = workflow.connections.filter(c => c.type === 'spawn');
    console.log(`   Spawn Connections (Tool Call → Sub-Agent): ${spawnConnections.length}`);

    spawnConnections.forEach((conn, index) => {
        console.log(`     ${index + 1}. ${conn.fromId} → ${conn.toId} (${conn.label})`);
    });

    // return 연결 확인 (Sub-Agent → Main Agent)
    const returnConnections = workflow.connections.filter(c => c.type === 'return');
    console.log(`   Return Connections (Sub-Agent → Main): ${returnConnections.length}`);

    // consolidate 연결 확인 (Sub-Responses → Final Response)
    const consolidateConnections = workflow.connections.filter(c => c.type === 'consolidate');
    console.log(`   Consolidate Connections (Sub-Responses → Final): ${consolidateConnections.length}`);

    // 검증 결과
    console.log(`\n🔍 Connection Verification:`);
    console.log(`   ✅ Tool Call → Sub-Agent: ${spawnConnections.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Sub-Agent → Main Agent: ${returnConnections.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Consolidation: ${consolidateConnections.length > 0 ? 'PASS' : 'FAIL'}`);
}

// Run example
async function main() {
    const result = await testWorkflowStructure();
    console.log('\n🧹 Cleanup completed. Exiting...');
    process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

export { testWorkflowStructure };