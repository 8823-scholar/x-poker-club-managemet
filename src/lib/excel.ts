import XLSX from 'xlsx';
import { ExcelMetadata, ParsedExcelData, PlayerRow, GameTypeData } from '../types/index.js';

/**
 * カラムインデックス（0-indexed）
 */
const COLUMN = {
  NICKNAME: 0,
  PLAYER_ID: 1,
  REMARK: 2,
  AGENT_NAME: 3,
  AGENT_ID: 4,
  SUPER_AGENT_NAME: 5,
  SUPER_AGENT_ID: 6,
  COUNTRY: 7,
  PLAYER_REVENUE_TOTAL: 8,
  PLAYER_REVENUE_GAME_START: 9,
  PLAYER_REVENUE_GAME_END: 47,
  CLUB_RAKE_TOTAL: 51,
  CLUB_RAKE_GAME_START: 52,
  CLUB_RAKE_GAME_END: 90,
  HANDS_TOTAL: 109,
  HANDS_GAME_START: 110,
  HANDS_GAME_END: 148,
} as const;

/**
 * 日本語形式の日付をパース（YYYY/MM/DD）
 */
function parseJapaneseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * 値を数値に変換（null安全）
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * 値を文字列に変換（null安全）
 */
function toString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/**
 * メタ情報をパース
 */
function parseMetadata(data: unknown[][]): ExcelMetadata {
  // 行2: "データ: 2025/12/25 - 2025/12/31 (Time Zone:Asia/Tokyo),輸出実行ユーザー: 3839823"
  const row2 = toString(data[1]?.[0]);

  const dateMatch = row2.match(
    /データ:\s*(\d{4}\/\d{2}\/\d{2})\s*-\s*(\d{4}\/\d{2}\/\d{2})/
  );
  const timezoneMatch = row2.match(/Time Zone:([^,)]+)/);
  const exporterMatch = row2.match(/輸出実行ユーザー:\s*(\d+)/);

  // 行5: "クラブ:SSS.297 ID:2483983"
  const row5 = toString(data[4]?.[0]);
  const clubMatch = row5.match(/クラブ:(.+?)\s+ID:(\d+)/);

  return {
    periodStart: dateMatch ? parseJapaneseDate(dateMatch[1]) : new Date(),
    periodEnd: dateMatch ? parseJapaneseDate(dateMatch[2]) : new Date(),
    timezone: timezoneMatch?.[1]?.trim() || 'Asia/Tokyo',
    exportedBy: exporterMatch?.[1] || '',
    clubName: clubMatch?.[1] || '',
    clubId: clubMatch?.[2] || '',
  };
}

/**
 * ヘッダー行からゲームタイプ名を抽出
 */
function extractGameTypeNames(headerRow: unknown[]): string[] {
  const gameTypes: string[] = [];
  for (let i = COLUMN.PLAYER_REVENUE_GAME_START; i <= COLUMN.PLAYER_REVENUE_GAME_END; i++) {
    const name = toString(headerRow[i]);
    if (name) {
      gameTypes.push(name);
    }
  }
  return gameTypes;
}

/**
 * プレーヤー行をパース
 */
function parsePlayerRow(row: unknown[], gameTypeNames: string[]): PlayerRow | null {
  const nickname = toString(row[COLUMN.NICKNAME]);
  const playerId = toString(row[COLUMN.PLAYER_ID]);

  // 空行、合計行、ヘッダー行をスキップ
  if (!nickname || nickname === '合計' || !playerId || playerId === 'プレーヤー ID') {
    return null;
  }

  // クラブ情報行をスキップ
  if (nickname.startsWith('クラブ:')) {
    return null;
  }

  // ゲームタイプ別データを抽出
  const gameTypes: Record<string, GameTypeData> = {};
  for (let i = 0; i < gameTypeNames.length; i++) {
    const gameTypeName = gameTypeNames[i];
    const revenueIdx = COLUMN.PLAYER_REVENUE_GAME_START + i;
    const rakeIdx = COLUMN.CLUB_RAKE_GAME_START + i;
    const handsIdx = COLUMN.HANDS_GAME_START + i;

    gameTypes[gameTypeName] = {
      revenue: toNumber(row[revenueIdx]),
      rake: toNumber(row[rakeIdx]),
      hands: toNumber(row[handsIdx]),
    };
  }

  return {
    nickname,
    playerId,
    remark: toString(row[COLUMN.REMARK]),
    agentName: row[COLUMN.AGENT_NAME] ? toString(row[COLUMN.AGENT_NAME]) : null,
    agentId: row[COLUMN.AGENT_ID] ? toString(row[COLUMN.AGENT_ID]) : null,
    superAgentName: row[COLUMN.SUPER_AGENT_NAME]
      ? toString(row[COLUMN.SUPER_AGENT_NAME])
      : null,
    superAgentId: row[COLUMN.SUPER_AGENT_ID]
      ? toString(row[COLUMN.SUPER_AGENT_ID])
      : null,
    country: toString(row[COLUMN.COUNTRY]),
    playerRevenueTotal: toNumber(row[COLUMN.PLAYER_REVENUE_TOTAL]),
    clubRevenueTotal: toNumber(row[COLUMN.CLUB_RAKE_TOTAL]),
    handsTotal: toNumber(row[COLUMN.HANDS_TOTAL]),
    gameTypes,
  };
}

/**
 * Excelファイルを解析
 */
export async function parseExcelFile(filePath: string): Promise<ParsedExcelData> {
  const workbook = XLSX.readFile(filePath);

  // 「クラブ詳細」シートを使用
  const sheetName = 'クラブ詳細';
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`シート「${sheetName}」が見つかりません`);
  }

  // シートを2次元配列に変換
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // メタ情報を抽出
  const metadata = parseMetadata(data);

  // ヘッダー行（行4、インデックス3）からゲームタイプ名を抽出
  const headerRow = data[3] || [];
  const gameTypeNames = extractGameTypeNames(headerRow);

  // プレーヤーデータを抽出（行6から）
  const players: PlayerRow[] = [];

  for (let i = 5; i < data.length; i++) {
    const row = data[i];
    if (!row || !Array.isArray(row) || row.length === 0) continue;

    // 合計行を検出したら終了
    if (toString(row[0]) === '合計') {
      break;
    }

    const playerRow = parsePlayerRow(row, gameTypeNames);
    if (playerRow) {
      players.push(playerRow);
    }
  }

  return { metadata, players, gameTypeNames };
}
