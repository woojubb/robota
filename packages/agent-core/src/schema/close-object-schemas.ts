/**
 * Closing the universal schema subset for providers that reject open-world objects. PROV-007.
 *
 * Two vendors demand a closed schema and neither accepts what this repository emits. Anthropic's
 * structured-output surface requires every `object` node to carry `additionalProperties: false`;
 * OpenAI's strict mode requires that AND that every object list all of its properties in `required`.
 * The universal subset guarantees neither — a Zod-derived node emits `additionalProperties: true`
 * for Zod's default `strip` and for `.passthrough()`, a hand-written one may omit the member, and
 * `required` lists only the genuinely-required fields.
 *
 * ONE recursion, not one per vendor. Anthropic had its own copy and OpenAI was about to get a third;
 * CORE-039 exists because a walk over this subset that misses a route — it missed `anyOf` — leaves
 * exactly the nodes it was written to fix untouched, and every copy has to be found and fixed
 * separately. The vendors differ in POLICY, so the policy is an argument.
 *
 * The consumer's original schema still governs core-side validation. This is an SDK-seam
 * transformation, applied on the way out.
 */

/** One structural edit `closeObjectSchemas` made, at the JSON-pointer-like path it made it. */
export interface ISchemaClosureChange {
  readonly path: string;
  readonly kind: 'closed-object' | 'required-added' | 'nullable-added';
}

/** How far to close, which is where the two vendors differ. */
export interface ISchemaClosureOptions {
  /**
   * Also list every property of every object in `required` — OpenAI strict mode.
   *
   * This is LOSSY: it forces genuinely-optional fields into `required`. `optionalAsNullable` is how
   * that is compensated, and the two are meant to travel together.
   */
  requireAllProperties?: boolean;
  /**
   * Give a property that was optional a `null` branch once it is forced into `required`.
   *
   * The representation strict mode has no faithful mapping for, decided here rather than left to
   * each call site: a field the caller marked optional becomes required-but-nullable, which is the
   * compensation OpenAI documents. `anyOf: [T, { type: 'null' }]` is chosen because that is already
   * how this subset expresses a nullable value (CORE-039 emits it for Zod's `.nullable()`), so a
   * forced-optional field and a genuinely nullable one are indistinguishable on the wire — which is
   * the point. Anything else would invent a second nullability spelling for one vendor.
   */
  optionalAsNullable?: boolean;
  /**
   * MCP-005: told once per actual structural edit, so a caller (the tool-schema projector) can build
   * a diagnostic without re-deriving this recursion — one walk, not a second copy that could disagree
   * with this one about which route a nested object arrives by.
   */
  onChange?: (change: ISchemaClosureChange) => void;
}

const NULL_BRANCH = { type: 'null' } as const;

/** Whether this node already admits `null`, so the branch is not added twice. */
function admitsNull(node: Record<string, unknown>): boolean {
  if (node.type === 'null') return true;
  return (
    Array.isArray(node.anyOf) &&
    node.anyOf.some(
      (branch) =>
        typeof branch === 'object' &&
        branch !== null &&
        (branch as Record<string, unknown>).type === 'null',
    )
  );
}

/** Wrap a property schema so it accepts `null` as well as its own shape. */
function withNullBranch(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const node = value as Record<string, unknown>;
  if (admitsNull(node)) return node;
  if (Array.isArray(node.anyOf)) {
    return { ...node, anyOf: [...node.anyOf, NULL_BRANCH] };
  }
  return { anyOf: [node, NULL_BRANCH] };
}

/**
 * Close every object node in a schema, recursively.
 *
 * Walks `properties`, `items`, `anyOf` and a schema-valued `additionalProperties` — every route a
 * nested object can arrive by in this subset. A route left unwalked is a nested object silently left
 * open, which is the failure this function exists to prevent.
 */
export function closeObjectSchemas(node: unknown, options: ISchemaClosureOptions = {}): unknown {
  return closeObjectSchemasAt(node, options, '');
}

function closeObjectSchemasAt(
  node: unknown,
  options: ISchemaClosureOptions,
  path: string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((entry, index) => closeObjectSchemasAt(entry, options, `${path}/${index}`));
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }

  const record = node as Record<string, unknown>;
  const closed: Record<string, unknown> = { ...record };
  const isObjectNode = record.type === 'object';
  const properties =
    record.properties && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : undefined;

  if (properties) {
    const required = new Set(
      Array.isArray(record.required) ? (record.required as unknown[]).map(String) : [],
    );
    closed.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => {
        const propertyPath = `${path}/properties/${key}`;
        const child = closeObjectSchemasAt(value, options, propertyPath);
        const wasRequired = required.has(key);
        if (options.requireAllProperties === true && !wasRequired) {
          options.onChange?.({ path: propertyPath, kind: 'required-added' });
        }
        // Only a property that was NOT already required is compensated. A genuinely required field
        // gaining a null branch would widen the contract rather than preserve it.
        const forcedIntoRequired =
          options.requireAllProperties === true &&
          options.optionalAsNullable === true &&
          !wasRequired;
        if (!forcedIntoRequired) {
          return [key, child];
        }
        const childAlreadyNullable =
          typeof child === 'object' && child !== null && !Array.isArray(child)
            ? admitsNull(child as Record<string, unknown>)
            : false;
        const wrapped = withNullBranch(child);
        if (!childAlreadyNullable) {
          options.onChange?.({ path: propertyPath, kind: 'nullable-added' });
        }
        return [key, wrapped];
      }),
    );
    if (options.requireAllProperties === true) {
      closed.required = Object.keys(properties);
    }
  }

  if (record.items && typeof record.items === 'object') {
    closed.items = closeObjectSchemasAt(record.items, options, `${path}/items`);
  }

  // CORE-039: a union node's branches are objects too. Without this the spread carries `anyOf`
  // through unrecursed, leaving every object inside a branch open — the exact thing this seam
  // exists to prevent, reached by the one route it did not walk.
  if (Array.isArray(record.anyOf)) {
    closed.anyOf = record.anyOf.map((branch, index) =>
      closeObjectSchemasAt(branch, options, `${path}/anyOf/${index}`),
    );
  }

  if (record.additionalProperties && typeof record.additionalProperties === 'object') {
    // Schema-valued `additionalProperties` (record types) passes through recursed; a vendor may
    // reject it, which surfaces as a provider error rather than being masked here.
    closed.additionalProperties = closeObjectSchemasAt(
      record.additionalProperties,
      options,
      `${path}/additionalProperties`,
    );
  } else if (isObjectNode) {
    // Deliberate overwrite, including of an explicit `true`. The converter emits
    // `additionalProperties: true` routinely — Zod's default `strip` means "accept then drop" — and
    // these vendors still require every object node closed. The consumer's original schema keeps
    // governing core-side validation, where the `true` is honoured.
    if (record.additionalProperties !== false) {
      options.onChange?.({ path, kind: 'closed-object' });
    }
    closed.additionalProperties = false;
  }

  return closed;
}
