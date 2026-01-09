import * as XLSX from "xlsx";
import * as fs from "fs";

/**
 * Excelファイルを解析してデータを取得
 */
export async function parseExcelFile(
  filePath: string,
  sheetName?: string
): Promise<(string | number)[][]> {
  // ファイルの存在確認
  if (!fs.existsSync(filePath)) {
    throw new Error(`ファイルが見つかりません: ${filePath}`);
  }

  // Excelファイルを読み込み
  const workbook = XLSX.readFile(filePath);

  // シート名の決定
  const targetSheet = sheetName || workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(targetSheet)) {
    throw new Error(
      `シートが見つかりません: ${targetSheet}\n利用可能なシート: ${workbook.SheetNames.join(", ")}`
    );
  }

  // シートデータを取得
  const worksheet = workbook.Sheets[targetSheet];
  const data: (string | number)[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
  });

  // 空行を除去
  const filteredData = data.filter((row) =>
    row.some((cell) => cell !== "" && cell !== null && cell !== undefined)
  );

  return filteredData;
}

/**
 * XPoker形式のExcelファイルを解析
 * TODO: XPokerの実際のExcel形式に合わせて実装
 */
export async function parseXPokerExcel(
  filePath: string
): Promise<XPokerData[]> {
  const rawData = await parseExcelFile(filePath);

  // ヘッダー行をスキップ
  const dataRows = rawData.slice(1);

  // TODO: XPokerの実際のカラム構造に合わせてマッピング
  return dataRows.map((row) => ({
    playerName: String(row[0] || ""),
    playerId: String(row[1] || ""),
    buyIn: Number(row[2]) || 0,
    cashOut: Number(row[3]) || 0,
    profit: Number(row[4]) || 0,
    date: String(row[5] || ""),
  }));
}

export interface XPokerData {
  playerName: string;
  playerId: string;
  buyIn: number;
  cashOut: number;
  profit: number;
  date: string;
}
