/**
 * Narrow a third-party JSON schema to the part agent-core's universal subset can enforce — CORE-040.
 *
 * An MCP tool's `inputSchema` is authored by a THIRD-PARTY server. `validateAgainstJsonSchema` is the
 * single complete walk over the universal subset (CORE-039), and it REJECTS a node outside that
 * subset: `{ path }: unsupported schema type …`, or `… declares neither a type nor anyOf` for a node
 * carrying `oneOf` / `allOf` / `$ref`. Handing a third-party schema to it unchanged would therefore
 * refuse EVERY payload for any tool whose server used ordinary JSON Schema this repo happens not to
 * model — breaking a working tool over a limitation that is ours, not the server's.
 *
 * Refusing is wrong and so is ignoring. This narrows: the inexpressible SUBTREES are dropped from a
 * copy of the schema, everything remaining is enforced completely, and the dropped paths are
 * returned so a caller can say what it cannot check. Presence is unaffected — a dropped property
 * stays in its parent's `required`, so an omitted key is still an error; only the constraint on its
 * VALUE is gone, which is exactly the part that could not be checked either way.
 *
 * Reporting the paths is the half that keeps this from being a silent downgrade
 * (`enforcement-architecture.md`, "Silence is not success").
 */

import { createLogger, validateAgainstJsonSchema } from '@robota-sdk/agent-core';

import type {
  IParameterSchema,
  IParameterValidationResult,
  TToolParameters,
} from '@robota-sdk/agent-core';

const logger = createLogger('ThirdPartySchema');

/** The types the universal subset models. Anything else is a node this repo cannot check. */
const SUBSET_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export interface INarrowedSchema {
  /** A copy carrying only what the subset can enforce. */
  schema: IParameterSchema;
  /** Dotted paths of the subtrees dropped, in document order. Empty when nothing was dropped. */
  unenforceable: string[];
}

/**
 * A node that accepts any JSON value, expressed IN the subset.
 *
 * An inexpressible property is replaced with this rather than deleted. `additionalProperties`
 * semantics make an object node that declares `properties` CLOSED, so deleting a key would turn the
 * server's own declared parameter into an "unexpected additional property" — refusing the payload
 * for the opposite reason. Replacing keeps the key declared and drops only the constraint on its
 * value, which is the part that could not be checked either way.
 */
function anyValueNode(): IParameterSchema {
  return {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object' },
      { type: 'array' },
      { type: 'null' },
    ],
  } as IParameterSchema;
}

/** A node the subset models: it declares a known `type`, or it is an `anyOf` union. */
function isExpressible(node: IParameterSchema): boolean {
  if (Array.isArray(node.anyOf)) return true;
  return typeof node.type === 'string' && SUBSET_TYPES.has(node.type);
}

function narrowNode(node: IParameterSchema, path: string, dropped: string[]): IParameterSchema {
  if (node.type === 'object') {
    const properties = node.properties;
    if (!properties) return node;
    const kept: Record<string, IParameterSchema> = {};
    for (const [key, child] of Object.entries(properties)) {
      const childPath = `${path}.${key}`;
      if (!isExpressible(child)) {
        dropped.push(childPath);
        kept[key] = anyValueNode();
        continue;
      }
      kept[key] = narrowNode(child, childPath, dropped);
    }
    // `required` is deliberately carried through untouched: a narrowed property is one whose VALUE
    // cannot be checked, not one that stopped being required.
    return { ...node, properties: kept };
  }

  if (node.type === 'array' && node.items) {
    const itemsPath = `${path}[]`;
    if (!isExpressible(node.items)) {
      // An array node declares no closure, so dropping `items` is enough — there is no key here to
      // turn unexpected.
      dropped.push(itemsPath);
      const { items: _items, ...withoutItems } = node;
      return withoutItems as IParameterSchema;
    }
    return { ...node, items: narrowNode(node.items, itemsPath, dropped) };
  }

  return node;
}

/**
 * @param schema - the third-party parameter schema, as the server declared it
 * @returns the enforceable copy, and the paths that were dropped from it
 */
export function narrowToUniversalSubset(schema: IParameterSchema): INarrowedSchema {
  const unenforceable: string[] = [];
  // A root the subset cannot express leaves nothing to enforce; an empty object node accepts any
  // payload, which is the honest outcome — and the root is reported, so it is not a quiet one.
  if (!isExpressible(schema)) {
    return { schema: { type: 'object' } as IParameterSchema, unenforceable: [''] };
  }
  return { schema: narrowNode(schema, '', unenforceable), unenforceable };
}

/** Told once per tool when part of its schema cannot be enforced: `(toolName, paths)`. */
export type TUnenforceableSchemaReporter = (toolName: string, paths: string[]) => void;

/**
 * The parameter validator both MCP tool classes use — CORE-040.
 *
 * They previously carried the same hand-rolled top-level presence check, character for character.
 * Two copies of a validation decision is how PROV-004's drift starts, so there is one, and it is
 * held by the module that owns the third-party trust boundary.
 *
 * Narrowing runs ONCE per tool and is cached: it is a pure function of a schema that does not change
 * for the life of the tool, and the report is a property of the tool rather than of a call.
 */
export class ThirdPartySchemaValidator {
  private narrowed?: INarrowedSchema;
  private reported = false;

  constructor(
    private readonly toolName: string,
    private readonly parameters: IParameterSchema,
    private readonly report?: TUnenforceableSchemaReporter,
  ) {}

  validate(parameters: TToolParameters): IParameterValidationResult {
    this.narrowed ??= narrowToUniversalSubset(this.parameters);
    if (!this.reported && this.narrowed.unenforceable.length > 0) {
      this.reported = true;
      // Reported even with no injected reporter — an unenforceable schema that nobody is told about
      // is the silent downgrade this design exists to avoid.
      const report =
        this.report ??
        ((tool: string, paths: string[]): void => {
          logger.warn('MCP tool schema is only partly enforceable', { tool, paths });
        });
      report(this.toolName, this.narrowed.unenforceable);
    }
    const errors = validateAgainstJsonSchema(this.narrowed.schema, parameters, '');
    return { isValid: errors.length === 0, errors };
  }
}
