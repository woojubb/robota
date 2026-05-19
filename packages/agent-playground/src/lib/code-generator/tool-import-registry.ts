export interface IToolImportEntry {
  importPath: string;
  factoryName: string;
}

const TOOL_IMPORTS: Record<string, IToolImportEntry> = {
  'current-time': {
    importPath: '@robota-sdk/agent-tools',
    factoryName: 'createCurrentTimeTool',
  },
  assignTask: {
    importPath: '@robota-sdk/agent-team',
    factoryName: 'createAssignTaskRelayTool',
  },
};

export function getToolImportEntry(toolId: string): IToolImportEntry | undefined {
  return TOOL_IMPORTS[toolId];
}
