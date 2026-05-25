import type { INotionPage, INotionBlock } from './types.js';

interface IRawRichTextItem {
  plain_text?: string;
}

interface IRawTitleProperty {
  title?: IRawRichTextItem[];
}

interface IRawProperties {
  title?: IRawTitleProperty;
  Name?: IRawTitleProperty;
  [key: string]: unknown;
}

interface IRawPage {
  id: string;
  url: string;
  last_edited_time: string;
  properties: IRawProperties;
}

interface IRawParagraphContent {
  rich_text?: IRawRichTextItem[];
}

interface IRawBlockContent {
  rich_text?: IRawRichTextItem[];
}

interface IRawBlock {
  id: string;
  type: string;
  paragraph?: IRawParagraphContent;
  heading_1?: IRawBlockContent;
  heading_2?: IRawBlockContent;
  heading_3?: IRawBlockContent;
  bulleted_list_item?: IRawBlockContent;
  numbered_list_item?: IRawBlockContent;
  to_do?: IRawBlockContent;
  toggle?: IRawBlockContent;
  quote?: IRawBlockContent;
  callout?: IRawBlockContent;
  code?: IRawBlockContent;
  [key: string]: unknown;
}

interface IRawBlocksResponse {
  results: IRawBlock[];
}

interface IRawSearchResponse {
  results: IRawPage[];
}

function extractTitleFromProperties(properties: IRawProperties): string {
  const titleProp = properties.title ?? properties.Name;
  if (titleProp?.title && titleProp.title.length > 0) {
    return titleProp.title.map((t) => t.plain_text ?? '').join('');
  }
  return '';
}

function extractPlainText(block: IRawBlock): string {
  const content = block[block.type] as IRawBlockContent | undefined;
  if (!content?.rich_text) return '';
  return content.rich_text.map((t) => t.plain_text ?? '').join('');
}

export class NotionClient {
  private readonly baseUrl = 'https://api.notion.com/v1';
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
  }

  async getPage(pageId: string): Promise<INotionPage> {
    const res = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawPage;
    return {
      id: data.id,
      title: extractTitleFromProperties(data.properties),
      url: data.url,
      lastEdited: data.last_edited_time,
      properties: data.properties as Record<string, unknown>,
    };
  }

  async getPageBlocks(pageId: string): Promise<INotionBlock[]> {
    const res = await fetch(`${this.baseUrl}/blocks/${pageId}/children`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawBlocksResponse;
    return data.results.map((block) => ({
      id: block.id,
      type: block.type,
      text: extractPlainText(block),
    }));
  }

  async createPage(parentPageId: string, title: string, content?: string): Promise<INotionPage> {
    const children = content
      ? [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content } }],
            },
          },
        ]
      : [];

    const res = await fetch(`${this.baseUrl}/pages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: 'text', text: { content: title } }],
          },
        },
        children,
      }),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawPage;
    return {
      id: data.id,
      title: extractTitleFromProperties(data.properties),
      url: data.url,
      lastEdited: data.last_edited_time,
      properties: data.properties as Record<string, unknown>,
    };
  }

  async searchPages(query: string, limit = 10): Promise<INotionPage[]> {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        query,
        filter: { value: 'page', property: 'object' },
        page_size: limit,
      }),
    });
    if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as IRawSearchResponse;
    return data.results.map((page) => ({
      id: page.id,
      title: extractTitleFromProperties(page.properties),
      url: page.url,
      lastEdited: page.last_edited_time,
      properties: page.properties as Record<string, unknown>,
    }));
  }
}
