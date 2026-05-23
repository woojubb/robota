---
title: Enterprise
---

# Enterprise

Robota is used by engineering teams that need a controllable, self-hostable AI coding assistant. If you are evaluating Robota for your organization, this page covers security practices, deployment options, and how to get in touch.

## Contact Us

To discuss team licensing, on-premises deployment, priority support, or custom integrations, fill in the form below or email **enterprise@robota.io**.

We respond to all enterprise inquiries within **30 business days**.

| Field             | Notes                                       |
| ----------------- | ------------------------------------------- |
| Name              | Your full name                              |
| Company           | Organization name                           |
| Team size         | Number of engineers who will use Robota     |
| Use case          | Brief description of what you want to build |
| Preferred contact | Email or GitHub                             |

> **To get in touch:** Open a GitHub Discussion tagged `enterprise` at [github.com/woojubb/robota/discussions](https://github.com/woojubb/robota/discussions), or email enterprise@robota.io directly.

---

## Security Policy

### Data Handling

Robota operates as a local CLI or self-hosted server. **No conversation data is stored or transmitted to Robota servers** — the SDK calls the AI provider of your choice (Anthropic, OpenAI, DeepSeek, etc.) directly from your machine or your infrastructure.

| Data type                   | Where it goes                                                 |
| --------------------------- | ------------------------------------------------------------- |
| Prompts and responses       | Sent only to the AI provider you configure                    |
| API keys                    | Stored in your local environment variables or secrets manager |
| Session history             | Written to your local filesystem (`~/.robota/sessions/`)      |
| Tool outputs (files, shell) | Stay on your machine                                          |

### API Key Storage

API keys are never embedded in code. They are read at runtime from:

1. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
2. A local config file (`~/.robota/config.json`) — readable only by the current user
3. Your organization's secrets manager (Vault, AWS Secrets Manager, etc.) — you integrate this via the provider initialization API

### Transport Security

- All AI provider calls use HTTPS/TLS 1.2+
- The optional WebSocket transport (for the web playground) runs over WSS; it is disabled by default
- No outbound network calls are made by the SDK except to the configured AI provider endpoints

### On-Premises Deployment

Robota supports fully air-gapped deployments using local LLMs:

- **Ollama** — run models locally with zero external network calls
- **LM Studio** — OpenAI-compatible local server
- **Any OpenAI-compatible endpoint** — point `baseURL` to your internal gateway

```typescript
import { OpenAIProvider } from '@robota-sdk/openai';

const provider = new OpenAIProvider({
  apiKey: 'local',
  baseURL: 'http://your-internal-gateway/v1',
  model: 'your-model-name',
});
```

In this configuration no data leaves your network.

### Audit and Compliance

- **MIT License** — full source code available for audit at [github.com/woojubb/robota](https://github.com/woojubb/robota)
- No telemetry, no analytics, no phone-home in the SDK or CLI
- Session logs are append-only local files — you control retention and deletion
- Compatible with SOC 2 and ISO 27001 environments when combined with a compliant AI provider

### Vulnerability Disclosure

To report a security vulnerability, email **security@robota.io** with a description and reproduction steps. We follow responsible disclosure and aim to issue a patch within 14 days of confirmation.

---

## Frequently Asked Questions

**Does Robota store my code in the cloud?**

No. All file reads and writes happen on your local machine. The only data that leaves your machine is the prompt you send to your configured AI provider.

**Can we use Robota behind a corporate proxy?**

Yes. Set the standard `HTTPS_PROXY` environment variable and the SDK's HTTP client will route through it.

**Can Robota be installed in a restricted network with no internet access?**

Yes — use a local LLM (Ollama, LM Studio) and install npm packages from an internal registry mirror.

**Do you offer a private npm registry mirror or container image?**

Not at this time, but it is on the roadmap. Contact us if this is a blocker.

**Is there a commercial license option?**

Robota is MIT-licensed and free to use commercially without restriction. Enterprise support contracts (SLA, dedicated channels, custom integrations) are available — contact us for details.
