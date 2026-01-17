import { Client } from '@notionhq/client';
import { Config } from '../types/index.js';

/**
 * エージェントDBのスキーマ定義
 */
export const AGENT_DB_SCHEMA = {
  'エージェント名': { title: {} },
  'エージェントID': { rich_text: {} },
  'リマーク': { rich_text: {} },
  'Super Agent': { rich_text: {} },
  'フィーレート': { number: { format: 'percent' } },
} as const;

/**
 * 週次集金DBのスキーマ定義
 * ※ 集計系プロパティはrollupで週次集金個別DBから集計
 * ※ 週次集金個別へのリレーションはrollupの参照元として必要
 */
export const WEEKLY_SUMMARY_DB_SCHEMA = {
  'タイトル': { title: {} },
  '週期間': { rich_text: {} },
  'エージェント': { relation: { single_property: {} } },
  'プレイヤー数': { number: { format: 'number' } },
  'エージェント報酬': { number: { format: 'yen' } },
  'エージェント精算額': { number: { format: 'yen' } },
} as const;

/**
 * 週次集金DBの週次集金個別へのリレーション（rollup用）
 * ※ migrateで週次集金個別DBのIDを設定
 */
export const WEEKLY_SUMMARY_DETAIL_RELATION_NAME = '週次集金個別';

/**
 * 週次集金DBのロールアッププロパティ定義
 * ※ migrateでリレーション名を動的に設定
 */
export const WEEKLY_SUMMARY_ROLLUP_SCHEMA = {
  'レーキ合計': {
    rollup: {
      rollup_property_name: 'レーキ',
      function: 'sum',
    },
  },
  'レーキバック合計': {
    rollup: {
      rollup_property_name: 'レーキバック',
      function: 'sum',
    },
  },
  '収益合計': {
    rollup: {
      rollup_property_name: '収益',
      function: 'sum',
    },
  },
  '精算金額合計': {
    rollup: {
      rollup_property_name: '金額',
      function: 'sum',
    },
  },
} as const;

/**
 * 週次集金個別DBのスキーマ定義
 * ※ 週次集金へのリレーションはdual_propertyで逆リレーションも作成
 */
export const WEEKLY_DETAIL_DB_SCHEMA = {
  'プレイヤー名': { title: {} },
  '週次集金': { relation: { dual_property: { synced_property_name: '週次集金個別' } } },
  'プレイヤー': { relation: { single_property: {} } },
  'プレイヤーID': { rich_text: {} },
  '収益': { number: { format: 'yen' } },
  'レーキ': { number: { format: 'yen' } },
  'レーキバックレート': { number: { format: 'percent' } },
  'レーキバック': { number: { format: 'yen' } },
  '精算金額': { number: { format: 'yen' } },
} as const;

/**
 * プレイヤーDBのスキーマ定義
 */
export const PLAYER_DB_SCHEMA = {
  'ニックネーム': { title: {} },
  'プレイヤーID': { rich_text: {} },
  'エージェント': { relation: { single_property: {} } },
  '国/地域': { rich_text: {} },
  'リマーク': { rich_text: {} },
  'レーキバックレート': { number: { format: 'percent' } },
} as const;

/**
 * Notionクライアントを作成
 */
export function createNotionClient(config: Config): Client {
  if (!config.notion?.apiKey) {
    throw new Error('NOTION_API_KEY が設定されていません');
  }
  return new Client({ auth: config.notion.apiKey });
}

/**
 * データベースのプロパティを取得
 */
export async function getDatabaseProperties(
  client: Client,
  databaseId: string
): Promise<Record<string, unknown>> {
  const response = await client.databases.retrieve({ database_id: databaseId });
  return (response as { properties: Record<string, unknown> }).properties;
}

/**
 * リレーションプロパティの参照先データベースIDを取得
 */
export async function getRelationTargetDatabaseId(
  client: Client,
  databaseId: string,
  propertyName: string
): Promise<string | null> {
  const props = await getDatabaseProperties(client, databaseId);
  const prop = props[propertyName] as { type?: string; relation?: { database_id?: string } } | undefined;
  if (prop?.type === 'relation' && prop.relation?.database_id) {
    return prop.relation.database_id;
  }
  return null;
}

/**
 * データベースに不足しているプロパティを追加
 */
export async function ensureDatabaseProperties(
  client: Client,
  databaseId: string,
  requiredSchema: Record<string, unknown>,
  relationDbId?: string
): Promise<{ added: string[]; existing: string[]; renamed?: string }> {
  const existingProps = await getDatabaseProperties(client, databaseId);
  const existingNames = new Set(Object.keys(existingProps));

  const added: string[] = [];
  const existing: string[] = [];
  const propertiesToAdd: Record<string, unknown> = {};
  let renamed: string | undefined;

  // スキーマからタイトルプロパティ名を取得
  let requiredTitleName: string | undefined;
  for (const [propName, propConfig] of Object.entries(requiredSchema)) {
    if ('title' in (propConfig as Record<string, unknown>)) {
      requiredTitleName = propName;
      break;
    }
  }

  // 既存のタイトルプロパティを見つける
  let existingTitleName: string | undefined;
  for (const [propName, propConfig] of Object.entries(existingProps)) {
    if ((propConfig as Record<string, unknown>).type === 'title') {
      existingTitleName = propName;
      break;
    }
  }

  // タイトルプロパティの名前が異なる場合はリネーム
  if (requiredTitleName && existingTitleName && requiredTitleName !== existingTitleName) {
    await client.databases.update({
      database_id: databaseId,
      properties: {
        [existingTitleName]: {
          name: requiredTitleName,
        },
      } as Parameters<typeof client.databases.update>[0]['properties'],
    });
    renamed = `${existingTitleName} → ${requiredTitleName}`;
  }

  for (const [propName, propConfig] of Object.entries(requiredSchema)) {
    // タイトルプロパティはリネーム済みなのでスキップ
    const isTitle = 'title' in (propConfig as Record<string, unknown>);
    if (isTitle) {
      existing.push(propName);
      continue;
    }

    if (existingNames.has(propName)) {
      existing.push(propName);
    } else {
      added.push(propName);
      // リレーションの場合、database_idを設定
      const propConfigTyped = propConfig as { relation?: { single_property?: object; dual_property?: { synced_property_name: string } } };
      if (propConfigTyped.relation && relationDbId) {
        if (propConfigTyped.relation.dual_property) {
          // dual_property: 双方向リレーション（逆リレーションも作成）
          propertiesToAdd[propName] = {
            relation: {
              database_id: relationDbId,
              dual_property: {
                synced_property_name: propConfigTyped.relation.dual_property.synced_property_name,
              },
            },
          };
        } else {
          // single_property: 単方向リレーション
          propertiesToAdd[propName] = {
            relation: {
              database_id: relationDbId,
              single_property: {},
            },
          };
        }
      } else {
        propertiesToAdd[propName] = propConfig;
      }
    }
  }

  if (Object.keys(propertiesToAdd).length > 0) {
    await client.databases.update({
      database_id: databaseId,
      properties: propertiesToAdd as Parameters<typeof client.databases.update>[0]['properties'],
    });
  }

  return { added, existing, renamed };
}

/**
 * データベースにrollupプロパティを追加
 * 既存プロパティがrollup以外の型の場合はリネームしてからrollupを作成
 * @param client Notionクライアント
 * @param databaseId 対象データベースのID
 * @param rollupSchema rollupスキーマ定義
 * @param relationPropertyName リレーションプロパティ名
 */
export async function ensureRollupProperties(
  client: Client,
  databaseId: string,
  rollupSchema: Record<string, { rollup: { rollup_property_name: string; function: string } }>,
  relationPropertyName: string
): Promise<{ added: string[]; existing: string[]; converted: string[] }> {
  const existingProps = await getDatabaseProperties(client, databaseId);

  const added: string[] = [];
  const existing: string[] = [];
  const converted: string[] = [];
  const propertiesToRename: Record<string, unknown> = {};
  const propertiesToAdd: Record<string, unknown> = {};

  for (const [propName, propConfig] of Object.entries(rollupSchema)) {
    const existingProp = existingProps[propName] as { type?: string } | undefined;

    if (existingProp) {
      if (existingProp.type === 'rollup') {
        // 既にrollup型なのでスキップ
        existing.push(propName);
      } else {
        // 別の型で存在する場合はリネームしてrollupを作成
        converted.push(propName);
        propertiesToRename[propName] = {
          name: `${propName}_old`,
        };
        propertiesToAdd[propName] = {
          rollup: {
            relation_property_name: relationPropertyName,
            rollup_property_name: propConfig.rollup.rollup_property_name,
            function: propConfig.rollup.function,
          },
        };
      }
    } else {
      // 存在しない場合は新規作成
      added.push(propName);
      propertiesToAdd[propName] = {
        rollup: {
          relation_property_name: relationPropertyName,
          rollup_property_name: propConfig.rollup.rollup_property_name,
          function: propConfig.rollup.function,
        },
      };
    }
  }

  // 既存プロパティをリネーム
  if (Object.keys(propertiesToRename).length > 0) {
    await client.databases.update({
      database_id: databaseId,
      properties: propertiesToRename as Parameters<typeof client.databases.update>[0]['properties'],
    });
  }

  // rollupプロパティを追加
  if (Object.keys(propertiesToAdd).length > 0) {
    await client.databases.update({
      database_id: databaseId,
      properties: propertiesToAdd as Parameters<typeof client.databases.update>[0]['properties'],
    });
  }

  return { added, existing, converted };
}

/**
 * エージェントデータの型（Notion用）
 */
export interface NotionAgentData {
  agentId: string;
  agentName: string;
  remark: string;
  superAgentName: string;
  feeRate: number;
}

/**
 * エージェントをNotionから検索
 */
export async function findAgentByAgentId(
  client: Client,
  databaseId: string,
  agentId: string
): Promise<string | null> {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      property: 'エージェントID',
      rich_text: {
        equals: agentId,
      },
    },
    page_size: 1,
  });

  if (response.results.length > 0) {
    return response.results[0].id;
  }
  return null;
}

/**
 * 全エージェントをNotionから取得
 */
export async function getAllAgents(
  client: Client,
  databaseId: string
): Promise<Map<string, { pageId: string; feeRate: number }>> {
  const agents = new Map<string, { pageId: string; feeRate: number }>();
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!('properties' in page)) continue;
      const props = page.properties as Record<string, unknown>;

      const agentIdProp = props['エージェントID'] as { rich_text?: { plain_text: string }[] } | undefined;
      const feeRateProp = props['フィーレート'] as { number?: number | null } | undefined;

      const agentId = agentIdProp?.rich_text?.[0]?.plain_text || '';
      const feeRate = feeRateProp?.number ?? 0.7;

      if (agentId) {
        agents.set(agentId, { pageId: page.id, feeRate });
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return agents;
}

/**
 * エージェントをNotionに作成
 */
export async function createAgent(
  client: Client,
  databaseId: string,
  agent: NotionAgentData
): Promise<string> {
  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: {
      'エージェント名': {
        title: [{ text: { content: agent.agentName } }],
      },
      'エージェントID': {
        rich_text: [{ text: { content: agent.agentId } }],
      },
      'リマーク': {
        rich_text: [{ text: { content: agent.remark } }],
      },
      'Super Agent': {
        rich_text: [{ text: { content: agent.superAgentName } }],
      },
      'フィーレート': {
        number: agent.feeRate,
      },
    },
  });

  return response.id;
}

/**
 * 週次集金データの型（Notion用）
 * ※ 集計系フィールド（レーキ合計、レーキバック合計、収益合計、金額合計）はrollupで自動集計
 */
export interface NotionWeeklySummaryData {
  weekPeriod: string;
  agentName: string;
  agentPageId: string;
  playerCount: number;
  agentReward: number;
  settlementAmount: number;
}

/**
 * 週次集金をNotionから検索
 */
export async function findWeeklySummary(
  client: Client,
  databaseId: string,
  weekPeriod: string,
  agentPageId: string
): Promise<string | null> {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        {
          property: '週期間',
          rich_text: {
            equals: weekPeriod,
          },
        },
        {
          property: 'エージェント',
          relation: {
            contains: agentPageId,
          },
        },
      ],
    },
    page_size: 1,
  });

  if (response.results.length > 0) {
    return response.results[0].id;
  }
  return null;
}

/**
 * 週次集金をNotionに作成または更新
 */
export async function upsertWeeklySummary(
  client: Client,
  databaseId: string,
  data: NotionWeeklySummaryData
): Promise<{ pageId: string; created: boolean }> {
  const existingPageId = await findWeeklySummary(
    client,
    databaseId,
    data.weekPeriod,
    data.agentPageId
  );

  // ※ 集計系フィールド（レーキ合計、レーキバック合計、収益合計、金額合計）はrollupで自動集計
  const properties = {
    'タイトル': {
      title: [{ text: { content: `${data.weekPeriod} - ${data.agentName}` } }],
    },
    '週期間': {
      rich_text: [{ text: { content: data.weekPeriod } }],
    },
    'エージェント': {
      relation: [{ id: data.agentPageId }],
    },
    'プレイヤー数': {
      number: data.playerCount,
    },
    'エージェント報酬': {
      number: data.agentReward,
    },
    'エージェント精算額': {
      number: data.settlementAmount,
    },
  };

  if (existingPageId) {
    await client.pages.update({
      page_id: existingPageId,
      properties,
    });
    return { pageId: existingPageId, created: false };
  }

  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties,
  });
  return { pageId: response.id, created: true };
}

/**
 * 週次集金の週次集金個別リレーションを更新
 */
export async function updateWeeklySummaryDetailRelation(
  client: Client,
  summaryPageId: string,
  detailPageIds: string[]
): Promise<void> {
  await client.pages.update({
    page_id: summaryPageId,
    properties: {
      [WEEKLY_SUMMARY_DETAIL_RELATION_NAME]: {
        relation: detailPageIds.map((id) => ({ id })),
      },
    },
  });
}

/**
 * 週次集金を週期間で全件取得
 */
export async function getAllWeeklySummariesByPeriod(
  client: Client,
  databaseId: string,
  weekPeriod: string
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>(); // agentPageId -> summaryPageId
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: {
        property: '週期間',
        rich_text: {
          equals: weekPeriod,
        },
      },
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!('properties' in page)) continue;
      const props = page.properties as Record<string, unknown>;
      const agentProp = props['エージェント'] as { relation?: { id: string }[] } | undefined;
      const agentPageId = agentProp?.relation?.[0]?.id || '';
      if (agentPageId) {
        summaries.set(agentPageId, page.id);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return summaries;
}

/**
 * 週次集金個別を週次集金で全件取得
 */
export async function getAllWeeklyDetailsBySummary(
  client: Client,
  databaseId: string,
  summaryPageId: string
): Promise<Map<string, string>> {
  const details = new Map<string, string>(); // playerId -> detailPageId
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: {
        property: '週次集金',
        relation: {
          contains: summaryPageId,
        },
      },
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!('properties' in page)) continue;
      const props = page.properties as Record<string, unknown>;
      const playerIdProp = props['プレイヤーID'] as { rich_text?: { plain_text: string }[] } | undefined;
      const playerId = playerIdProp?.rich_text?.[0]?.plain_text || '';
      if (playerId) {
        details.set(playerId, page.id);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return details;
}

/**
 * Notionページをアーカイブ（削除）
 */
export async function archiveNotionPage(
  client: Client,
  pageId: string
): Promise<void> {
  await client.pages.update({
    page_id: pageId,
    archived: true,
  });
}

/**
 * 週次集金個別データの型（Notion用）
 */
export interface NotionWeeklyDetailData {
  nickname: string;
  summaryPageId: string;
  playerPageId?: string;
  playerId: string;
  revenue: number;
  rake: number;
  rakebackRate: number;
  rakeback: number;
  amount: number;
}

/**
 * 週次集金個別をNotionから検索
 */
export async function findWeeklyDetail(
  client: Client,
  databaseId: string,
  summaryPageId: string,
  playerId: string
): Promise<string | null> {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        {
          property: '週次集金',
          relation: {
            contains: summaryPageId,
          },
        },
        {
          property: 'プレイヤーID',
          rich_text: {
            equals: playerId,
          },
        },
      ],
    },
    page_size: 1,
  });

  if (response.results.length > 0) {
    return response.results[0].id;
  }
  return null;
}

/**
 * 週次集金個別をNotionに作成または更新
 */
export async function upsertWeeklyDetail(
  client: Client,
  databaseId: string,
  data: NotionWeeklyDetailData
): Promise<{ pageId: string; created: boolean }> {
  const existingPageId = await findWeeklyDetail(
    client,
    databaseId,
    data.summaryPageId,
    data.playerId
  );

  const properties: Record<string, unknown> = {
    'プレイヤー名': {
      title: [{ text: { content: data.nickname } }],
    },
    '週次集金': {
      relation: [{ id: data.summaryPageId }],
    },
    'プレイヤーID': {
      rich_text: [{ text: { content: data.playerId } }],
    },
    '収益': {
      number: data.revenue,
    },
    'レーキ': {
      number: data.rake,
    },
    'レーキバックレート': {
      number: data.rakebackRate,
    },
    'レーキバック': {
      number: data.rakeback,
    },
    '精算金額': {
      number: data.amount,
    },
  };

  // プレイヤーリレーションがある場合のみ追加
  if (data.playerPageId) {
    properties['プレイヤー'] = { relation: [{ id: data.playerPageId }] };
  }

  if (existingPageId) {
    await client.pages.update({
      page_id: existingPageId,
      properties: properties as Parameters<typeof client.pages.update>[0]['properties'],
    });
    return { pageId: existingPageId, created: false };
  }

  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: properties as Parameters<typeof client.pages.create>[0]['properties'],
  });
  return { pageId: response.id, created: true };
}

/**
 * Google Sheetsのエージェントデータの型
 */
export interface SheetsAgentData {
  agentId: string;
  agentName: string;
  superAgentId: string;
  superAgentName: string;
  feeRate: number;
  remark: string;
}

/**
 * Google Sheetsからエージェントデータを読み込む
 */
export async function readAgentDataFromSheets(
  sheets: import('googleapis').sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<SheetsAgentData[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:F`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return [];
  }

  const agents: SheetsAgentData[] = [];
  // ヘッダー行をスキップ
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    agents.push({
      agentId: row[0] || '',
      agentName: row[1] || '',
      remark: row[2] || '',
      superAgentId: row[3] || '',
      superAgentName: row[4] || '',
      feeRate: parseFloat(row[5]) || 0.7,
    });
  }

  return agents;
}

/**
 * 集金データの型（sync用）
 */
export interface CollectionDataRow {
  weekPeriod: string;
  agentName: string;
  agentId: string;
  playerNickname: string;
  playerId: string;
  revenue: number;
  rake: number;
  rakebackRate: number;
  rakeback: number;
  amount: number;
}

/**
 * Google Sheetsから集金データを読み込む
 */
export async function readCollectionDataFromSheets(
  sheets: import('googleapis').sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  weekPeriod: string
): Promise<CollectionDataRow[]> {
  // ヘッダー行を取得
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const headers = headerResponse.data.values?.[0] || [];
  const colIndex = {
    weekPeriod: headers.indexOf('週期間'),
    agentName: headers.indexOf('エージェント名'),
    agentId: headers.indexOf('エージェントID'),
    playerNickname: headers.indexOf('プレーヤーニックネーム'),
    playerId: headers.indexOf('プレーヤーID'),
    revenue: headers.indexOf('収益'),
    rake: headers.indexOf('レーキ'),
    rakebackRate: headers.indexOf('レーキバックレート'),
    rakeback: headers.indexOf('レーキバック'),
    amount: headers.indexOf('金額'),
  };

  // 全データを取得
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:J`,
  });

  const rows = dataResponse.data.values || [];
  const result: CollectionDataRow[] = [];

  // ヘッダー行をスキップしてデータ行を処理
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[colIndex.weekPeriod] !== weekPeriod) {
      continue;
    }

    result.push({
      weekPeriod: row[colIndex.weekPeriod] || '',
      agentName: row[colIndex.agentName] || '',
      agentId: row[colIndex.agentId] || '',
      playerNickname: row[colIndex.playerNickname] || '',
      playerId: row[colIndex.playerId] || '',
      revenue: parseFloat(row[colIndex.revenue]) || 0,
      rake: parseFloat(row[colIndex.rake]) || 0,
      rakebackRate: parseFloat(row[colIndex.rakebackRate]) || 0,
      rakeback: parseFloat(row[colIndex.rakeback]) || 0,
      amount: parseFloat(row[colIndex.amount]) || 0,
    });
  }

  return result;
}

/**
 * プレイヤーデータの型（Notion用）
 */
export interface NotionPlayerData {
  playerId: string;
  nickname: string;
  agentId: string;
  agentPageId: string | null;
  country: string;
  remark: string;
  rakebackRate: number;
}

/**
 * 全プレイヤーをNotionから取得（プレイヤーID + エージェントページIDの組み合わせで一意）
 */
export async function getAllPlayers(
  client: Client,
  databaseId: string
): Promise<Map<string, string>> {
  const players = new Map<string, string>();
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!('properties' in page)) continue;
      const props = page.properties as Record<string, unknown>;

      const playerIdProp = props['プレイヤーID'] as { rich_text?: { plain_text: string }[] } | undefined;
      const agentProp = props['エージェント'] as { relation?: { id: string }[] } | undefined;

      const playerId = playerIdProp?.rich_text?.[0]?.plain_text || '';
      const agentPageId = agentProp?.relation?.[0]?.id || '';

      if (playerId) {
        // キー: プレイヤーID:エージェントページID
        const key = `${playerId}:${agentPageId}`;
        players.set(key, page.id);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }

  return players;
}

/**
 * プレイヤーをNotionに作成または更新
 */
export async function upsertPlayer(
  client: Client,
  databaseId: string,
  data: NotionPlayerData,
  existingPageId?: string
): Promise<{ pageId: string; created: boolean }> {
  const properties: Record<string, unknown> = {
    'ニックネーム': {
      title: [{ text: { content: data.nickname } }],
    },
    'プレイヤーID': {
      rich_text: [{ text: { content: data.playerId } }],
    },
    '国/地域': {
      rich_text: [{ text: { content: data.country } }],
    },
    'リマーク': {
      rich_text: [{ text: { content: data.remark } }],
    },
    'レーキバックレート': {
      number: data.rakebackRate,
    },
  };

  // エージェントリレーションがある場合のみ追加
  if (data.agentPageId) {
    properties['エージェント'] = {
      relation: [{ id: data.agentPageId }],
    };
  }

  if (existingPageId) {
    await client.pages.update({
      page_id: existingPageId,
      properties: properties as Parameters<typeof client.pages.update>[0]['properties'],
    });
    return { pageId: existingPageId, created: false };
  }

  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: properties as Parameters<typeof client.pages.create>[0]['properties'],
  });
  return { pageId: response.id, created: true };
}

/**
 * Google Sheetsのプレイヤーデータの型
 */
export interface SheetsPlayerData {
  playerId: string;
  nickname: string;
  agentId: string;
  agentName: string;
  country: string;
  remark: string;
  rakebackRate: number;
}

/**
 * Google Sheetsからプレイヤーデータを読み込む
 */
export async function readPlayerDataFromSheets(
  sheets: import('googleapis').sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<SheetsPlayerData[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:G`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return [];
  }

  const players: SheetsPlayerData[] = [];
  // ヘッダー行をスキップ
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    players.push({
      playerId: row[0] || '',
      nickname: row[1] || '',
      agentId: row[2] || '',
      agentName: row[3] || '',
      country: row[4] || '',
      remark: row[5] || '',
      rakebackRate: parseFloat(row[6]) || 0,
    });
  }

  return players;
}
