import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TTrustLevel } from '../types.js';
import type { IProjectInfo } from './project-detector.js';
import { composeSystemPrompt } from './system-prompt-composer.js';
import {
  createAgentsMdSection,
  createCapabilitySection,
  createClaudeMdSection,
  createFrameworkSection,
  createPermissionSection,
  createProjectSection,
  createProviderWebSearchSection,
  createToolDescriptionSection,
  createWorkingDirectorySection,
} from './system-prompt-section-providers.js';
import type { ISystemPromptSection } from './system-prompt-types.js';

export interface ISystemPromptParams {
  /** Concatenated AGENTS.md content (may be empty string) */
  agentsMd: string;
  /** Concatenated CLAUDE.md content (may be empty string) */
  claudeMd: string;
  /** Human-readable tool descriptions, one per entry */
  toolDescriptions: string[];
  /** Active trust level governing permission checks */
  trustLevel: TTrustLevel;
  /** Detected project metadata */
  projectInfo: IProjectInfo;
  /** Current working directory */
  cwd?: string;
  /** Response language code (e.g., "ko", "en"). If set, AI must respond in this language. */
  language?: string;
  /** Discovered skills to expose in the system prompt */
  skills?: Array<{ name: string; description: string; disableModelInvocation?: boolean }>;
  /** Discovered agents to expose in the system prompt */
  agents?: Array<{ name: string; description: string }>;
  /** Command descriptors to expose to the model */
  commandDescriptors?: ICapabilityDescriptor[];
}

function appendOptionalSection(
  sections: ISystemPromptSection[],
  section: ISystemPromptSection | undefined,
): void {
  if (section !== undefined) sections.push(section);
}

function mapSkillDescriptors(
  skills: NonNullable<ISystemPromptParams['skills']>,
): ICapabilityDescriptor[] {
  return skills.map((skill) => ({
    name: skill.name,
    kind: 'skill',
    description: skill.description,
    userInvocable: true,
    modelInvocable: skill.disableModelInvocation !== true,
  }));
}

function mapAgentDescriptors(
  agents: NonNullable<ISystemPromptParams['agents']>,
): ICapabilityDescriptor[] {
  return agents.map((agent) => ({
    name: agent.name,
    kind: 'agent',
    description: agent.description,
    userInvocable: false,
    modelInvocable: true,
    safety: 'background-agent',
  }));
}

function buildCapabilityDescriptors(params: ISystemPromptParams): ICapabilityDescriptor[] {
  return [
    ...(params.commandDescriptors ?? []),
    ...(params.skills ? mapSkillDescriptors(params.skills) : []),
    ...(params.agents ? mapAgentDescriptors(params.agents) : []),
  ];
}

export function buildSystemPrompt(params: ISystemPromptParams): string {
  const sections: ISystemPromptSection[] = [
    createFrameworkSection(params.language),
    createProjectSection(params.projectInfo),
    createPermissionSection(params.trustLevel),
    createProviderWebSearchSection(),
  ];

  appendOptionalSection(sections, createWorkingDirectorySection(params.cwd));
  appendOptionalSection(sections, createAgentsMdSection(params.agentsMd));
  appendOptionalSection(sections, createClaudeMdSection(params.claudeMd));
  appendOptionalSection(sections, createToolDescriptionSection(params.toolDescriptions));
  appendOptionalSection(sections, createCapabilitySection(buildCapabilityDescriptors(params)));

  return composeSystemPrompt(sections);
}
