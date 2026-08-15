import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

import type { IParameterSchema, IToolSchema, TJSONSchemaKind } from '../interfaces/provider';
import type { ITool, IToolRegistry } from '../interfaces/tool';

/**
 * The parameter kinds a registered tool may declare — every member of `TJSONSchemaKind`.
 *
 * CORE-039: this list previously omitted `integer` and `null`, so a tool declaring an `integer`
 * parameter was refused at registration by a type the subset itself defines. Derived from the union
 * rather than re-listed, so a new kind cannot be added to the subset and forgotten here.
 */
const VALID_PARAMETER_TYPES: readonly TJSONSchemaKind[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
];

/**
 * Tool registry implementation
 * Manages tool registration, validation, and retrieval
 */
export class ToolRegistry implements IToolRegistry {
  private tools = new Map<string, ITool>();

  /**
   * Register a tool
   */
  register(tool: ITool): void {
    if (!tool.schema?.name) {
      throw new ValidationError('Tool must have a valid schema with name');
    }

    const toolName = tool.schema.name;

    // Validate tool schema
    this.validateToolSchema(tool.schema);

    // Check for duplicate registration
    if (this.tools.has(toolName)) {
      logger.warn(`Tool "${toolName}" is already registered, overriding`, {
        toolName,
        existingTool: this.tools.get(toolName)?.constructor.name,
      });
    }

    this.tools.set(toolName, tool);
    logger.debug(`Tool "${toolName}" registered successfully`, {
      toolName,
      toolType: tool.constructor.name,
      parameters: Object.keys(tool.schema.parameters?.properties || {}),
    });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    if (!this.tools.has(name)) {
      logger.warn(`Attempted to unregister non-existent tool "${name}"`);
      return;
    }

    this.tools.delete(name);
    logger.debug(`Tool "${name}" unregistered successfully`);
  }

  /**
   * Get tool by name
   */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool schemas
   */
  getSchemas(): IToolSchema[] {
    const tools = this.getAll();

    logger.debug('[TOOL-FLOW] ToolRegistry.getSchemas() - Tools before schema extraction', {
      count: tools.length,
      tools: tools.map((t) => ({
        name: t.schema?.name ?? 'unnamed',
        hasSchema: !!t.schema,
        schemaType: typeof t.schema,
        toolType: t.constructor?.name || 'unknown',
      })),
    });

    return this.getAll().map((tool) => tool.schema);
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Clear all tools
   */
  clear(): void {
    const toolCount = this.tools.size;
    this.tools.clear();
    logger.debug(`Cleared ${toolCount} tools from registry`);
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tools by pattern
   */
  getToolsByPattern(pattern: string | RegExp): ITool[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return this.getAll().filter((tool) => regex.test(tool.schema.name));
  }

  /**
   * Get tool count
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Validate tool schema
   */
  private validateToolSchema(schema: IToolSchema): void {
    if (!schema.name || typeof schema.name !== 'string') {
      throw new ValidationError('Tool schema must have a valid name');
    }

    if (!schema.description || typeof schema.description !== 'string') {
      throw new ValidationError('Tool schema must have a description');
    }

    if (
      !schema.parameters ||
      typeof schema.parameters !== 'object' ||
      schema.parameters === null ||
      Array.isArray(schema.parameters)
    ) {
      throw new ValidationError('Tool schema must have parameters object');
    }

    if (schema.parameters.type !== 'object') {
      throw new ValidationError('Tool parameters type must be "object"');
    }

    // Validate parameter properties, at every depth. Checking only the top level let a nested node
    // declaring neither `type` nor `anyOf` register cleanly and then fail on EVERY invocation --
    // newly constructible once `type` became optional (CORE-039).
    if (schema.parameters.properties) {
      for (const [propName, propSchema] of Object.entries(schema.parameters.properties)) {
        assertParameterNodeValid(propName, propSchema);
      }
    }

    // Validate required fields exist in properties
    if (schema.parameters.required) {
      const properties = schema.parameters.properties || {};
      for (const requiredField of schema.parameters.required) {
        if (!properties[requiredField]) {
          throw new ValidationError(
            `Required parameter "${requiredField}" is not defined in properties`,
          );
        }
      }
    }
  }
}

/**
 * Assert one subset node is one this runtime can act on, recursively.
 *
 * A node declares EITHER a `type` from the subset's kinds OR an `anyOf` of alternatives. Both walks
 * that read it at run time refuse anything else, so accepting it at registration only moves the
 * failure to every later invocation.
 */
function assertParameterNodeValid(path: string, node: IParameterSchema | undefined): void {
  // CORE-039: a union node carries `anyOf` INSTEAD of `type`, so demanding a type here would reject
  // every tool with a union-typed argument at registration -- the converter would emit it correctly
  // and this check would throw on it.
  if (node?.anyOf) {
    if (node.anyOf.length === 0) {
      throw new ValidationError(`Parameter "${path}" declares an empty anyOf`);
    }
    node.anyOf.forEach((member, index) =>
      assertParameterNodeValid(`${path}|anyOf[${index}]`, member),
    );
    return;
  }

  if (!node?.type) {
    throw new ValidationError(`Parameter "${path}" must declare a type or anyOf`);
  }

  if (!VALID_PARAMETER_TYPES.includes(node.type)) {
    throw new ValidationError(`Parameter "${path}" has invalid type "${node.type}"`);
  }

  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      assertParameterNodeValid(`${path}.${key}`, child);
    }
  }
  if (node.items) {
    assertParameterNodeValid(`${path}[]`, node.items);
  }
}
