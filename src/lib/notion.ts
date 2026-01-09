import { Client } from "@notionhq/client";

let notionClient: Client | null = null;

/**
 * Notion APIクライアントを取得
 */
export function getNotionClient(): Client {
  if (notionClient) {
    return notionClient;
  }

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error("NOTION_API_KEY が設定されていません");
  }

  notionClient = new Client({ auth: apiKey });
  return notionClient;
}

/**
 * Notion データベースIDを取得
 */
export function getDatabaseId(): string {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID が設定されていません");
  }
  return databaseId;
}

/**
 * スプレッドシートのデータをNotionに同期
 */
export async function syncToNotion(
  data: string[][],
  weekNumber: number
): Promise<void> {
  const notion = getNotionClient();
  const databaseId = getDatabaseId();

  // ヘッダー行を取得
  const headers = data[0];
  const rows = data.slice(1);

  for (const row of rows) {
    // TODO: 実際のNotionデータベース構造に合わせてプロパティを設定
    await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        // 週番号
        週番号: {
          number: weekNumber,
        },
        // その他のプロパティは実際のデータ構造に応じて設定
        // 例:
        // プレイヤー名: { title: [{ text: { content: row[0] || "" } }] },
        // 金額: { number: parseFloat(row[1]) || 0 },
      },
    });
  }
}

/**
 * Notionページの集金状況を更新
 */
export async function updateCollectionStatus(
  pageId: string,
  status: "未集金" | "集金済" | "一部集金"
): Promise<void> {
  const notion = getNotionClient();

  await notion.pages.update({
    page_id: pageId,
    properties: {
      集金状況: {
        select: { name: status },
      },
    },
  });
}

/**
 * 特定週の集金データを取得
 */
export async function getCollectionData(weekNumber: number): Promise<unknown[]> {
  const notion = getNotionClient();
  const databaseId = getDatabaseId();

  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "週番号",
      number: {
        equals: weekNumber,
      },
    },
  });

  return response.results;
}
