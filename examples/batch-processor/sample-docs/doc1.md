# TypeScript Strict Mode

TypeScript's strict mode enables a group of compiler checks that catch real bugs at compile time.
The most impactful flags are `strictNullChecks`, which prevents `null` and `undefined` from being
assigned to non-nullable types, and `noImplicitAny`, which requires all values to have an explicit
type when inference cannot determine one.

Enabling strict mode in an existing project can surface hundreds of latent bugs. The recommended
approach is to enable flags incrementally: start with `strictNullChecks`, fix all errors, then
add the remaining flags one at a time. New projects should enable `"strict": true` from day one.

The discipline enforced by strict mode pays dividends during refactoring — the compiler acts as a
safety net, making large-scale changes faster and more reliable.
