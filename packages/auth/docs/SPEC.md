# Auth Specification

## Scope

`@robota-sdk/auth` owns authentication contracts and pure authorization policy helpers for Robota runtimes. It defines credential, principal, auth context, verifier port, error, and scope policy types.

## Boundaries

| Responsibility                 | Owner                        | Not This Package                                 |
| ------------------------------ | ---------------------------- | ------------------------------------------------ |
| Credential/principal contracts | `auth`                       | Does not store users or sessions                 |
| Scope policy evaluation        | `auth`                       | Does not define product-specific permissions     |
| HTTP middleware wiring         | Application packages         | Does not import Express or web framework objects |
| API key/session persistence    | Adapter/application packages | Does not implement storage                       |
| Credit balances                | `credits`                    | Does not own account or ledger state             |

## Architecture Overview

`auth` is a functional-core package. It exposes pure scope policy functions and port interfaces. Concrete credential verification, user stores, token parsing, and HTTP middleware belong in adapters or app composition roots.

```text
auth
├── types.ts          # credential, principal, context, verifier port
└── scope-policy.ts   # pure scope checks and auth error helper
```

## Type Ownership

| Type                    | Location       | Purpose                                             |
| ----------------------- | -------------- | --------------------------------------------------- |
| `IAuthCredential`       | `src/types.ts` | Credential presented by a caller                    |
| `IAuthPrincipal`        | `src/types.ts` | Authenticated caller identity and scopes            |
| `IAuthContext`          | `src/types.ts` | Verified auth state passed to application use cases |
| `IAuthVerifierPort`     | `src/types.ts` | Adapter port for credential verification            |
| `IRequiredScopesPolicy` | `src/types.ts` | Scope requirement contract                          |
| `IScopeDecision`        | `src/types.ts` | Pure scope evaluation result                        |
| `IAuthError`            | `src/types.ts` | Auth failure contract                               |
| `TAuthResult`           | `src/types.ts` | Auth operation result union                         |

## Public API Surface

| Export              | Kind             | Description                                           |
| ------------------- | ---------------- | ----------------------------------------------------- |
| `createAuthError`   | Function         | Builds a typed auth error                             |
| `hasScope`          | Function         | Checks whether a principal has one scope              |
| `evaluateScopes`    | Function         | Evaluates all/any scope policy without throwing       |
| `requireScopes`     | Function         | Returns `TAuthResult` for scope policy enforcement    |
| `IAuthVerifierPort` | Interface        | Verifier adapter contract                             |
| Auth type exports   | Types/interfaces | Credential, principal, context, errors, policy shapes |

## Extension Points

Consumers implement `IAuthVerifierPort` for API key, bearer token, session token, or external IdP verification. Applications compose verifier adapters into HTTP middleware or command/session boundaries.

## Error Taxonomy

| Code                        | Retryable | Context                         |
| --------------------------- | --------- | ------------------------------- |
| `AUTH_CREDENTIAL_MISSING`   | false     | No credential was provided      |
| `AUTH_CREDENTIAL_INVALID`   | false     | Credential failed verification  |
| `AUTH_CREDENTIAL_EXPIRED`   | false     | Credential is expired           |
| `AUTH_SCOPE_DENIED`         | false     | Principal lacks required scope  |
| `AUTH_VERIFIER_UNAVAILABLE` | true      | Verifier backend is unavailable |

## Test Strategy

| Test File                            | Scope                                           |
| ------------------------------------ | ----------------------------------------------- |
| `src/__tests__/scope-policy.test.ts` | Scope policy all/any behavior and denied result |

Coverage gaps: concrete verifier adapters and HTTP middleware do not exist yet and must be tested in their owner packages.

## Class Contract Registry

No classes are implemented. `IAuthVerifierPort` is a port interface implemented by future adapter/application packages.

## Dependencies

This package has no production dependencies.
