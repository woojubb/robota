# Package Structure Standard

This document defines the canonical directory layout for workspace packages in the Robota monorepo.

## Required Layout

```
packages/<name>/
├── src/                       # REQUIRED
│   ├── index.ts               # REQUIRED: barrel export
│   └── (source code)
├── docs/                      # REQUIRED
│   ├── README.md              # REQUIRED
│   └── SPEC.md                # REQUIRED
├── package.json               # REQUIRED
├── tsconfig.json              # REQUIRED
└── tsconfig.build.json        # RECOMMENDED
```

## Test Placement

- **Colocated tests** (e.g., `foo.test.ts` next to `foo.ts`) are the default convention.
- A separate `__tests__/` directory may be used for integration tests or shared fixtures only.

## Configuration Files

- `vitest.config.ts` — recommended for packages with tests
- `tsup.config.ts` — recommended for packages that publish

## Adoption Strategy

Existing packages are not required to migrate immediately. When modifying a package, check whether it conforms to this standard and align incrementally.
