# REST API Design Principles

A well-designed REST API uses HTTP methods semantically: GET for reads, POST to create, PUT or
PATCH to update, and DELETE to remove. Resource URLs should be nouns, not verbs — `/orders/42`
rather than `/getOrder?id=42`.

Status codes must be accurate. Returning 200 for an operation that failed misleads clients and
makes error handling unreliable. Use 201 for successful creation, 400 for client errors, 404 when
a resource does not exist, and 422 when input validation fails.

Versioning the API surface — either via the URL path (`/v1/`) or an `Accept` header — lets you
evolve the contract without breaking existing consumers. Pagination on collection endpoints
prevents unbounded response sizes and protects both client and server under load.
