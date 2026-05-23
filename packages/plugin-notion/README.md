# @robota-sdk/plugin-notion

Notion page and database plugin for Robota SDK.

Provides `NotionPlugin` — a Robota plugin that reads and writes Notion pages so the
agent can fetch documentation, search knowledge bases, or create new pages during a session.

## Installation

```bash
npm install @robota-sdk/plugin-notion
```

## Prerequisites

A Notion Integration Token. Create an integration at <https://www.notion.so/my-integrations>
and share the target pages/databases with it.

## Usage

```typescript
import { NotionPlugin } from '@robota-sdk/plugin-notion';

const notion = new NotionPlugin({ token: process.env.NOTION_TOKEN! });

// Register with your Robota agent
agent.use(notion);

// Use directly
const page = await notion.getPage('page-id-here');
const blocks = await notion.getPageBlocks('page-id-here');
const results = await notion.searchPages('architecture decisions');
await notion.createPage('parent-page-id', 'Meeting Notes 2026-05-23', '## Summary\n...');
```

## API

### `new NotionPlugin(options)`

| Option  | Type     | Required | Description              |
| ------- | -------- | -------- | ------------------------ |
| `token` | `string` | Yes      | Notion Integration Token |

### Methods

| Method                                  | Description                        |
| --------------------------------------- | ---------------------------------- |
| `getPage(pageId)`                       | Fetch page metadata                |
| `getPageBlocks(pageId)`                 | Fetch all content blocks of a page |
| `createPage(parentId, title, content?)` | Create a new page under a parent   |
| `searchPages(query, limit?)`            | Search pages and databases by text |

## Environment Variable

```bash
export NOTION_TOKEN=secret_...
```
