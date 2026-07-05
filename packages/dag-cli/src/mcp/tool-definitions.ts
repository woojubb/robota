/** TOOL_DEFINITIONS: all MCP tool schemas for the robota-dag local MCP server. */

export const TOOL_DEFINITIONS = [
  {
    name: 'dag_nodes_list',
    description: 'Return all available node manifests (nodeType, displayName, category).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dag_node_packages_list',
    description:
      'Discover third-party node packages installed in node_modules that declare the "robota-dag-node" npm keyword. Returns package name, version, description, and the node types they provide.',
    inputSchema: {
      type: 'object',
      properties: {
        searchRoots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of directory paths to search for node_modules. Defaults to the current working directory.',
        },
      },
    },
  },
  {
    name: 'dag_nodes_info',
    description: 'Return full manifest for a specific node type.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: { type: 'string', description: 'The node type identifier' },
      },
      required: ['nodeType'],
    },
  },
  {
    name: 'dag_run_definition',
    description: 'Run a DAG definition object in-process.',
    inputSchema: {
      type: 'object',
      properties: {
        definition: { type: 'object', description: 'The IDagDefinition JSON object' },
        inputs: { type: 'object', description: 'Optional input port payload' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
      },
      required: ['definition'],
    },
  },
  {
    name: 'dag_run_file',
    description: 'Read a .dag.json file and run it in-process.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the .dag.json file' },
        inputs: { type: 'object', description: 'Optional input port payload' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
      },
      required: ['file'],
    },
  },
  {
    name: 'dag_validate',
    description:
      'Validate a DAG definition: check for unknown node types, cycles, missing input/output nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        definition: { type: 'object', description: 'The IDagDefinition JSON object' },
      },
      required: ['definition'],
    },
  },
  {
    name: 'dag_build',
    description:
      'Build an IDagDefinition from a declarative pipeline array. Edges are auto-wired using defaultInputPort/defaultOutputPort. Returns the completed definition ready to pass to dag_run_definition.',
    inputSchema: {
      type: 'object',
      properties: {
        dagId: { type: 'string', description: 'Optional dag id (default: dag-build-result)' },
        pipeline: {
          type: 'array',
          description:
            'Ordered pipeline stages. Each stage is either a node spec {nodeType, id?, config?, fromPort?, toPort?} or a parallel spec {parallel: [...nodeSpecs]}.',
          items: { type: 'object' },
        },
      },
      required: ['pipeline'],
    },
  },
  {
    name: 'dag_catalog_list',
    description: 'List all DAG workflows in the local .dag/workflows catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogDir: {
          type: 'string',
          description: 'Override catalog directory (default: .dag/workflows)',
        },
      },
    },
  },
  {
    name: 'dag_catalog_search',
    description: 'Search DAG catalog entries by id, description, or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        catalogDir: {
          type: 'string',
          description: 'Override catalog directory (default: .dag/workflows)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'dag_catalog_run',
    description: 'Run a DAG workflow from the local catalog by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow id (filename without .dag.json)' },
        inputs: { type: 'object', description: 'Optional input port payload' },
        timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds' },
        catalogDir: {
          type: 'string',
          description: 'Override catalog directory (default: .dag/workflows)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'dag_instant_node_create',
    description:
      'Create a prompt-backed instant node and register it for use in dag_build/dag_run_definition. The node executes by rendering its systemPromptTemplate with input port values and calling an LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: {
          type: 'string',
          description: 'Unique identifier for the new node type (e.g. "legal-summarizer")',
        },
        displayName: { type: 'string', description: 'Human-readable label' },
        systemPromptTemplate: {
          type: 'string',
          description: 'Prompt template. Use {{portKey}} placeholders for input port values.',
        },
        inputPorts: {
          type: 'array',
          description: 'Input ports (all string type)',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['key'],
          },
        },
        outputPort: {
          type: 'object',
          description: 'Single output port',
          properties: {
            key: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['key'],
        },
        provider: {
          type: 'string',
          enum: ['anthropic', 'openai', 'gemini', 'deepseek', 'qwen'],
          description: 'LLM provider (default: anthropic)',
        },
        model: { type: 'string', description: 'Model override (default: provider default)' },
      },
      required: ['nodeType', 'displayName', 'systemPromptTemplate', 'inputPorts', 'outputPort'],
    },
  },
  {
    name: 'dag_instant_node_create_composite',
    description:
      'Create a composite instant node that wraps an inner DAG as a single reusable node. The node exposes a single input port and one or more output ports mapped to inner-DAG node outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: {
          type: 'string',
          description:
            'Unique identifier for the new composite node type (e.g. "research-pipeline")',
        },
        displayName: { type: 'string', description: 'Human-readable label' },
        innerDag: {
          type: 'object',
          description: 'The IDagDefinition that will run as the inner pipeline',
        },
        exposedInputPort: {
          type: 'object',
          description: 'The single input port visible to the outer DAG',
          properties: {
            key: { type: 'string', description: 'Port key visible on this composite node' },
            mapsTo: {
              type: 'object',
              properties: {
                nodeId: {
                  type: 'string',
                  description: 'Inner DAG node ID to receive this input',
                },
                portKey: { type: 'string', description: 'Port key on that inner node' },
              },
              required: ['nodeId', 'portKey'],
            },
            description: { type: 'string' },
          },
          required: ['key', 'mapsTo'],
        },
        exposedOutputPorts: {
          type: 'array',
          description:
            'Output ports visible to the outer DAG, each mapped from an inner-DAG node output',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              mapsTo: {
                type: 'object',
                properties: {
                  nodeId: { type: 'string' },
                  portKey: { type: 'string' },
                },
                required: ['nodeId', 'portKey'],
              },
              description: { type: 'string' },
            },
            required: ['key', 'mapsTo'],
          },
        },
      },
      required: ['nodeType', 'displayName', 'innerDag', 'exposedInputPort', 'exposedOutputPorts'],
    },
  },
  {
    name: 'dag_instant_node_list',
    description: 'List all instant nodes registered in this session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dag_templates_list',
    description: 'List all built-in DAG topology templates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dag_runs_poll_progress',
    description:
      'Poll the execution status of a completed or in-progress DAG run. In local mode, runs are synchronous so this returns the stored result for any previously completed run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The dagRunId returned by dag_run_definition' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'dag_runs_cancel',
    description:
      'Cancel a DAG run. In local mode, runs complete synchronously; this returns the stored result with a cancelled status if the run exists but was already completed.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The dagRunId to cancel' },
        reason: { type: 'string', description: 'Optional reason for cancellation (for audit)' },
      },
      required: ['runId'],
    },
  },
  {
    name: 'dag_build_from_template',
    description:
      'Fill a named topology template with slot values and return a completed IDagDefinition. Equivalent to calling dag_build with the generated pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'Template id (e.g. "linear", "chain", "parallel-review")',
        },
        slots: {
          type: 'object',
          description: 'Slot values for the template. Each template documents its required slots.',
        },
        dagId: { type: 'string', description: 'Optional dag id for the resulting definition' },
      },
      required: ['templateId', 'slots'],
    },
  },
  {
    name: 'dag_export',
    description:
      'Convert an IDagDefinition to the .dag.json workflow file format pair. Returns workflowFile (for .dag.json) and companion (for .dag.robota.json). Save both files to use with dag_run_file or visual tools.',
    inputSchema: {
      type: 'object',
      properties: {
        definition: {
          type: 'object',
          description: 'The IDagDefinition to convert.',
        },
      },
      required: ['definition'],
    },
  },
  {
    name: 'dag_import',
    description:
      'Convert a .dag.json workflow file (IDagWorkflowFile) back to an IDagDefinition. Optionally provide the companion .dag.robota.json to restore string nodeIds and Robota-specific metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowFile: {
          type: 'object',
          description: 'Parsed contents of a .dag.json workflow file.',
        },
        companion: {
          type: 'object',
          description: 'Optional parsed contents of the .dag.robota.json companion file.',
        },
      },
      required: ['workflowFile'],
    },
  },
  {
    name: 'dag_instant_node_save',
    description:
      'Persist an in-memory instant node to disk as .dag/nodes/<nodeType>.node.json so it is automatically restored on the next MCP server startup.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: {
          type: 'string',
          description:
            'The nodeType of the instant node to save (must be registered in this session)',
        },
      },
      required: ['nodeType'],
    },
  },
  {
    name: 'dag_instant_node_list_saved',
    description: 'List all instant nodes that have been persisted to .dag/nodes/ on disk.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dag_provider_list',
    description:
      'List runtime providers known to the CLI plus the currently active provider for this session.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dag_provider_set',
    description: 'Set the active runtime provider for the current MCP session.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider id (e.g. "local").' },
      },
      required: ['providerId'],
    },
  },
  {
    name: 'dag_provider_nodes',
    description:
      'List the node catalog for a provider. If providerId is omitted, the currently active provider is used.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: { type: 'string' },
        serverUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'dag_provider_refresh',
    description:
      'Invalidate the cached node catalog for a provider. No-op for providers that do not cache.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: { type: 'string' },
        serverUrl: { type: 'string' },
      },
    },
  },
  {
    name: 'dag_runs_list',
    description:
      'List recent local DAG run history from persistent SQLite storage (.dag/runs.db). Shows runs across MCP sessions. Filter by dagId, status, or limit.',
    inputSchema: {
      type: 'object',
      properties: {
        dagId: {
          type: 'string',
          description: 'Filter by DAG identifier',
        },
        status: {
          type: 'string',
          description: 'Filter by status: success | failed | error',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of runs to return (default: 20)',
        },
      },
    },
  },
] as const;
