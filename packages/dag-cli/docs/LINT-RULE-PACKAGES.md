# Lint Rule Packages — Convention

Third-party lint rule sets for `dag lint`, distributed as npm packages.

## Naming Convention

Package names must follow the pattern:

```
robota-dag-rules-<name>
```

Examples: `robota-dag-rules-strict`, `robota-dag-rules-enterprise`, `robota-dag-rules-security`

## Package Structure

```
robota-dag-rules-strict/
├── package.json
├── index.js          ← must export { rules }
└── README.md
```

### Required Export

The package must export a `rules` object with the same shape as `.dag/lint.json`:

```js
// index.js (ESM)
export const rules = {
  'require-input-node': 'error',
  'no-disconnected-nodes': 'error',
  'naming-convention': 'error', // upgraded from warn
  'max-cost-per-run': 'error', // upgraded from warn
  'max-nodes': 'error', // upgraded from warn
};
```

### package.json

```json
{
  "name": "robota-dag-rules-strict",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" },
  "keywords": ["robota-dag-rules"],
  "peerDependencies": {
    "@robota-sdk/dag-cli": ">=3"
  }
}
```

The `robota-dag-rules` keyword enables future auto-discovery.

## Usage

```bash
# Install the rule package
npm install --save-dev robota-dag-rules-strict

# Use it when linting
dag lint .dag/workflows/ --rules-pkg robota-dag-rules-strict

# Combine with remote rules (local .dag/lint.json always wins)
dag lint . --rules-pkg robota-dag-rules-strict --rules-url https://example.com/rules.json
```

## Rule Priority (highest wins)

1. Local `.dag/lint.json` (project-level overrides)
2. `--rules-url` remote rules
3. `--rules-pkg` package rules
4. Built-in defaults

## Rule Severity Values

| Value     | Meaning                             |
| --------- | ----------------------------------- |
| `'error'` | Fail lint (exit 1)                  |
| `'warn'`  | Report but pass (unless `--strict`) |
| `'off'`   | Disable rule                        |

## Supported Built-in Rule Keys

| Rule                    | Default | Description                               |
| ----------------------- | ------- | ----------------------------------------- |
| `require-input-node`    | `error` | Workflow must have an input node          |
| `no-disconnected-nodes` | `error` | All nodes must be reachable               |
| `naming-convention`     | `warn`  | Node IDs must match `/^[a-z][a-z0-9-]*$/` |
| `max-cost-per-run`      | `warn`  | Estimated cost must not exceed $1.00      |
| `max-nodes`             | `warn`  | Node count must not exceed 20             |

## CI Integration

```yaml
# .github/workflows/dag-lint.yml
- name: Lint DAG workflows
  run: npx @robota-sdk/dag-cli lint .dag/workflows/ --rules-pkg robota-dag-rules-strict --strict
```
