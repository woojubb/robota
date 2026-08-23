/** Fail-closed response for project APIs without an accepted runtime authority. */
export class WorkspaceAuthorityRequiredError extends Error {
  override readonly name = 'WorkspaceAuthorityRequiredError';
  readonly code = 'WORKSPACE_AUTHORITY_REQUIRED';

  constructor(message = 'A current workspace project authority is required for this operation.') {
    super(message);
  }
}
