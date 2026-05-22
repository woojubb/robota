---
title: Local LLM Setup — Ollama & LM Studio
description: Run Robota with local models. No API key, no internet connection, no usage cost.
---

# Local LLM Setup

Robota works with any OpenAI-compatible local inference server. This guide covers the two most popular options — **Ollama** and **LM Studio** — plus any `llama.cpp` server or custom endpoint.

> **No API key required.** Local models run entirely on your machine. Your code, prompts, and conversation history never leave your device.

---

## Quick Start

```bash
# 1. Start your local model server (see below)

# 2. Configure Robota to use it
robota --configure

# Select "Gemma / LM Studio" and enter your server URL:
#   Ollama:    http://localhost:11434/v1
#   LM Studio: http://localhost:1234/v1
```

---

## Option 1: Ollama

[Ollama](https://ollama.com) is the easiest way to run local models. It manages downloads and serves an OpenAI-compatible API automatically.

### Install and start

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model (examples)
ollama pull llama3.2          # 3B — fast, good for most tasks
ollama pull codellama         # Optimized for code
ollama pull qwen2.5-coder     # Strong at TypeScript/Python
ollama pull mistral           # Good general purpose

# Verify the server is running
curl http://localhost:11434/v1/models
```

Ollama starts automatically and listens on `http://localhost:11434`.

### Configure Robota

```bash
robota --configure
```

When prompted:

- **Provider**: Select `Gemma / LM Studio` (uses OpenAI-compatible API)
- **Base URL**: `http://localhost:11434/v1`
- **Model**: Enter the model name exactly as in `ollama list` (e.g. `llama3.2`, `codellama`)
- **API key**: Enter any value (e.g. `ollama`) — Ollama does not validate it

Or set via environment variables:

```bash
ROBOTA_PROVIDER=gemma \
ROBOTA_BASE_URL=http://localhost:11434/v1 \
ROBOTA_MODEL=llama3.2 \
ROBOTA_API_KEY=ollama \
robota
```

### Recommended models for coding

| Model                   | Size | Best for                        |
| ----------------------- | ---- | ------------------------------- |
| `qwen2.5-coder:7b`      | 7B   | TypeScript, Python, code review |
| `codellama:13b`         | 13B  | General code generation         |
| `llama3.2:3b`           | 3B   | Fast responses, simple tasks    |
| `deepseek-coder-v2:16b` | 16B  | Complex reasoning, refactoring  |

Larger models produce better results but require more RAM and run slower.

---

## Option 2: LM Studio

[LM Studio](https://lmstudio.ai) provides a GUI for downloading and running models, with a built-in local API server.

### Install and start

1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai)
2. In the **Discover** tab, search for and download a model (e.g. `Gemma 3`, `Llama 3.2`, `Qwen 2.5 Coder`)
3. In the **Local Server** tab, click **Start Server**

The server runs on `http://localhost:1234` by default.

### Configure Robota

```bash
robota --configure
```

When prompted:

- **Provider**: Select `Gemma / LM Studio`
- **Base URL**: `http://localhost:1234/v1`
- **Model**: Enter the model name exactly as shown in LM Studio's **Local Server** tab
- **API key**: `lm-studio` (placeholder — LM Studio does not validate it)

---

## Option 3: llama.cpp Server

If you compile and run `llama.cpp` directly:

```bash
# Start llama.cpp server
./llama-server -m models/your-model.gguf --port 8080

# Configure Robota
robota --configure
# Base URL: http://localhost:8080/v1
# API key: any value (e.g. "local")
```

---

## Troubleshooting

### "Connection refused" or "Network error"

- Verify the server is running: `curl http://localhost:11434/v1/models`
- Check the port number matches your configuration
- On some systems, the server may bind to `127.0.0.1` only — try `http://127.0.0.1:11434/v1`

### Model not responding

- Ensure the model name in Robota's config exactly matches the model loaded in your server
- For Ollama, run `ollama list` to see available model names
- For LM Studio, the model name is shown in the Local Server tab header

### Slow responses

- Local models are slower than cloud APIs, especially on CPU
- Use smaller quantized models (e.g. `q4_k_m` variants) for faster inference
- Enable GPU acceleration in Ollama or LM Studio settings if available

### Tool calling not working

Some local models do not support the OpenAI function-calling format. If tool calls fail silently:

1. Try a model known to support tools: `qwen2.5-coder`, `llama3.2`, `mistral-nemo`
2. In Robota, run `/mode plan` to switch to plan mode, which requires fewer tool calls
3. Check the model's documentation for tool-call support

---

## Tips for Local Model Usage

- **Context windows are smaller.** Most local models have 4K–32K token context vs 200K+ for cloud models. Use `/compact` when the context fills up.
- **Response quality varies.** Code quality from 7B models is good for straightforward tasks; use 13B+ for complex refactoring.
- **No rate limits.** You can run as many sessions as your hardware supports.
- **Offline capable.** Once the model is downloaded, no internet connection is required.

---

## Related

- [Provider configuration guide](/guide/cli#provider-setup)
- [Context management](/guide/context-management)
- [Why Robota — cost comparison](/compare/)
