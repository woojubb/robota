import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 실제 WorkflowNode 데이터를 UniversalWorkflowStructure로 변환
async function convertToUniversal() {
    // 실제 워크플로우 데이터 로드
    const realDataPath = path.join(__dirname, '../data/real-workflow-data.json');
    const realData = JSON.parse(fs.readFileSync(realDataPath, 'utf-8'));

    console.log('🔄 Converting real workflow data to Universal format...');
    console.log(`📊 Total nodes: ${realData.metadata.metrics.totalNodes}`);

    // Team 2 노드 사용 (더 복잡한 워크플로우)
    const nodes = realData.team2.nodes;

    // UniversalWorkflowNode로 변환
    const universalNodes = nodes.map((node: any, index: number) => {
        const universalNode = {
            id: node.id,
            type: node.type,
            level: node.level || 1,
            position: {
                level: node.level || 1,
                order: index,
                x: index * 150,
                y: (node.level || 1) * 150
            },
            dimensions: {
                width: 150,
                height: 50
            },
            visualState: {
                status: node.status === 'completed' ? 'completed' : 'running',
                emphasis: 'normal',
                lastUpdated: new Date().toISOString()
            },
            data: {
                label: node.data.label || node.type,
                eventType: node.data.eventType,
                sourceId: node.data.sourceId,
                sourceType: node.data.sourceType || 'agent',
                executionId: node.data.executionId || 'unknown',
                ...node.data,
                icon: getNodeIcon(node.type),
                color: getNodeColor(node.type),
                extensions: {
                    robota: {
                        originalType: node.type,
                        originalData: node.data
                    }
                }
            },
            interaction: {
                selectable: true,
                draggable: true,
                deletable: false,
                clickable: true
            },
            createdAt: node.timestamp || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (node.parentId) {
            universalNode['parentId'] = node.parentId;
        }

        return universalNode;
    });

    // 연결 정보 생성
    const universalEdges: any[] = [];
    let edgeIndex = 0;

    nodes.forEach((node: any) => {
        if (node.connections && node.connections.length > 0) {
            node.connections.forEach((connection: any) => {
                const edge = {
                    id: `edge-${connection.fromId}-${connection.toId}-${edgeIndex}`,
                    source: connection.fromId,
                    target: connection.toId,
                    type: connection.type,
                    label: connection.label || connection.type,
                    style: {
                        type: getEdgeStyle(connection.type),
                        animated: isAnimatedEdge(connection.type),
                        strokeColor: getEdgeColor(connection.type)
                    },
                    data: {
                        executionOrder: edgeIndex,
                        extensions: {
                            robota: {
                                originalType: connection.type,
                                originalConnection: connection
                            }
                        }
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                universalEdges.push(edge);
                edgeIndex++;
            });
        }
    });

    // UniversalWorkflowStructure 생성
    const universalStructure = {
        __workflowType: "UniversalWorkflowStructure",
        id: "team-collaboration-real-success",
        name: "Real Team Collaboration Success - Merge Results Connected",
        description: "Actual workflow data from 05-team-collaboration-ko.ts execution",
        metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metrics: {
                totalNodes: universalNodes.length,
                totalEdges: universalEdges.length
            },
            testType: "real-team-collaboration-success",
            sourceExample: "05-team-collaboration-ko.ts",
            workflowDescription: "Real execution data showing Agent 0 Merge Results → Agent 1/2 Responses connections"
        },
        nodes: universalNodes,
        edges: universalEdges,
        layout: {
            algorithm: "hierarchical",
            direction: "TB",
            spacing: {
                nodeSpacing: 200,
                levelSpacing: 150
            },
            alignment: {
                horizontal: "center",
                vertical: "top"
            }
        }
    };

    // 파일 저장
    const outputPath = path.join(__dirname, '../web/public/perfect-playground-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(universalStructure, null, 2));

    console.log('✅ Conversion completed!');
    console.log(`📁 Output: ${outputPath}`);
    console.log(`📊 Converted: ${universalNodes.length} nodes, ${universalEdges.length} edges`);

    // Merge Results 연결 검증
    const mergeResultsNodes = universalNodes.filter(n => n.type === 'merge_results');
    const agentResponseNodes = universalNodes.filter(n => n.type === 'response');

    console.log(`\n🔍 Verification:`);
    console.log(`   Merge Results nodes: ${mergeResultsNodes.length}`);
    console.log(`   Agent Response nodes: ${agentResponseNodes.length}`);

    mergeResultsNodes.forEach(mergeNode => {
        const connections = universalEdges.filter(edge => edge.target === mergeNode.id);
        console.log(`   ${mergeNode.id} has ${connections.length} incoming connections`);
        connections.forEach(conn => {
            console.log(`     ← ${conn.source} (${conn.type})`);
        });
    });
}

function getNodeIcon(type: string): string {
    const icons: Record<string, string> = {
        'agent': '🤖',
        'user_input': '👤',
        'agent_thinking': '💭',
        'tool_call': '⚡',
        'tool_call_response': '⚪',
        'response': '⚪',
        'merge_results': '🔀'
    };
    return icons[type] || '⭕';
}

function getNodeColor(type: string): string {
    const colors: Record<string, string> = {
        'agent': '#2196F3',
        'user_input': '#4CAF50',
        'agent_thinking': '#607D8B',
        'tool_call': '#9C27B0',
        'tool_call_response': '#9E9E9E',
        'response': '#9E9E9E',
        'merge_results': '#4CAF50'
    };
    return colors[type] || '#757575';
}

function getEdgeStyle(type: string): string {
    const styles: Record<string, string> = {
        'processes': 'step',
        'executes': 'straight',
        'creates': 'straight',
        'consolidates': 'straight',
        'return': 'bezier',
        'result': 'default'
    };
    return styles[type] || 'straight';
}

function isAnimatedEdge(type: string): boolean {
    const animated = ['processes', 'executes', 'consolidates'];
    return animated.includes(type);
}

function getEdgeColor(type: string): string {
    const colors: Record<string, string> = {
        'processes': '#4CAF50',
        'executes': '#2196F3',
        'creates': '#2196F3',
        'consolidates': '#4CAF50',
        'return': '#9C27B0',
        'result': '#9E9E9E'
    };
    return colors[type] || '#757575';
}

// 실행
convertToUniversal().catch(console.error);