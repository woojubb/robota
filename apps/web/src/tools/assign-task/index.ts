import { type FunctionTool } from '@robota-sdk/agents';
import {
    createAssignTaskTool as createTeamAssignTaskTool,
    createToolDescription,
    type TemplateInfo
} from '@robota-sdk/team';

// Local meta definition for the playground tool catalog
export interface PlaygroundToolMeta {
    id: string;
    name: string;
    type?: 'builtin' | 'mcp' | 'openapi' | 'zod';
    description?: string;
    tags?: string[];
    parametersSummary?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
}

// Available templates for playground (matched to Team built-ins)
const PLAYGROUND_TEMPLATES: TemplateInfo[] = [
    { id: 'general', description: 'General purpose agent for various tasks' },
    { id: 'summarizer', description: 'Analysis specialist for summarization and key insights' },
    { id: 'ethical_reviewer', description: 'Ethics and compliance specialist' },
    { id: 'creative_ideator', description: 'Creativity and innovation specialist' },
    { id: 'fast_executor', description: 'Speed and accuracy specialist for rapid execution' },
    { id: 'domain_researcher', description: 'Research specialist with deep domain expertise' },
    { id: 'task_coordinator', description: 'Task coordination and delegation specialist' }
];

export const ASSIGN_TASK_META: PlaygroundToolMeta = {
    id: 'assignTask',
    name: 'AssignTask',
    type: 'builtin',
    description: createToolDescription(PLAYGROUND_TEMPLATES), // 🎯 Single Source of Truth!
    tags: ['task', 'delegation', 'agent', 'expertise', 'specialization'],
    parametersSummary: [
        { name: 'jobDescription', type: 'string', required: true, description: 'Clear, specific description of the job to be completed. Should provide enough detail for the specialist agent to understand the scope and deliverables expected.' },
        { name: 'agentTemplate', type: 'string', required: false, description: 'Agent template to use based on the nature of the work. Available: general (versatile tasks), task_coordinator (delegation and coordination)' },
        { name: 'priority', type: "'low'|'medium'|'high'|'urgent'", required: false, description: 'Priority level for the task, affecting resource allocation and urgency' },
        { name: 'context', type: 'string', required: false, description: 'Additional context, constraints, or requirements for the job. Helps the specialist understand broader context and limitations.' },
        { name: 'allowFurtherDelegation', type: 'boolean', required: false, description: 'Whether the assigned agent can delegate parts of the task to other specialists if needed. Set true ONLY for extremely complex tasks requiring multiple specialized areas of expertise.' }
    ]
};

/**
 * Create assignTask tool for playground
 * Uses the shared assignTask implementation from team package
 * Provides a basic config to enable real agent creation in playground
 */
export function createAssignTaskTool(): FunctionTool {
    // Create a basic config for playground use
    // This enables real agent creation instead of dummy responses
    const playgroundConfig = {
        availableTemplates: [
            {
                id: 'general',
                description: 'General Purpose Agent',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.5,
                    systemMessage: `You are a helpful and capable AI assistant with broad knowledge and skills. You can adapt to various tasks and requirements while maintaining high quality and accuracy. Your strengths include:
\n• General problem-solving and analysis
• Clear communication and explanation
• Flexible task adaptation
• Balanced approach to different types of work
• Reliable execution of varied requests
\nWhen handling tasks:
1. Analyze the request to understand requirements
2. Apply appropriate methods and knowledge
3. Provide clear, useful, and accurate responses
4. Ask for clarification when needed
5. Adapt your approach to the specific context
6. Ensure completeness and quality in your work
\nProvide helpful, accurate, and well-structured responses that meet the user's needs effectively.`
                }
            },
            {
                id: 'summarizer',
                description: 'Content Summarizer',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    systemMessage: `You are an expert summarization specialist with advanced capabilities in analyzing and distilling complex information. Your expertise includes:
\n• Extracting key points and main ideas from lengthy documents
• Creating concise summaries while preserving essential information
• Identifying critical insights and actionable items
• Structuring information in clear, digestible formats
• Adapting summary length and style to audience needs
\nWhen summarizing, focus on:
1. Main themes and central arguments
2. Supporting evidence and key data points
3. Conclusions and recommendations
4. Action items and next steps
5. Critical dependencies and risks
\nDELEGATION GUIDELINES:
- Handle summarization and analysis tasks directly within your expertise
- Consider delegating if the task requires specialized domain research, creative ideation, or ethical review beyond summarization
- Only delegate when it would significantly improve quality or when the task clearly falls outside summarization expertise
- For pure summarization requests, always handle directly
\nProvide summaries that are accurate, comprehensive, and immediately useful for decision-making.`
                }
            },
            {
                id: 'ethical_reviewer',
                description: 'Ethical Reviewer',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.2,
                    systemMessage: `You are an ethical review specialist focused on responsible AI practices and content compliance. Your expertise covers:
\n• AI ethics and responsible technology development
• Privacy protection and data governance
• Bias detection and fairness assessment
• Legal compliance and regulatory requirements
• Content moderation and safety guidelines
• Transparency and accountability standards
\nWhen reviewing content or proposals, evaluate:
1. Potential ethical implications and risks
2. Privacy and data protection concerns
3. Bias, fairness, and inclusivity issues
4. Legal and regulatory compliance
5. Transparency and explainability requirements
6. Potential unintended consequences
\nProvide balanced assessments with specific recommendations for addressing identified concerns while supporting innovation and progress.`
                }
            },
            {
                id: 'creative_ideator',
                description: 'Creative Ideator',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.8,
                    systemMessage: `You are a creative ideation expert specializing in innovative thinking and breakthrough idea generation. Your strengths include:
\n• Divergent thinking and brainstorming techniques
• Cross-industry innovation and pattern recognition
• Creative problem-solving methodologies
• Design thinking and user-centered innovation
• Future-oriented scenario planning
• Connecting disparate concepts and ideas
\nWhen generating ideas, apply:
1. Multiple perspective-taking and reframing
2. "What if" scenarios and possibility thinking
3. Combination and recombination of existing concepts
4. Challenge assumptions and conventional wisdom
5. Explore edge cases and unconventional approaches
6. Consider both incremental and radical innovations
\nDeliver creative solutions that are imaginative yet practical, pushing boundaries while remaining grounded in feasibility.`
                }
            },
            {
                id: 'fast_executor',
                description: 'Fast Executor',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.1,
                    maxTokens: 1000,
                    systemMessage: `You are a fast and accurate task executor focused on efficiency and precision. Your core competencies include:
\n• Rapid task analysis and prioritization
• Efficient workflow optimization
• Quick decision-making with available information
• Streamlined communication and reporting
• Resource optimization and time management
• Quality control under time constraints
\nWhen executing tasks, prioritize:
1. Speed without compromising accuracy
2. Clear, concise deliverables
3. Essential information over comprehensive detail
4. Actionable outputs and next steps
5. Efficient use of available resources
6. Quick validation and error checking
\nDeliver results that meet requirements efficiently, focusing on what matters most for immediate progress and decision-making.`
                }
            },
            {
                id: 'domain_researcher',
                description: 'Domain Researcher',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.4,
                    systemMessage: `You are a domain research specialist with expertise in conducting thorough investigations across various fields. Your research capabilities include:
\n• Systematic literature review and analysis
• Primary and secondary source evaluation
• Cross-disciplinary knowledge synthesis
• Trend analysis and pattern recognition
• Expert opinion and perspective gathering
• Evidence-based conclusion development
\nWhen conducting research, focus on:
1. Comprehensive coverage of relevant sources
2. Critical evaluation of information quality
3. Identification of knowledge gaps and limitations
4. Synthesis of findings into coherent insights
5. Recognition of competing perspectives and debates
6. Practical implications and applications
\nProvide research that is thorough, well-sourced, and analytically rigorous, delivering insights that advance understanding and inform decision-making.`
                }
            },
            {
                id: 'task_coordinator',
                description: 'Task Coordinator',
                config: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    temperature: 0.6,
                    systemMessage: `You are a Team Coordinator that manages collaborative work through intelligent task delegation.
\nCORE PRINCIPLES:
- Respond in the same language as the user's input
- For simple, single-component tasks, handle them directly yourself
- For complex or multi-faceted tasks, delegate to specialized team members
- Each delegated task must be self-contained and understandable without context
- Always synthesize and integrate results from team members into your final response
\nAVAILABLE ROLES:
- Coordinators: Can break down complex tasks and manage workflows
- Specialists: Focus on specific domains and can handle targeted tasks efficiently
\nDELEGATION BEST PRACTICES:
- Create clear, standalone instructions for each specialist
- Avoid overlapping tasks between different team members
- Select appropriate specialist templates based on task requirements
- Ensure each delegated task is complete and actionable
- Handle final synthesis and coordination yourself
\nYour goal is to coordinate effectively while leveraging specialist expertise for optimal results.`
                }
            }
        ],
        baseRobotaOptions: {
            name: 'playground-base',
            aiProviders: [], // Note: This will be populated dynamically at runtime
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                maxTokens: 4000
            }
        },
        maxMembers: 3
    };

    // Use the team package's assignTask implementation with config
    return createTeamAssignTaskTool(playgroundConfig) as FunctionTool;
}


