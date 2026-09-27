# @robota-sdk/agent-preset

Presets and output styles for the Robota SDK. A preset is a named bundle of
`@robota-sdk/agent-framework` session option overrides: persona, model and effort, permission
posture, command-module selection, execution capabilities and autonomy. An output style is a named
set of instructions for how responses are written. This package owns both contracts, the built-in
presets and styles, and the registries that resolve them.

## Installation

```bash
npm install @robota-sdk/agent-preset @robota-sdk/agent-framework
```

Requires Node.js 22.12 or later.

## Presets

```typescript
import { createPresetRegistry } from '@robota-sdk/agent-preset';

// A registry holds its own list: the built-ins plus any external presets you pass.
// Two registries in one process never see each other's presets.
const registry = createPresetRegistry();

// Resolve a preset into session option overrides.
// Precedence (low → high): preset < cliOverrides < explicit.
const options = registry.resolvePreset('careful-reviewer', {
  cliOverrides: { model: 'some-model' },
  explicit: { temperature: 0.2 },
});

// List presets for a picker, or read one definition.
const summaries = registry.listPresets(); // [{ id, title, description }, ...]
const preset = registry.getPreset('autonomous-builder');
console.log(options, summaries, preset);
```

Resolving an unknown ID throws, naming the available presets. `deniedTools` from every layer are
combined rather than replaced. When no layer sets `permissionMode`, it comes from
`defaultPermissionMode`, or else from `autonomy` (`ask-first` and `balanced` map to `default`,
`act-first` to `acceptEdits`).

### Built-in presets

| ID                   | Posture                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `default`            | No overrides; resolving it reproduces the standard agent behaviour                     |
| `autonomous-builder` | High effort, acts first, parallel subagents, self-verification                         |
| `careful-reviewer`   | High effort, asks first, no parallel subagents, self-verification                      |
| `neutral-executor`   | Medium effort, balanced autonomy, follows instructions literally, no self-verification |

`defaultPreset` and `autonomousBuilderPreset` are also exported as values.

### External presets

External presets are JSON files in a directory your product chooses:

```typescript
import { createPresetRegistry, loadExternalPresetsFromDir } from '@robota-sdk/agent-preset';

const { presets, loaded, errors } = loadExternalPresetsFromDir('/path/to/my-app/presets');
for (const { file, error } of errors) console.warn(`${file}: ${error}`);

const registry = createPresetRegistry(presets);
console.log(loaded);
```

Each file is checked with `validateExternalPreset`. A malformed file, an ID that collides with a
built-in, or a duplicate ID is reported in `errors` and skipped; the rest still load. A missing
directory yields no presets. `partitionExternalPresets` applies the same collision rules to presets
you already have in memory.

## Output styles

`createOutputStyleRegistry(sources)` combines the built-in styles (`default`, `concise`,
`proactive`, `explanatory`, `learning`) with Markdown style files from sources you pass
(`managed`, `user` or `project` scope, each with a precedence; a higher precedence wins). A style
file's ID is its file name without `.md`; it has optional frontmatter (`name`, `description`,
`keep-coding-instructions`, `token-cost`) and a non-empty body with the instructions. A file cannot
replace a built-in style. `loadOutputStylesFromSources` returns the styles plus per-file errors, and
`parseOutputStyleFile` parses one file.

```typescript
import { createOutputStyleRegistry } from '@robota-sdk/agent-preset';

const styles = createOutputStyleRegistry([
  {
    scope: 'user',
    displayName: '~/.my-app/output-styles',
    precedence: 1,
    files: [
      {
        fileName: 'terse.md',
        content: '---\nname: Terse\ntoken-cost: low\n---\nAnswer in as few words as possible.',
      },
    ],
  },
]);

console.log(styles.listOutputStyles().map((style) => style.id));
const terse = styles.getOutputStyle('terse');
console.log(terse?.instructions);
```

## Where it sits

```
agent-framework   ← session option types this package overrides
    ↑
agent-preset      ← this package
    ↑
agent-cli, agent-command, agent-product   ← create registries and apply presets
```

This package depends only on `@robota-sdk/agent-framework` and does not re-export it.

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract, precedence and design decisions

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
