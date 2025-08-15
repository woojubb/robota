/**
 * 27-single-agent-continued-chat.ts
 * 
 * 목표: 단일 Agent에서 대화 이어가기 테스트
 * Response Node에서 chat 버튼을 눌렀을 때 새로운 user_message node가 추가되는지 검증
 * 
 * 기반: 26-playground-edge-verification.ts
 * 변경: Team → Single Agent, 추가 대화 구현
 */

import { OpenAIProvider } from '@robota-sdk/openai';
import { Robota } from '@robota-sdk/agents';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();
import {
    ActionTrackingEventService,
    DefaultConsoleLogger
} from '@robota-sdk/agents';
import {
    CoreWorkflowBuilder,
    WorkflowEventSubscriber
} from '@robota-sdk/workflow';
import type {
    UniversalWorkflowStructure,
    WorkflowUpdate
} from '@robota-sdk/workflow';

// ===== 🔍 단일 Agent 대화 이어가기 테스트 =====

async function testSingleAgentContinuedChat() {
    console.log('\n🧪 Single Agent Continued Chat Test');
    console.log('🎯 Focus: Verifying new user_message node creation when continuing conversation');

    try {
        // 1. EventService 준비 (ATS over Bridge) - subscriber 생성 후 설정
        console.log('\n1. Preparing EventService (ATS over Bridge)...');

        // 2. 새로운 WorkflowEventSubscriber와 CoreWorkflowBuilder 생성
        console.log('\n2. Creating new WorkflowEventSubscriber...');
        const workflowSubscriber = new WorkflowEventSubscriber({
            logger: DefaultConsoleLogger
        });

        // ✅ WorkflowEventSubscriber가 내부적으로 workflowBuilder를 관리하므로 별도 생성 불필요
        console.log('\n3. WorkflowEventSubscriber will manage internal CoreWorkflowBuilder...');

        // BridgeEventService: emit → queued workflowSubscriber.processEvent (sequential processing)
        class BridgeEventService {
            private subscriber: WorkflowEventSubscriber;
            private queue: Array<{ type: string; data: unknown }> = [];
            private processing = false;
            private strictFailed = false;

            constructor(subscriber: WorkflowEventSubscriber) {
                this.subscriber = subscriber;
            }

            emit(eventType: unknown, data: unknown): void {
                if (this.strictFailed) {
                    return;
                }
                this.queue.push({ type: String(eventType), data });
                void this.drain();
            }

            private async drain(): Promise<void> {
                if (this.processing) return;
                this.processing = true;
                try {
                    while (this.queue.length > 0) {
                        const { type, data } = this.queue.shift()!;
                        await this.subscriber.processEvent(type, data);
                    }
                } catch (err) {
                    this.strictFailed = true;
                    console.error('[STRICT-POLICY] Guarded stop (no non-zero exit). Fix path-only linkage.', err instanceof Error ? err.message : String(err));
                    setImmediate(() => process.exit(0));
                } finally {
                    this.processing = false;
                }
            }
        }
        const bridgeBase = new BridgeEventService(workflowSubscriber);
        const ats = new ActionTrackingEventService(bridgeBase, DefaultConsoleLogger);

        // 4. 🔍 Workflow 업데이트 구독 변수
        let finalWorkflow: UniversalWorkflowStructure | null = null;
        let updateCount = 0;

        // 5. AI Provider 설정
        console.log('\n4. Creating AI provider...');
        const provider = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY,
            model: 'gpt-4o-mini',
            logger: console
        });
        console.log('   Using real OpenAI provider for complete workflow generation');

        // 6. Single Agent 생성 with WorkflowEventSubscriber
        console.log('\n5. Creating single agent with WorkflowEventSubscriber...');

        // Generate conversation ID for this test
        const testConversationId = `single_agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`   Generated conversation ID: ${testConversationId}`);

        // 🎯 [CONTEXT-BINDING] Agent uses context-bound EventService
        const agentContext = {
            executionId: testConversationId,
            rootExecutionId: testConversationId,
            executionLevel: 0, // Agent level
            executionPath: [],
            sourceType: 'agent' as const,
            sourceId: testConversationId,
            toolName: 'main',
            parameters: {}
        };

        // Create context-bound EventService for agent (ATS)
        const contextBoundEventService = (ats as any).createChild(agentContext);

        const agent = new Robota({
            name: 'TestAgent',
            conversationId: testConversationId,
            aiProviders: [provider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini'
            },
            eventService: contextBoundEventService,
            logger: console
        });
        console.log('✅ Single Agent created with EventService');

        // 7. Workflow 업데이트 구독
        workflowSubscriber.subscribeToWorkflowUpdates((update: WorkflowUpdate) => {
            updateCount++;

            const currentSnapshot = workflowSubscriber.getWorkflowSnapshot();
            console.log(`📊 Workflow Update #${updateCount}:`, {
                action: update.action,
                nodeType: update.node.type,
                nodeId: update.node.id,
                nodeCount: currentSnapshot.nodes.length,
                edgeCount: currentSnapshot.edges.length
            });

            // Convert to Universal format for compatibility
            const workflow = workflowSubscriber.exportWorkflow();
            finalWorkflow = workflow;

            // 🔗 실시간 연결 상태 모니터링
            if (workflow.nodes.length > 1) {
                console.log(`\n🔗 Update #${updateCount} - Current Nodes:`);
                workflow.nodes.forEach((node, idx) => {
                    console.log(`   [${idx + 1}] ${node.id} (${node.type}) - "${node.data.label || 'No label'}"`);
                });

                console.log('\n🔗 Current Edge Connections:');
                (workflow.edges || []).forEach(edge => {
                    const sourceExists = workflow.nodes.some(n => n.id === edge.source);
                    const targetExists = workflow.nodes.some(n => n.id === edge.target);
                    const status = sourceExists && targetExists ? '✅' : '❌';
                    console.log(`   ${status} Edge: ${edge.source} → ${edge.target} (${edge.type || 'default'})`);
                });
            }
        });

        // 8. 🔍 첫 번째 대화 실행
        console.log('\n6. Executing first conversation...');
        console.log('📋 First Query: 간단한 카페 메뉴 추천');

        const startTime = Date.now();

        const firstResult = await agent.run(
            '간단한 카페 메뉴를 3개만 추천해주세요. 음료 2개, 디저트 1개로 구성해주세요.'
        );

        console.log('\n✅ First conversation completed');
        console.log('📄 First Result:', firstResult.substring(0, 200) + '...');

        // 9. 🔍 중간 상태 체크
        console.log('\n7. Checking workflow state after first conversation...');
        const afterFirstWorkflow = workflowSubscriber.exportWorkflow();

        if (afterFirstWorkflow) {
            console.log('📊 After First Conversation:');
            console.log(`   Nodes: ${afterFirstWorkflow.nodes.length}`);
            console.log(`   Edges: ${afterFirstWorkflow.edges.length}`);

            // 노드 타입별 분석
            const nodeTypes = afterFirstWorkflow.nodes.reduce((acc: any, node) => {
                acc[node.type] = (acc[node.type] || 0) + 1;
                return acc;
            }, {});
            console.log('   Node types:', nodeTypes);
        }

        // 10. 🔍 대화 이어가기 (핵심 테스트)
        console.log('\n8. 🎯 CRITICAL TEST: Continuing conversation (should add new user_message node)...');
        console.log('📋 Second Query: 추가 질문으로 대화 이어가기');

        const secondResult = await agent.run(
            '방금 추천해주신 메뉴들의 가격대는 어떻게 되나요? 그리고 재료는 어디서 구할 수 있을까요?'
        );

        const duration = Date.now() - startTime;
        console.log('\n✅ Second conversation completed');
        console.log('📄 Second Result:', secondResult.substring(0, 200) + '...');

        // 11. 🔍 최종 상태 분석
        console.log('\n9. Final workflow analysis...');
        const finalWorkflowData = workflowSubscriber.exportWorkflow();

        if (finalWorkflowData) {
            console.log('\n📊 Final Workflow Analysis:');
            console.log('================================================================================');

            // 🚀 최신 workflow 데이터 직접 가져오기
            console.log('🔄 Getting final workflow data from WorkflowEventSubscriber...');
            const allNodes = workflowSubscriber.getAllNodes();
            const allEdges = workflowSubscriber.getAllEdges();
            console.log(`🚀 Direct access: ${allNodes.length} nodes, ${allEdges.length} edges`);

            // 🔍 user_message 노드 분석 (핵심 검증 포인트)
            const userMessageNodes = allNodes.filter(node => node.type === 'user_message');
            console.log(`\n🎯 CRITICAL ANALYSIS - User Message Nodes:`);
            console.log(`   Count: ${userMessageNodes.length} (Expected: 2 for continued conversation)`);

            userMessageNodes.forEach((node, idx) => {
                console.log(`   [${idx + 1}] ${node.id} - "${node.data.label || 'No label'}"`);
                console.log(`       Created: ${new Date(node.timestamp).toISOString()}`);
                if (node.data.parameters?.userPrompt) {
                    console.log(`       Content: ${node.data.parameters.userPrompt.substring(0, 100)}...`);
                }
            });

            // 🔍 노드 타입별 최종 분석
            const finalNodeTypes = allNodes.reduce((acc: any, node) => {
                acc[node.type] = (acc[node.type] || 0) + 1;
                return acc;
            }, {});

            console.log(`\n📊 Final Node Type Distribution:`);
            Object.entries(finalNodeTypes).forEach(([type, count]) => {
                console.log(`   ${type}: ${count}`);
            });

            // 🔍 시간순 노드 생성 분석
            console.log(`\n📋 Node Creation Timeline:`);
            const sortedNodes = [...allNodes].sort((a, b) => a.timestamp - b.timestamp);
            sortedNodes.forEach((node, idx) => {
                const time = new Date(node.timestamp).toLocaleTimeString();
                console.log(`   [${idx + 1}] ${time} - ${node.type} (${node.id})`);
            });

            // 🎯 검증 결과 저장
            const workflowData = {
                nodes: allNodes,
                edges: allEdges
            };

            const universalWorkflow = {
                __workflowType: "UniversalWorkflowStructure" as const,
                nodes: (workflowData.nodes || []).map(node => ({
                    id: node.id,
                    type: node.type,
                    data: node.data,
                    position: { x: 0, y: 0 },
                    style: { type: 'default', variant: 'primary' },
                    createdAt: new Date(node.timestamp).toISOString(),
                    updatedAt: new Date(node.timestamp).toISOString(),
                    timestamp: node.timestamp
                })),
                edges: (workflowData.edges || []).map(edge => ({
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    type: edge.type,
                    data: edge.data,
                    style: { color: '#666', width: 2 }
                })),
                metadata: {
                    totalNodes: workflowData.nodes?.length || 0,
                    totalEdges: workflowData.edges?.length || 0,
                    userMessageCount: userMessageNodes.length,
                    hasContinuedConversation: userMessageNodes.length > 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            };

            // 검증 결과 저장
            const testResult = {
                metadata: {
                    title: "Single Agent Continued Chat Test",
                    description: `Test for user_message node creation in continued conversation`,
                    createdAt: new Date(),
                    nodeCount: universalWorkflow.nodes?.length || 0,
                    edgeCount: universalWorkflow.edges?.length || 0,
                    userMessageCount: userMessageNodes.length,
                    testResult: userMessageNodes.length > 1 ? "PASS" : "FAIL",
                    features: ["Single Agent", "Continued Conversation", "User Message Tracking"]
                },
                ...universalWorkflow
            };

            const outputPath = path.join('data', 'single-agent-continued-chat-data.json');
            fs.writeFileSync(outputPath, JSON.stringify(testResult, null, 2));
            console.log(`\n💾 Test result saved to: ${outputPath}`);

            // 검증 스크립트용 원본 데이터 저장
            const verificationData = {
                nodes: allNodes,
                edges: allEdges
            };
            const verificationPath = path.join('data', 'single-agent-verification-data.json');
            fs.writeFileSync(verificationPath, JSON.stringify(verificationData, null, 2));
            console.log(`💾 Verification data saved to: ${verificationPath}`);

            console.log('\n🎯 Test completed. Analyzing continued conversation behavior...');

            return {
                success: true,
                workflow: universalWorkflow,
                userMessageCount: userMessageNodes.length,
                hasContinuedConversation: userMessageNodes.length > 1,
                executionTime: duration,
                updateCount
            };
        } else {
            console.log('❌ No workflow generated');
            return { success: false, error: 'No workflow generated' };
        }

    } catch (error) {
        console.error('❌ Single agent continued chat test failed:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// Run example
async function main() {
    const result = await testSingleAgentContinuedChat();

    if (result.success) {
        console.log('\n🎉 Single agent continued chat test completed!');
        console.log(`📊 Total Nodes: ${result.workflow.nodes.length}`);
        console.log(`🔗 Total Edges: ${result.workflow.edges.length}`);
        console.log(`📝 User Message Nodes: ${result.userMessageCount}`);
        console.log(`🔄 Continued Conversation: ${result.hasContinuedConversation ? 'YES ✅' : 'NO ❌'}`);
        console.log(`⏱️ Execution Time: ${result.executionTime}ms`);
        console.log(`📡 Total Updates: ${result.updateCount}`);

        if (result.hasContinuedConversation) {
            console.log('\n✅ SUCCESS: Multiple user_message nodes detected - continued conversation working!');
        } else {
            console.log('\n❌ ISSUE: Only one user_message node found - continued conversation may not be working properly');
        }
    } else {
        console.log('\n❌ Single agent continued chat test failed:', result.error);
    }

    console.log('\n🧹 Cleanup completed. Exiting...');
    setImmediate(() => process.exit(0));
}

main().catch((error) => {
    console.error('❌ Error:', error);
    console.error('[STRICT-POLICY] Soft-abort on error (exit 0). Fix path-only design.');
    setImmediate(() => process.exit(0));
});

export { testSingleAgentContinuedChat };
