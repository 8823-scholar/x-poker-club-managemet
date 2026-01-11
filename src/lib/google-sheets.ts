import { google, sheets_v4 } from 'googleapis';
import { Config, ParsedExcelData } from '../types/index.js';
import { formatWeekPeriod, numToStr } from './utils.js';

/**
 * ヘッダー行の定義
 */
const HEADERS = [
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
  'プレーヤー収益',
  'クラブレーキ',
];

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

  return parsed.players.map((player) => [
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
  ]);
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
  sheetName: string
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
        values: [HEADERS],
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
  data: string[][]
): Promise<{ addedRows: number; range: string }> {
  // シートの存在確認と作成
  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  // ヘッダー行の確認と追加
  await ensureHeaderRow(sheets, spreadsheetId, sheetName);

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
