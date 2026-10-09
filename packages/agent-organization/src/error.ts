export class OrganizationSchemaError extends Error {
  readonly reason = 'invalid-schema' as const;

  constructor() {
    super('Invalid organization schema');
  }
}
