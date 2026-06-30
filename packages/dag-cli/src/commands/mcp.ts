import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createLocalMcpServer } from '../mcp/server.js';
import type { IMcpCommandOptions } from '../mcp/types.js';
import { TOOL_DEFINITIONS } from '../mcp/tool-definitions.js';

export type { IMcpCommandOptions };
export { createLocalMcpServer };

/**
 * Parse argv for the `mcp` subcommand.
 */
type TInspectFormat = 'terminal' | 'markdown' | 'awesome-mcp';

function parseMcpArgv(args: readonly string[]): {
  readonly transport: string;
  readonly port: number;
  readonly catalog: string | undefined;
  readonly inspect: boolean;
  readonly format: TInspectFormat;
  readonly ui: boolean;
  readonly error?: string;
} {
  let transport = 'stdio';
  let port = 3013;
  let catalog: string | undefined;
  let inspect = false;
  let format: TInspectFormat = 'terminal';
  let ui = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--inspect') {
      inspect = true;
      i += 1;
    } else if (arg === '--ui') {
      ui = true;
      i += 1;
    } else if (arg === '--format') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return {
          transport,
          port,
          catalog,
          inspect,
          format,
          ui,
          error: '--format requires a value (terminal|markdown|awesome-mcp)',
        };
      }
      if (next !== 'terminal' && next !== 'markdown' && next !== 'awesome-mcp') {
        return {
          transport,
          port,
          catalog,
          inspect,
          format,
          ui,
          error: `--format must be terminal, markdown, or awesome-mcp (got: ${next})`,
        };
      }
      format = next as TInspectFormat;
      i += 2;
    } else if (arg === '--transport') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return {
          transport,
          port,
          catalog,
          inspect,
          format,
          ui,
          error: '--transport requires a value (stdio|http)',
        };
      }
      transport = next;
      i += 2;
    } else if (arg === '--port') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return { transport, port, catalog, inspect, format, ui, error: '--port requires a value' };
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          transport,
          port,
          catalog,
          inspect,
          format,
          ui,
          error: '--port must be a positive number',
        };
      }
      port = parsed;
      i += 2;
    } else if (arg === '--catalog') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return {
          transport,
          port,
          catalog,
          inspect,
          format,
          ui,
          error: '--catalog requires a path value',
        };
      }
      catalog = next;
      i += 2;
    } else {
      return {
        transport,
        port,
        catalog,
        inspect,
        format,
        ui,
        error: `mcp received unexpected argument: ${String(arg)}`,
      };
    }
  }

  return { transport, port, catalog, inspect, format, ui };
}

/**
 * Tool category groupings for --inspect output.
 */
const TOOL_CATEGORIES: ReadonlyArray<{
  readonly heading: string;
  readonly names: readonly string[];
}> = [
  {
    heading: 'Workflow Execution',
    names: ['dag_run_definition', 'dag_run_file', 'dag_runs_poll_progress', 'dag_runs_cancel'],
  },
  {
    heading: 'Node Discovery',
    names: ['dag_nodes_list', 'dag_nodes_info', 'dag_node_packages_list'],
  },
  {
    heading: 'DAG Building',
    names: ['dag_build', 'dag_validate', 'dag_build_from_template'],
  },
  {
    heading: 'Catalog',
    names: ['dag_catalog_list', 'dag_catalog_search', 'dag_catalog_run'],
  },
  {
    heading: 'Instant Nodes',
    names: [
      'dag_instant_node_create',
      'dag_instant_node_create_composite',
      'dag_instant_node_list',
    ],
  },
  {
    heading: 'Templates',
    names: ['dag_templates_list'],
  },
  {
    heading: 'Format Conversion',
    names: ['dag_export', 'dag_import'],
  },
];

/** Print MCP tool reference to stdout. */
function printInspect(): void {
  const DIVIDER = '─'.repeat(62);

  process.stdout.write('\nrobota-dag MCP Server — Tool Reference\n');
  process.stdout.write(`${DIVIDER}\n\n`);

  process.stdout.write('Integration:\n');
  process.stdout.write('  Claude Code: dag init --claude  (auto-configures .claude/mcp.json)\n');
  process.stdout.write('  Other:       Add to MCP client config with transport: stdio\n');
  process.stdout.write('               Command: dag mcp --transport stdio\n');
  process.stdout.write('\nAvailable Tools (use with Claude Code or any MCP client):\n');

  const toolMap = new Map<string, (typeof TOOL_DEFINITIONS)[number]>(
    TOOL_DEFINITIONS.map((t) => [t.name as string, t]),
  );
  const categorized = new Set<string>();

  for (const cat of TOOL_CATEGORIES) {
    const catTools = cat.names.map((n) => toolMap.get(n)).filter((t) => t !== undefined);
    if (catTools.length === 0) continue;

    process.stdout.write(`\n  [${cat.heading}]\n`);
    for (const tool of catTools) {
      categorized.add(tool.name);
      process.stdout.write(`  ${tool.name}\n`);
      process.stdout.write(`    ${tool.description}\n`);

      // Show required input fields
      const schema = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        const props = schema.properties;
        const required = new Set(schema.required ?? []);
        const entries = Object.entries(props);
        const inputStr = entries
          .map(([k, v]) => {
            const typeStr = typeof v.type === 'string' ? v.type : 'any';
            const req = required.has(k) ? '' : '?';
            return `${k}${req}: ${typeStr}`;
          })
          .join(', ');
        process.stdout.write(`    Input: { ${inputStr} }\n`);
      } else {
        process.stdout.write(`    Input: (none)\n`);
      }
    }
  }

  // Any uncategorized tools
  const uncategorized = TOOL_DEFINITIONS.filter((t) => !categorized.has(t.name));
  if (uncategorized.length > 0) {
    process.stdout.write('\n  [Other]\n');
    for (const tool of uncategorized) {
      process.stdout.write(`  ${tool.name}\n`);
      process.stdout.write(`    ${tool.description}\n`);
    }
  }

  process.stdout.write("\nRun 'dag mcp --transport stdio' to start the MCP server.\n\n");
}

/** Print Markdown tool reference for README / docs embedding. */
function printInspectMarkdown(): void {
  const lines: string[] = [
    '# robota-dag MCP Server — Tool Reference',
    '',
    '## Integration',
    '',
    '```bash',
    '# Claude Code (auto-configure)',
    'dag init --claude',
    '',
    '# Any MCP client',
    'dag mcp --transport stdio',
    '```',
    '',
    '## Available Tools',
    '',
  ];

  const toolMap = new Map<string, (typeof TOOL_DEFINITIONS)[number]>(
    TOOL_DEFINITIONS.map((t) => [t.name as string, t]),
  );
  const categorized = new Set<string>();

  for (const cat of TOOL_CATEGORIES) {
    const catTools = cat.names.map((n) => toolMap.get(n)).filter((t) => t !== undefined);
    if (catTools.length === 0) continue;

    lines.push(`### ${cat.heading}`, '');
    lines.push('| Tool | Description |');
    lines.push('|------|-------------|');
    for (const tool of catTools) {
      categorized.add(tool.name);
      lines.push(`| \`${tool.name}\` | ${tool.description} |`);
    }
    lines.push('');
  }

  const uncategorized = TOOL_DEFINITIONS.filter((t) => !categorized.has(t.name));
  if (uncategorized.length > 0) {
    lines.push('### Other', '');
    lines.push('| Tool | Description |');
    lines.push('|------|-------------|');
    for (const tool of uncategorized) {
      lines.push(`| \`${tool.name}\` | ${tool.description} |`);
    }
    lines.push('');
  }

  process.stdout.write(lines.join('\n') + '\n');
}

/** Print awesome-mcp submission Markdown. */
function printAwesomeMcpMarkdown(): void {
  const toolCount = TOOL_DEFINITIONS.length;
  const featuredTools = TOOL_DEFINITIONS.slice(0, 4)
    .map((t) => `\`${t.name}\``)
    .join(', ');
  const remaining = toolCount - 4;

  const lines = [
    '## robota-dag',
    '',
    '> AI workflow orchestration MCP server — build and run multi-provider LLM pipelines without a server',
    '',
    '**Install:** `npx @robota-sdk/dag-cli mcp` or `dag init --claude` for Claude Code',
    '',
    `**Tools:** ${featuredTools} + ${remaining} more`,
    '',
    '**Use cases:**',
    '',
    '- Build multi-provider LLM pipelines (Anthropic, OpenAI, Gemini, DeepSeek)',
    '- Run DAG workflows from Claude Code without writing code',
    '- Compare providers by cost and quality',
    '- Create reusable prompt-backed instant nodes',
    '',
    '[![npm](https://img.shields.io/npm/v/@robota-sdk/dag-cli)](https://npmjs.com/package/@robota-sdk/dag-cli)',
    '[![GitHub](https://img.shields.io/github/stars/woojubb/robota?style=social)](https://github.com/woojubb/robota)',
    '',
  ];

  process.stdout.write(lines.join('\n') + '\n');
}

const UI_SERVER_PORT = 3099;
const UI_SERVER_TIMEOUT_MS = 30_000;

function buildInspectHtml(): string {
  const toolMap = new Map<string, (typeof TOOL_DEFINITIONS)[number]>(
    TOOL_DEFINITIONS.map((t) => [t.name as string, t]),
  );

  let sections = '';
  const categorized = new Set<string>();

  for (const cat of TOOL_CATEGORIES) {
    const catTools = cat.names.map((n) => toolMap.get(n)).filter((t) => t !== undefined);
    if (catTools.length === 0) continue;
    const rows = catTools
      .map((tool) => {
        categorized.add(tool.name);
        const schema = tool.inputSchema as {
          properties?: Record<string, { type?: string; description?: string }>;
          required?: string[];
        };
        const inputs =
          schema.properties && Object.keys(schema.properties).length > 0
            ? Object.entries(schema.properties)
                .map(([k, v]) => {
                  const req = new Set(schema.required ?? []).has(k) ? '' : '?';
                  return `<code>${k}${req}: ${typeof v.type === 'string' ? v.type : 'any'}</code>`;
                })
                .join(', ')
            : '<em>(none)</em>';
        return `<tr><td><strong>${tool.name}</strong></td><td>${tool.description}</td><td>${inputs}</td></tr>`;
      })
      .join('\n');
    sections += `<h3>${cat.heading}</h3><table><thead><tr><th>Tool</th><th>Description</th><th>Inputs</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const uncategorized = TOOL_DEFINITIONS.filter((t) => !categorized.has(t.name));
  if (uncategorized.length > 0) {
    const rows = uncategorized
      .map(
        (tool) =>
          `<tr><td><strong>${tool.name}</strong></td><td>${tool.description}</td><td></td></tr>`,
      )
      .join('\n');
    sections += `<h3>Other</h3><table><thead><tr><th>Tool</th><th>Description</th><th>Inputs</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>robota-dag MCP Tools</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-size:1.6rem;border-bottom:2px solid #4f46e5;padding-bottom:.5rem}
  h3{margin-top:1.5rem;color:#4f46e5}
  table{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem}
  th{background:#4f46e5;color:#fff;text-align:left;padding:.4rem .7rem;font-size:.85rem}
  td{padding:.4rem .7rem;border-bottom:1px solid #e5e7eb;font-size:.88rem;vertical-align:top}
  tr:nth-child(even) td{background:#f9fafb}
  code{background:#f3f4f6;padding:.1em .3em;border-radius:3px;font-size:.83rem}
  .tip{background:#ede9fe;border-left:4px solid #4f46e5;padding:.7rem 1rem;margin:1rem 0;border-radius:0 6px 6px 0;font-size:.9rem}
</style>
</head>
<body>
<h1>robota-dag MCP Server — Tool Reference</h1>
<div class="tip">
  <strong>Integration:</strong> Run <code>dag init --claude</code> to auto-configure Claude Code.<br>
  Or add to any MCP client: <code>dag mcp --transport stdio</code>
</div>
${sections}
</body></html>`;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin'
      ? `open "${url}"`
      : platform === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    // allow-fallback: browser open is best-effort; URL is already printed to stdout
  }
}

function startInspectUi(): Promise<number> {
  return new Promise((resolve) => {
    const html = buildInspectHtml();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.listen(UI_SERVER_PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${UI_SERVER_PORT}`;
      process.stdout.write(`\nMCP Tool Reference → ${url}\n`);
      openBrowser(url);

      setTimeout(() => {
        server.close();
        resolve(SUCCESS_EXIT_CODE);
      }, UI_SERVER_TIMEOUT_MS);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `Port ${UI_SERVER_PORT} already in use. Run dag mcp --inspect instead.\n`,
        );
      } else {
        process.stderr.write(`UI server error: ${err.message}\n`);
      }
      resolve(FAILURE_EXIT_CODE);
    });
  });
}

/**
 * Execute the `robota-dag mcp` subcommand.
 *
 * @param args - The argv slice starting after the `mcp` keyword.
 * @param options - Optional overrides for testing.
 * @returns Exit code.
 */
/** Print TOOL_DEFINITIONS as JSON; optional --tool <name> filter. */
function printSchema(args: readonly string[]): number {
  let toolFilter: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tool') {
      toolFilter = args[i + 1];
      i += 1;
    } else if (!args[i]?.startsWith('--')) {
      process.stderr.write(
        `Error: dag mcp schema received unexpected argument: ${String(args[i])}\n`,
      );
      return USAGE_ERROR_EXIT_CODE;
    }
  }

  const output = toolFilter
    ? TOOL_DEFINITIONS.filter((t) => t.name === toolFilter)
    : TOOL_DEFINITIONS;

  if (toolFilter !== undefined && output.length === 0) {
    process.stderr.write(
      `Error: no tool named "${toolFilter}" found. Run 'dag mcp --inspect' to list tools.\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  process.stdout.write(JSON.stringify(toolFilter ? output[0] : output, null, 2) + '\n');
  return SUCCESS_EXIT_CODE;
}

export async function mcpCommand(
  args: readonly string[],
  options: IMcpCommandOptions = {},
): Promise<number> {
  if (args[0] === 'schema') {
    return printSchema(args.slice(1));
  }

  const parsed = parseMcpArgv(args);
  if (parsed.error) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  // Handle --inspect: print tool reference (or open browser UI) and exit
  if (parsed.inspect) {
    if (parsed.ui) {
      return startInspectUi();
    }
    if (parsed.format === 'markdown') {
      printInspectMarkdown();
      return SUCCESS_EXIT_CODE;
    }
    if (parsed.format === 'awesome-mcp') {
      printAwesomeMcpMarkdown();
      return SUCCESS_EXIT_CODE;
    }
    printInspect();
    return SUCCESS_EXIT_CODE;
  }

  if (parsed.transport !== 'stdio') {
    process.stderr.write('HTTP transport not yet implemented\n');
    return FAILURE_EXIT_CODE;
  }

  const server = createLocalMcpServer(options);

  if (options.skipConnect) {
    return SUCCESS_EXIT_CODE;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server.connect() keeps the process alive until the transport closes
  return SUCCESS_EXIT_CODE;
}
