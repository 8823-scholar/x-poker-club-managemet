import { google, sheets_v4 } from 'googleapis';
import { Config, ParsedExcelData } from '../types/index.js';
import { formatWeekPeriod, numToStr } from './utils.js';

/**
 * 基本ヘッダー（固定部分）
 */
const BASE_HEADERS = [
  '週期間',
  'クラブID',
  'ニックネーム',
  'プレーヤーID',
  'リマーク',
  'エージェント',
  'エージェントID',
  'Super Agent',
  'Super Agent ID',
  '国/地域',
  'プレーヤー収益_合計',
  'クラブレーキ_合計',
  'ハンド数_合計',
];

/**
 * ゲームタイプ別ヘッダーを生成
 */
function generateGameTypeHeaders(gameTypeNames: string[]): string[] {
  const headers: string[] = [];
  for (const gameType of gameTypeNames) {
    headers.push(`${gameType}_収益`);
    headers.push(`${gameType}_レーキ`);
    headers.push(`${gameType}_ハンド数`);
  }
  return headers;
}

/**
 * 完全なヘッダー行を生成
 */
export function generateHeaders(gameTypeNames: string[]): string[] {
  return [...BASE_HEADERS, ...generateGameTypeHeaders(gameTypeNames)];
}

/**
 * Google Sheets クライアントを作成
 */
export async function createSheetsClient(
  config: Config
): Promise<sheets_v4.Sheets> {
  const keyJson = JSON.parse(
    Buffer.from(config.google.serviceAccountKey, 'base64').toString('utf-8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * データをフラット化してスプレッドシート用の配列に変換
 */
export function flattenData(parsed: ParsedExcelData): string[][] {
  const weekPeriod = formatWeekPeriod(
    parsed.metadata.periodStart,
    parsed.metadata.periodEnd
  );

  return parsed.players.map((player) => {
    // 基本データ
    const baseData = [
      weekPeriod,
      parsed.metadata.clubId,
      player.nickname,
      player.playerId,
      player.remark,
      player.agentName || '',
      player.agentId || '',
      player.superAgentName || '',
      player.superAgentId || '',
      player.country,
      numToStr(player.playerRevenueTotal),
      numToStr(player.clubRevenueTotal),
      numToStr(player.handsTotal),
    ];

    // ゲームタイプ別データ
    const gameTypeData: string[] = [];
    for (const gameType of parsed.gameTypeNames) {
      const data = player.gameTypes[gameType];
      gameTypeData.push(numToStr(data?.revenue));
      gameTypeData.push(numToStr(data?.rake));
      gameTypeData.push(numToStr(data?.hands));
    }

    return [...baseData, ...gameTypeData];
  });
}

/**
 * シートの存在を確認し、なければ作成。シートIDを返す
 */
async function ensureSheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<number> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );

  if (existingSheet?.properties?.sheetId != null) {
    return existingSheet.properties.sheetId;
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: sheetName },
          },
        },
      ],
    },
  });

  return response.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
}

/**
 * 既存データを検索して削除（週期間とクラブIDが一致する行）
 */
export async function deleteExistingData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  sheetId: number,
  weekPeriod: string,
  clubId: string
): Promise<number> {
  // A列（週期間）とB列（クラブID）を取得
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:B`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return 0; // ヘッダー行のみ
  }

  // 削除対象の行インデックスを特定（下から削除するため逆順でソート）
  const rowsToDelete: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === weekPeriod && row[1] === clubId) {
      rowsToDelete.push(i);
    }
  }

  if (rowsToDelete.length === 0) {
    return 0;
  }

  // 下から削除（インデックスがずれないように）
  rowsToDelete.sort((a, b) => b - a);

  const requests = rowsToDelete.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex,
        endIndex: rowIndex + 1,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return rowsToDelete.length;
}

/**
 * ヘッダー行を確認し、なければ追加
 */
async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headers: string[]
): Promise<void> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:1`,
  });

  const firstRow = response.data.values?.[0];

  if (!firstRow || firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers],
      },
    });
  }
}

/**
 * スプレッドシートにデータを追記（既存データは削除して上書き）
 */
export async function appendToSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  data: string[][],
  headers: string[],
  weekPeriod: string,
  clubId: string
): Promise<{ addedRows: number; deletedRows: number; range: string }> {
  // シートの存在確認と作成
  const sheetId = await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // ヘッダー行の確認と追加
  await ensureHeaderRow(sheets, spreadsheetId, sheetName, headers);

  // 既存データを削除
  const deletedRows = await deleteExistingData(
    sheets,
    spreadsheetId,
    sheetName,
    sheetId,
    weekPeriod,
    clubId
  );

  // データを追記
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: data,
    },
  });

  return {
    addedRows: data.length,
    deletedRows,
    range: response.data.updates?.updatedRange || '',
  };
}

/**
 * 集金データ用のヘッダー
 */
export const COLLECTION_HEADERS = [
  '週期間',
  'エージェント名',
  'エージェントID',
  'プレーヤーニックネーム',
  'プレーヤーID',
  '収益',
  '金額',
];

/**
 * 既存データを検索して削除（週期間のみで判定）
 */
async function deleteExistingDataByWeekPeriod(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  sheetId: number,
  weekPeriod: string
): Promise<number> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return 0;
  }

  const rowsToDelete: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === weekPeriod) {
      rowsToDelete.push(i);
    }
  }

  if (rowsToDelete.length === 0) {
    return 0;
  }

  rowsToDelete.sort((a, b) => b - a);

  const requests = rowsToDelete.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex,
        endIndex: rowIndex + 1,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return rowsToDelete.length;
}

/**
 * 集金データシートにデータを追記（週期間のみで冪等性担保）
 */
export async function appendCollectionData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  data: string[][],
  headers: string[],
  weekPeriod: string
): Promise<{ addedRows: number; deletedRows: number; range: string }> {
  const sheetId = await ensureSheetExists(sheets, spreadsheetId, sheetName);
  await ensureHeaderRow(sheets, spreadsheetId, sheetName, headers);

  const deletedRows = await deleteExistingDataByWeekPeriod(
    sheets,
    spreadsheetId,
    sheetName,
    sheetId,
    weekPeriod
  );

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: data,
    },
  });

  return {
    addedRows: data.length,
    deletedRows,
    range: response.data.updates?.updatedRange || '',
  };
}

/**
 * 週次データシートから利用可能な週期間一覧を取得
 */
export async function getAvailableWeekPeriods(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return [];
  }

  // ユニークな週期間を取得（ヘッダー行をスキップ）
  const periods = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const period = rows[i][0];
    if (period) {
      periods.add(period);
    }
  }

  // 降順でソート（最新が先頭）
  return Array.from(periods).sort().reverse();
}

/**
 * 週次データを読み込む
 */
export interface WeeklyPlayerData {
  weekPeriod: string;
  clubId: string;
  nickname: string;
  playerId: string;
  agentName: string;
  agentId: string;
  playerRevenue: number;
}

export async function readWeeklyData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  weekPeriod: string
): Promise<WeeklyPlayerData[]> {
  // ヘッダー行を取得してカラムインデックスを特定
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const headers = headerResponse.data.values?.[0] || [];
  const colIndex = {
    weekPeriod: headers.indexOf('週期間'),
    clubId: headers.indexOf('クラブID'),
    nickname: headers.indexOf('ニックネーム'),
    playerId: headers.indexOf('プレーヤーID'),
    agentName: headers.indexOf('エージェント'),
    agentId: headers.indexOf('エージェントID'),
    playerRevenue: headers.indexOf('プレーヤー収益_合計'),
  };

  // 全データを取得
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const rows = dataResponse.data.values || [];
  const result: WeeklyPlayerData[] = [];

  // ヘッダー行をスキップしてデータ行を処理
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[colIndex.weekPeriod] !== weekPeriod) {
      continue;
    }

    result.push({
      weekPeriod: row[colIndex.weekPeriod] || '',
      clubId: row[colIndex.clubId] || '',
      nickname: row[colIndex.nickname] || '',
      playerId: row[colIndex.playerId] || '',
      agentName: row[colIndex.agentName] || '',
      agentId: row[colIndex.agentId] || '',
      playerRevenue: parseFloat(row[colIndex.playerRevenue]) || 0,
    });
  }

  return result;
}
