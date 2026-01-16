import { Config } from '../types/index.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 環境変数から設定を読み込む
 */
export function loadConfig(): Config {
  dotenv.config();

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません');
  }
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID が設定されていません');
  }

  return {
    google: {
      serviceAccountKey,
      spreadsheetId,
    },
    notion: process.env.NOTION_API_KEY
      ? {
          apiKey: process.env.NOTION_API_KEY,
          agentDbId: process.env.NOTION_AGENT_DB_ID || '',
          playerDbId: process.env.NOTION_PLAYER_DB_ID || '',
          weeklySummaryDbId: process.env.NOTION_WEEKLY_SUMMARY_DB_ID || '',
          weeklyDetailDbId: process.env.NOTION_WEEKLY_DETAIL_DB_ID || '',
        }
      : undefined,
  };
}

/**
 * ファイルパスを検証する
 */
export function validateFilePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`ファイルが見つかりません: ${absolutePath}`);
  }

  if (!absolutePath.endsWith('.xlsx') && !absolutePath.endsWith('.xls')) {
    throw new Error('Excelファイル (.xlsx または .xls) を指定してください');
  }

  return absolutePath;
}

/**
 * ログユーティリティ
 */
export const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  success: (message: string) => console.log(`[SUCCESS] ${message}`),
  warn: (message: string) => console.warn(`[WARN] ${message}`),
};

/**
 * 日付を YYYY-MM-DD 形式にフォーマット
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 週の期間をフォーマット
 */
export function formatWeekPeriod(start: Date, end: Date): string {
  return `${formatDate(start)}〜${formatDate(end)}`;
}

/**
 * 数値を文字列に変換（null/undefinedは空文字）
 */
export function numToStr(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
