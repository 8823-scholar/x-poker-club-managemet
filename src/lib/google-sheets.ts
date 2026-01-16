import { google, sheets_v4 } from 'googleapis';
import { Config, ParsedExcelData } from '../types/index.js';
import { formatWeekPeriod, numToStr } from './utils.js';

/**
 * 基本ヘッダー（固定部分）
 */
const BASE_HEADERS = [
  '週期間',
  '取込日時',
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
export function flattenData(
  parsed: ParsedExcelData,
  importedAt: Date
): string[][] {
  const weekPeriod = formatWeekPeriod(
    parsed.metadata.periodStart,
    parsed.metadata.periodEnd
  );
  const importedAtStr = importedAt.toISOString();

  return parsed.players.map((player) => {
    // 基本データ
    const baseData = [
      weekPeriod,
      importedAtStr,
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
 * シートの存在を確認し、なければ作成
 */
async function ensureSheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetExists = spreadsheet.data.sheets?.some(
    (s) => s.properties?.title === sheetName
  );

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
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
  }
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
 * スプレッドシートにデータを追記
 */
export async function appendToSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  data: string[][],
  headers: string[]
): Promise<{ addedRows: number; range: string }> {
  // シートの存在確認と作成
  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // ヘッダー行の確認と追加
  await ensureHeaderRow(sheets, spreadsheetId, sheetName, headers);

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
    range: response.data.updates?.updatedRange || '',
  };
}
