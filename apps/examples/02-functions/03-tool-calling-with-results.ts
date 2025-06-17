/**
 * 03-tool-calling-with-results.ts
 * 
 * This example demonstrates advanced tool calling where:
 * - AI calls tools to get information
 * - Tool results are fed back to the AI
 * - AI processes and summarizes the tool results
 * - Multiple tool calls can be chained together
 */

import { z } from "zod";
import { Robota, OpenAIProvider } from "@robota-sdk/core";
import { createZodFunctionToolProvider } from "@robota-sdk/tools";
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define function tools that return data for AI processing
const tools = {
    // 'getUserInfo' tool: Returns user profile information
    getUserInfo: {
        name: "getUserInfo",
        description: "Retrieves user profile information by user ID.",
        parameters: z.object({
            userId: z.string().describe("User ID to look up"),
        }),
        handler: async (params) => {
            const { userId } = params;
            console.log(`getUserInfo function called: ${userId}`);

            // Simulate database lookup
            const userDatabase = {
                'user123': {
                    name: 'Alice Johnson',
                    email: 'alice@example.com',
                    age: 28,
                    department: 'Engineering',
                    joinDate: '2022-03-15',
                    skills: ['JavaScript', 'Python', 'React', 'Node.js'],
                    projects: ['Project Alpha', 'Project Beta']
                },
                'user456': {
                    name: 'Bob Smith',
                    email: 'bob@example.com',
                    age: 35,
                    department: 'Marketing',
                    joinDate: '2021-08-20',
                    skills: ['Digital Marketing', 'SEO', 'Content Strategy'],
                    projects: ['Campaign X', 'Campaign Y', 'Campaign Z']
                },
                'user789': {
                    name: 'Carol Davis',
                    email: 'carol@example.com',
                    age: 31,
                    department: 'Design',
                    joinDate: '2020-11-10',
                    skills: ['UI/UX Design', 'Figma', 'Adobe Creative Suite'],
                    projects: ['Design System', 'Mobile App Redesign']
                }
            };

            const user = userDatabase[userId];
            if (!user) {
                return { error: `User with ID ${userId} not found` };
            }

            return user;
        }
    },

    // 'getProjectDetails' tool: Returns project information
    getProjectDetails: {
        name: "getProjectDetails",
        description: "Retrieves detailed information about a project.",
        parameters: z.object({
            projectName: z.string().describe("Name of the project to look up"),
        }),
        handler: async (params) => {
            const { projectName } = params;
            console.log(`getProjectDetails function called: ${projectName}`);

            // Simulate project database
            const projectDatabase = {
                'Project Alpha': {
                    name: 'Project Alpha',
                    status: 'In Progress',
                    startDate: '2024-01-15',
                    endDate: '2024-06-30',
                    budget: 150000,
                    team: ['Alice Johnson', 'David Wilson', 'Emma Brown'],
                    description: 'A new web application for customer management',
                    technologies: ['React', 'Node.js', 'PostgreSQL'],
                    progress: 65
                },
                'Project Beta': {
                    name: 'Project Beta',
                    status: 'Planning',
                    startDate: '2024-03-01',
                    endDate: '2024-09-15',
                    budget: 200000,
                    team: ['Alice Johnson', 'Frank Miller'],
                    description: 'Mobile app development for iOS and Android',
                    technologies: ['React Native', 'Firebase', 'TypeScript'],
                    progress: 15
                },
                'Campaign X': {
                    name: 'Campaign X',
                    status: 'Completed',
                    startDate: '2023-10-01',
                    endDate: '2023-12-31',
                    budget: 75000,
                    team: ['Bob Smith', 'Lisa Chen'],
                    description: 'Q4 product launch marketing campaign',
                    technologies: ['Google Ads', 'Facebook Ads', 'Analytics'],
                    progress: 100
                },
                'Design System': {
                    name: 'Design System',
                    status: 'In Progress',
                    startDate: '2023-09-01',
                    endDate: '2024-04-30',
                    budget: 80000,
                    team: ['Carol Davis', 'Michael Johnson'],
                    description: 'Company-wide design system and component library',
                    technologies: ['Figma', 'Storybook', 'CSS-in-JS'],
                    progress: 80
                }
            };

            const project = projectDatabase[projectName];
            if (!project) {
                return { error: `Project ${projectName} not found` };
            }

            return project;
        }
    },

    // 'calculateTeamStats' tool: Calculates statistics for a team
    calculateTeamStats: {
        name: "calculateTeamStats",
        description: "Calculates various statistics for a given team or department.",
        parameters: z.object({
            department: z.string().describe("Department name to calculate stats for"),
            userIds: z.array(z.string()).optional().describe("Optional list of specific user IDs to include"),
        }),
        handler: async (params) => {
            const { department, userIds } = params;
            console.log(`calculateTeamStats function called: ${department}`, userIds);

            // Simulate team statistics calculation
            const departmentStats = {
                'Engineering': {
                    totalMembers: 12,
                    avgAge: 29.5,
                    avgTenure: 2.3,
                    activeProjects: 8,
                    completedProjects: 15,
                    topSkills: ['JavaScript', 'Python', 'React', 'AWS'],
                    avgProjectBudget: 175000
                },
                'Marketing': {
                    totalMembers: 8,
                    avgAge: 32.1,
                    avgTenure: 3.1,
                    activeProjects: 5,
                    completedProjects: 22,
                    topSkills: ['Digital Marketing', 'SEO', 'Content Strategy', 'Analytics'],
                    avgProjectBudget: 65000
                },
                'Design': {
                    totalMembers: 6,
                    avgAge: 30.2,
                    avgTenure: 2.8,
                    activeProjects: 4,
                    completedProjects: 11,
                    topSkills: ['UI/UX Design', 'Figma', 'Adobe Creative Suite', 'Prototyping'],
                    avgProjectBudget: 85000
                }
            };

            const stats = departmentStats[department];
            if (!stats) {
                return { error: `No statistics available for department: ${department}` };
            }

            return {
                ...stats,
                reportDate: new Date().toISOString().split('T')[0],
                calculatedFor: department
            };
        }
    }
};

async function main() {
    try {
        console.log("Tool Calling with Results Processing example started...");

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({
            apiKey
        });

        // Create OpenAI Provider
        const openaiProvider = new OpenAIProvider(openaiClient);

        // Create Zod function tool provider
        const toolProvider = createZodFunctionToolProvider({
            tools
        });

        // Create Robota instance with both AI and tool providers
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4',
            toolProviders: [toolProvider],
            systemPrompt: `You are an AI assistant that helps analyze company data and provide insights. 
            
When users ask about employees, projects, or team statistics, use the available tools to gather information and then provide a comprehensive analysis.

Available tools:
- getUserInfo: Get detailed information about a specific user
- getProjectDetails: Get detailed information about a project  
- calculateTeamStats: Get statistics for a department or team

Always use the tools to get accurate, up-to-date information before providing your analysis. After getting the tool results, provide a well-structured summary with insights and recommendations.`,
            debug: true
        });

        // Test queries that require tool calls and result processing
        const queries = [
            "Can you give me a detailed profile of user123 and tell me about their current projects?",
            "I need a comprehensive analysis of the Engineering department. Get the team stats and also look up user123 who works there.",
            "Compare the Project Alpha and Campaign X projects. What are the key differences in terms of budget, timeline, and team composition?",
            "Analyze the Design department's performance and give me details about Carol Davis who works there."
        ];

        // Process queries sequentially
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`Query ${i + 1}: ${query}`);
            console.log(`${'='.repeat(80)}`);

            const response = await robota.run(query);
            console.log(`\nAI Response:\n${response}`);

            // Add a small delay between queries for better readability
            if (i < queries.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log("\nTool Calling with Results Processing example completed!");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Execute
main().catch(console.error); 