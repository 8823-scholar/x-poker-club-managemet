import { getSheetData } from "../lib/google-sheets.js";
import { syncToNotion } from "../lib/notion.js";
import { getCurrentWeekNumber } from "../lib/utils.js";

interface SyncOptions {
  week?: string;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const weekNumber = options.week
    ? parseInt(options.week, 10)
    : getCurrentWeekNumber();

  console.log(`Week ${weekNumber} のデータをNotionに同期中...`);

  try {
    // スプレッドシートからデータを取得
    const data = await getSheetData(`週次集計!A:Z`);
    if (!data || data.length === 0) {
      console.log("同期するデータがありません");
      return;
    }

    // Notionに同期
    await syncToNotion(data, weekNumber);
    console.log("Notionへの同期完了");
  } catch (error) {
    console.error("同期エラー:", error);
    process.exit(1);
  }
}
