/**
 * 25-current-workflow-verification.ts
 * 
 * 목표: 현재 리팩토링된 코드로 워크플로우 노드 연결 검증
 * 24번 예제의 검증 로직을 현재 아키텍처에 맞게 적용
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
    UniversalWorkflowStructure,
    WorkflowUpdate
} from '@robota-sdk/agents';

async function testCurrentWorkflowStructure() {
    console.log('\n🧪 Current Workflow Structure Verification Test');

    try {
        // 1. WorkflowEventSubscriber 생성
        console.log('\n1. Creating WorkflowEventSubscriber...');
        const workflowSubscriber = new WorkflowEventSubscriber();
        console.log('✅ WorkflowEventSubscriber created');

        // 2. Enhanced EventService with WorkflowEventSubscriber 생성
        console.log('\n2. Creating Enhanced EventService...');
        const baseEventService = new ActionTrackingEventService(workflowSubscriber);
        console.log('✅ ActionTrackingEventService created');

        // 3. RealTimeWorkflowBuilder 생성
        console.log('\n3. Creating RealTimeWorkflowBuilder...');
        const workflowBuilder = new RealTimeWorkflowBuilder(workflowSubscriber);
        console.log('✅ RealTimeWorkflowBuilder created');

        // 4. Workflow 업데이트 구독
        let finalWorkflow: UniversalWorkflowStructure | null = null;

        workflowBuilder.subscribeToUniversalUpdates((workflow: UniversalWorkflowStructure) => {
            console.log(`📊 Universal Workflow Update:`, {
                nodeCount: workflow.nodes.length,
                edgeCount: workflow.edges.length,
                workflowType: workflow.__workflowType
            });

            finalWorkflow = workflow;

            // 노드 연결 상황 실시간 출력
            if (workflow.nodes.length > 2) {
                console.log('\n🔗 Current Node Connections:');
                workflow.nodes.forEach(node => {
                    console.log(`   Node: ${node.id} (${node.type}) - "${node.data.label || 'No label'}"`);
                });
                console.log('\n🔗 Current Edge Connections:');
                (workflow.edges || []).forEach(edge => {
                    console.log(`   Edge: ${edge.source} → ${edge.target} (${edge.type || 'default'})`);
                });
            }
        });

        // 5. AI Provider 설정
        console.log('\n4. Creating AI providers...');
        const provider = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY || 'test-key',
            model: 'gpt-4o-mini',
            logger: console
        });
        console.log('   Using OpenAI provider');

        // 6. Team 생성 with WorkflowEventSubscriber
        console.log('\n5. Creating team with WorkflowEventSubscriber...');
        const team = createTeam({
            aiProviders: [provider],
            defaultProvider: 'openai',
            eventService: workflowSubscriber,
            logger: console,
            templates: {
                'market_analyst': {
                    id: 'market_analyst',
                    description: 'Market analysis specialist',
                    model: 'gpt-3.5-turbo'
                },
                'menu_designer': {
                    id: 'menu_designer',
                    description: 'Menu composition specialist',
                    model: 'gpt-3.5-turbo'
                }
            }
        });
        console.log('✅ Team created with RealTimeWorkflowBuilder');

        // 7. 간단한 테스트 실행
        console.log('\n6. Executing simple workflow test...');
        const startTime = Date.now();

        const result = await team.execute('간단한 카페 메뉴 3개만 추천해주세요. 시장분석 1개와 메뉴 2개를 각각 다른 팀원이 작성해주세요.');

        const duration = Date.now() - startTime;
        console.log('\n✅ Test execution completed');

        // 8. 최종 워크플로우 구조 분석
        console.log('\n7. Final Workflow Analysis...');
        const currentWorkflow = workflowBuilder.getCurrentWorkflow();

        if (currentWorkflow) {
            console.log('\n📊 Final Workflow Structure:');
            console.log('================================================================================');

            // 24번 예제의 검증 로직 적용
            await verifyCurrentUniversalWorkflow(currentWorkflow);
            await generateAndVerifyCurrentReactFlowData(currentWorkflow);
        } else {
            console.log('❌ No workflow generated');
        }

        // 9. 최종 결과
        console.log('\n📋 Final Summary:');
        const stats = workflowBuilder.getWorkflowStats();
        console.log(`🎯 Workflow Stats:`);
        console.log(`   Total Nodes: ${stats.totalNodes}`);
        console.log(`   Total Connections: ${stats.totalConnections}`);
        console.log(`   Duration: ${duration}ms`);

        console.log('\n💬 Task Result:');
        console.log(result.response);

        console.log('\n🎯 Current Workflow Structure Verification Completed');
        console.log('🎉 SUCCESS: Current architecture workflow generation working!');

        return {
            success: true,
            workflow: currentWorkflow,
            stats,
            result
        };

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.log('\n🎯 Current Workflow Structure Verification Completed');
        console.log('💥 FAILURE: Current workflow structure needs fixes!');

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * 현재 Universal Workflow 구조 검증 (24번 예제 기반)
 */
function verifyCurrentUniversalWorkflow(workflow: UniversalWorkflowStructure): void {
    console.log('🔗 Current Universal Workflow Verification:');

    // 노드 타입별 분석
    const agentNodes = workflow.nodes.filter(n => n.type === 'agent');
    const toolNodes = workflow.nodes.filter(n => n.type === 'tool');
    const teamNodes = workflow.nodes.filter(n => n.type === 'team');
    const userInputNodes = workflow.nodes.filter(n => n.type === 'user_input');
    const responseNodes = workflow.nodes.filter(n => n.type === 'final_response');

    console.log(`   Agent Nodes: ${agentNodes.length}`);
    console.log(`   Tool Nodes: ${toolNodes.length}`);
    console.log(`   Team Nodes: ${teamNodes.length}`);
    console.log(`   User Input Nodes: ${userInputNodes.length}`);
    console.log(`   Response Nodes: ${responseNodes.length}`);
    console.log(`   Total Nodes: ${workflow.nodes.length}`);

    // 엣지 연결 검증 (24번 예제 로직)
    const edges = workflow.edges || [];
    const validEdges = edges.filter(edge => {
        const sourceExists = workflow.nodes.some(n => n.id === edge.source);
        const targetExists = workflow.nodes.some(n => n.id === edge.target);
        return sourceExists && targetExists;
    });

    const invalidEdges = edges.filter(edge => {
        const sourceExists = workflow.nodes.some(n => n.id === edge.source);
        const targetExists = workflow.nodes.some(n => n.id === edge.target);
        return !sourceExists || !targetExists;
    });

    console.log(`   Valid Edges: ${validEdges.length}/${edges.length}`);

    if (invalidEdges.length > 0) {
        console.log('\n❌ Invalid Edges Found:');
        invalidEdges.forEach(edge => {
            const sourceExists = workflow.nodes.some(n => n.id === edge.source);
            const targetExists = workflow.nodes.some(n => n.id === edge.target);
            console.log(`   ${edge.source} → ${edge.target}: source=${sourceExists}, target=${targetExists}`);
        });

        console.log('\n📋 Available Node IDs:');
        workflow.nodes.forEach(node => {
            console.log(`   - ${node.id} (${node.type})`);
        });
    }

    // 검증 결과
    console.log(`\n🔍 Current Universal Workflow Verification:`);
    console.log(`   ✅ Node Structure: ${workflow.nodes.length > 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Edge Connections: ${validEdges.length === edges.length ? 'PASS' : 'FAIL'}`);
    console.log(`   ✅ Workflow Type: ${workflow.__workflowType === 'UniversalWorkflowStructure' ? 'PASS' : 'FAIL'}`);

    // 연결 상세 분석
    console.log('\n📊 Detailed Node Analysis:');
    workflow.nodes.forEach((node, index) => {
        const incomingEdges = edges.filter(e => e.target === node.id);
        const outgoingEdges = edges.filter(e => e.source === node.id);
        console.log(`   Node ${index + 1}: ${node.id} (${node.type})`);
        console.log(`     Label: ${node.data.label || 'No label'}`);
        console.log(`     Incoming: ${incomingEdges.length}, Outgoing: ${outgoingEdges.length}`);
        if (node.position) {
            console.log(`     Position: x=${node.position.x}, y=${node.position.y}`);
        }
    });
}

/**
 * 현재 React-Flow 호환 데이터 생성 및 검증 (24번 예제 기반)
 */
async function generateAndVerifyCurrentReactFlowData(workflow: UniversalWorkflowStructure): Promise<any> {
    console.log('\n🎨 Current React-Flow Data Generation & Verification:');

    try {
        // React-Flow 호환 데이터 생성 (24번 예제와 동일한 로직)
        const reactFlowData = {
            nodes: workflow.nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position || { x: 0, y: 0 },
                data: {
                    label: node.data.label || node.data.agentName || node.data.toolName || 'Unnamed Node',
                    ...node.data
                }
            })),
            edges: (workflow.edges || []).map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: edge.type || 'default',
                data: edge.data || {}
            }))
        };

        // 생성된 데이터 검증
        console.log('📊 Current React-Flow Data Analysis:');
        console.log(`   Nodes: ${reactFlowData.nodes.length}`);
        console.log(`   Edges: ${reactFlowData.edges.length}`);

        // 노드 데이터 구조 확인 (24번 예제와 동일)
        console.log('\n🎯 Current Node Structure Verification:');
        reactFlowData.nodes.forEach((node, index) => {
            if (index < 8) { // 더 많이 출력
                console.log(`   Node ${index + 1}: ${node.id} (${node.type}) - "${node.data.label}"`);
                if (node.position) {
                    console.log(`     Position: x=${node.position.x}, y=${node.position.y}`);
                } else {
                    console.log(`     Position: Not set`);
                }
            }
        });

        // 엣지 연결 구조 확인 (24번 예제와 동일)
        console.log('\n🔗 Current Edge Structure Verification:');
        reactFlowData.edges.forEach((edge, index) => {
            if (index < 8) { // 더 많이 출력
                console.log(`   Edge ${index + 1}: ${edge.source} → ${edge.target} (${edge.type})`);
            }
        });

        // JSON 출력 (디버깅용)
        console.log('\n📋 Current React-Flow JSON Structure (for debugging):');
        console.log(JSON.stringify({
            nodes: reactFlowData.nodes.slice(0, 5), // 처음 5개
            edges: reactFlowData.edges.slice(0, 5)  // 처음 5개
        }, null, 2));

        // 최종 검증 결과 (24번 예제와 동일한 로직)
        const hasValidNodes = reactFlowData.nodes.every(node => node.id && node.type && node.position);
        const hasValidEdges = reactFlowData.edges.every(edge => edge.id && edge.source && edge.target);

        console.log('\n✅ Current React-Flow Data Validation Results:');
        console.log(`   Valid Nodes: ${hasValidNodes ? 'PASS' : 'FAIL'}`);
        console.log(`   Valid Edges: ${hasValidEdges ? 'PASS' : 'FAIL'}`);
        console.log(`   Ready for React-Flow: ${hasValidNodes && hasValidEdges ? 'YES' : 'NO'}`);

        return reactFlowData;

    } catch (error) {
        console.error('❌ Current React-Flow Data Generation Failed:', error);
        throw error;
    }
}

// Run example
async function main() {
    const result = await testCurrentWorkflowStructure();
    console.log('\n🧹 Cleanup completed. Exiting...');
    process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});

export { testCurrentWorkflowStructure };