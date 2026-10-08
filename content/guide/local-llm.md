---
title: Local LLM Setup — Ollama, LM Studio and llama.cpp
description: Run Robota with local models. No API key, no internet connection, no usage cost.
---

# Local LLM Setup

Robota works with any local inference server that speaks the OpenAI-compatible API. This guide
covers **Ollama**, **LM Studio** and the **llama.cpp** server. In Robota these all use the same
provider type, `gemma`, shown in setup as **Ollama / LM Studio / llama.cpp**.

> **No API key required by default.** If you enable server authentication, enter its token using
> profile editing as described below. Local models run entirely on your machine. Your code, prompts and
> conversation history stay on your device.

---

## Quick Start

1. Start your local model server (see the options below).
2. Configure the `__PRODUCT_CLI_NAME__` CLI to use it:

   ```bash
   __PRODUCT_CLI_NAME__ --configure
   ```

   Choose **Ollama / LM Studio / llama.cpp (gemma)**, then answer the two prompts. Press Enter to
   accept a default:

   | Prompt   | Default                         | What to enter                                  |
   | -------- | ------------------------------- | ---------------------------------------------- |
   | Base URL | `http://localhost:1234/v1`      | Your server's URL, including `/v1`             |
   | Model    | `supergemma4-26b-uncensored-v2` | The model name exactly as your server lists it |

On a first run with no provider configured, `__PRODUCT_CLI_NAME__` offers the same setup: answer "No — use a local
model", and after a short LM Studio guide it asks these two prompts. App setup asks for the same
endpoint and model, without a key prompt.

To configure without prompts (for example in a setup script):

```bash
__PRODUCT_CLI_NAME__ --configure-provider local --type gemma \
  --base-url http://localhost:11434/v1 --model llama3.2 --set-current
```

The profile is saved in `<user-state>/settings.json`, so you configure it once. Run `__PRODUCT_CLI_NAME__ --configure`
again, or use `/provider` inside a session, to change the provider, URL or model.

### Servers with authentication enabled

Use `/provider edit <profile>` inside a terminal session, or **Settings → Providers → Edit** in the
App, to enter the optional server API key. Leaving a previously configured masked key blank keeps
it unchanged; leaving a keyless profile's field blank keeps it keyless.

For a terminal setup script, set an environment variable containing your server token and reference
it without putting the token on the command line:

```bash
__PRODUCT_CLI_NAME__ --configure-provider local --type gemma \
  --base-url http://localhost:1234/v1 --model your-installed-model \
  --api-key-env LOCAL_MODEL_API_KEY --set-current
```

Both methods retain your endpoint and use the supplied token for requests and connection tests.
Robota supplies the client library's placeholder internally only when no server credential is
configured. This local setup does not perform Ollama cloud sign-in.

---

## Option 1: Ollama

[Ollama](https://ollama.com) downloads and serves models and exposes an OpenAI-compatible API.

### Install and start

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model (examples)
ollama pull llama3.2          # small and fast
ollama pull qwen2.5-coder     # strong at TypeScript/Python

# Verify the server is running
curl http://localhost:11434/v1/models
```

Ollama listens on `http://localhost:11434`.

### Configure ConversationAgent

Run `__PRODUCT_CLI_NAME__ --configure`, choose **Ollama / LM Studio / llama.cpp (gemma)**, and enter:

- **Base URL**: `http://localhost:11434/v1`
- **Model**: the model name exactly as `ollama list` shows it (e.g. `llama3.2`)

### Models for coding

| Model                   | Size | Best for                        |
| ----------------------- | ---- | ------------------------------- |
| `qwen2.5-coder:7b`      | 7B   | TypeScript, Python, code review |
| `codellama:13b`         | 13B  | General code generation         |
| `llama3.2:3b`           | 3B   | Fast responses, simple tasks    |
| `deepseek-coder-v2:16b` | 16B  | Complex reasoning, refactoring  |

Larger models produce better results but need more memory and run slower.

---

## Option 2: LM Studio

[LM Studio](https://lmstudio.ai) is a desktop app for downloading and running models, with a
built-in local API server.

### Install and start

1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai).
2. Search for and download a model (for example a Gemma, Llama or Qwen Coder model).
3. Start the local server from the **Developer** tab.

The server runs on `http://localhost:1234` by default, which is also ConversationAgent's default base URL.

### Configure Robota

Run `__PRODUCT_CLI_NAME__ --configure`, choose **Ollama / LM Studio / llama.cpp (gemma)**, and enter:

- **Base URL**: `http://localhost:1234/v1` (the default)
- **Model**: the model name exactly as LM Studio shows it for the loaded model

---

## Option 3: llama.cpp server

If you build and run `llama.cpp` yourself:

```bash
./llama-server -m models/your-model.gguf --port 8080
```

Then run `__PRODUCT_CLI_NAME__ --configure`, choose **Ollama / LM Studio / llama.cpp (gemma)**, and enter
`http://localhost:8080/v1` as the base URL, then enter your installed model name.

---

## Using a local model from code

The same provider is available to your own code as `GemmaProvider`:

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new GemmaProvider({
  apiKey: 'ollama', // not checked by local servers
  baseURL: 'http://localhost:11434/v1',
  defaultModel: 'llama3.2',
});
```

See [Providers](./providers.md#gemma--openai-compatible) for its options.

---

## Troubleshooting

### Authentication rejected (HTTP 401 or 403)

If your server requires authentication, run `/provider edit <profile>` or use the App's provider
**Edit** action to enter or correct its optional API key. If the profile uses `$ENV:LOCAL_MODEL_API_KEY`,
ensure that variable is set in the environment running Robota. A local-compatible endpoint can
require authentication; Robota does not assume every such server ignores keys.

### "Connection refused" or "Network error"

- Check the server is running: `curl http://localhost:11434/v1/models` (Ollama) or
  `curl http://localhost:1234/v1/models` (LM Studio).
- Check the port in your base URL matches the server.
- Some servers bind to `127.0.0.1` only; try `http://127.0.0.1:<port>/v1`.

### Model not responding

- The model name in your profile must match the model loaded in your server exactly.
- For Ollama, `ollama list` shows the names; LM Studio shows the name of the loaded model.

### Slow responses

- Local models are slower than hosted APIs, especially on CPU.
- Smaller quantized models (e.g. `q4_k_m` variants) run faster.
- Enable GPU acceleration in Ollama or LM Studio if available.

### Tool calling not working

Robota's agent works through tool calls. Some local models do not support the OpenAI
function-calling format, and tool calls then fail or never happen. Use a model whose documentation
says it supports tool or function calling (for example `qwen2.5-coder` or `llama3.2`).

---

## Tips

- **Context windows are smaller.** Many local models have far smaller context windows than hosted
  models. Use `/compact` when the context fills up.
- **Quality varies with size.** Small models handle straightforward tasks; use larger ones for
  complex refactoring.
- **Offline.** Once the model is downloaded, no internet connection is needed.

---

## Related

- [CLI Reference — Connect a provider](./cli.md#connect-a-provider)
- [Providers](./providers.md)
- [Context Management](./context-management.md)
