# Web App Specification

## Scope
- Owns the Robota web application, including the Next.js host, web-facing playground integration, and browser runtime composition.

## Boundaries
- Does not become the owner of package-level runtime contracts that belong to workspace packages.
- Keeps deployment, auth configuration, and frontend integration behavior documented under `docs/`.
