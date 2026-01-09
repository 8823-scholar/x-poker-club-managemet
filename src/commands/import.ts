import { parseExcelFile } from "../lib/excel.js";
import { appendSheetData } from "../lib/google-sheets.js";

interface ImportOptions {
  sheet: string;
}

export async function importCommand(
  filePath: string,
  options: ImportOptions
): Promise<void> {
  console.log(`Excelファイルを取り込み中: ${filePath}`);

  try {
    // Excelファイルを解析
    const data = await parseExcelFile(filePath, options.sheet);
    console.log(`${data.length} 行のデータを検出`);

    // スプレッドシートに追加
    await appendSheetData("データ!A:Z", data);
    console.log("スプレッドシートへの取り込み完了");
  } catch (error) {
    console.error("取り込みエラー:", error);
    process.exit(1);
  }
}
