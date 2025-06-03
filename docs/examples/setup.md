# Setup and Prerequisites

This guide covers the initial setup required to run Robota SDK examples.

## Prerequisites

### Node.js and Package Manager

Ensure you have the following installed:

- **Node.js** 18+ 
- **pnpm** (recommended) or npm
- **bun** (optional, for faster execution)

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install bun (optional, for faster TypeScript execution)
curl -fsSL https://bun.sh/install | bash
```

### Install Dependencies

From the project root:

```bash
pnpm install
```

## Environment Configuration

### Required API Keys

Create a `.env` file in the project root with your API keys:

```env
# Required for most examples
OPENAI_API_KEY=your_openai_api_key_here

# Optional - for multi-provider examples
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
```

### Getting API Keys

#### OpenAI API Key
1. Visit [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key to your `.env` file

#### Anthropic API Key (Optional)
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Add to your `.env` file

#### Google AI API Key (Optional)
1. Visit [Google AI Studio](https://makersuite.google.com/)
2. Sign in with your Google account
3. Create a new API key
4. Add to your `.env` file

## Directory Structure

Understanding the example structure:

```
robota/
├── apps/examples/           # Example source code
│   ├── 01-basic/           # Basic usage examples
│   ├── 02-functions/       # Function tool examples
│   ├── 03-integrations/    # Integration examples
│   └── 04-sessions/        # Session management examples
├── docs/examples/          # This documentation
└── packages/               # SDK packages
    ├── core/              # Core SDK
    ├── tools/             # Tool providers
    └── sessions/          # Session management
```

## Running Examples

### Method 1: Direct Execution (Recommended)

Navigate to the examples directory and run TypeScript files directly:

```bash
# Navigate to examples
cd apps/examples

# Run with bun (fastest)
bun run 01-basic/01-simple-conversation.ts

# Or with pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
```

### Method 2: Using Package Scripts

Some examples have predefined npm scripts:

```bash
cd apps/examples

# Run specific examples
pnpm start:simple-conversation
pnpm start:ai-with-tools

# Run example groups
pnpm start:all-basic
pnpm start:all-examples
```

## Verification

Test your setup with the simplest example:

```bash
cd apps/examples
bun run 01-basic/01-simple-conversation.ts
```

Expected output:
```
===== Simple Conversation Example =====
Response: [AI response about TypeScript]

===== Streaming Response Example =====
Response: [Streaming AI response about TypeScript advantages]
```

## Troubleshooting Setup Issues

### Common Problems

#### 1. Missing Dependencies
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
pnpm install
```

#### 2. API Key Issues
- Verify API keys are correctly set in `.env`
- Check for extra spaces or quotes around keys
- Ensure `.env` is in the project root, not in examples directory

#### 3. TypeScript Execution Errors
```bash
# Install tsx globally if needed
pnpm add -g tsx

# Or use npx
npx tsx 01-basic/01-simple-conversation.ts
```

#### 4. Module Resolution Issues
```bash
# Build packages first
pnpm build

# Or run from project root
cd ../../
pnpm tsx apps/examples/01-basic/01-simple-conversation.ts
```

### Getting Help

If you encounter issues:

1. Check the specific example documentation
2. Verify your environment configuration
3. Ensure all dependencies are installed
4. Check the console for specific error messages

## Next Steps

Once setup is complete, explore the examples:

1. Start with [Basic Conversation](./basic-conversation.md)
2. Try [AI with Tools](./ai-with-tools.md)
3. Explore [Multi-Provider Setup](./multi-provider.md)

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT models |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for Claude models |
| `GOOGLE_API_KEY` | No | Google AI API key for Gemini models |

All examples will gracefully handle missing optional API keys by skipping provider-specific demonstrations. 