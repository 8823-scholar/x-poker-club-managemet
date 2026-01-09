import { getSheetData } from "../lib/google-sheets.js";
import { getCurrentWeekNumber } from "../lib/utils.js";

interface ReportOptions {
  week?: string;
  output: string;
}

export async function reportCommand(options: ReportOptions): Promise<void> {
  const weekNumber = options.week
    ? parseInt(options.week, 10)
    : getCurrentWeekNumber();

  console.log(`Week ${weekNumber} の週次レポートを生成中...`);

  try {
    // スプレッドシートからデータを取得
    const data = await getSheetData(`データ!A:Z`);
    if (!data || data.length === 0) {
      console.log("レポート対象のデータがありません");
      return;
    }

    // TODO: 週次集計ロジックを実装
    const report = generateWeeklyReport(data, weekNumber);

    if (options.output === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } catch (error) {
    console.error("レポート生成エラー:", error);
    process.exit(1);
  }
}

interface WeeklyReport {
  weekNumber: number;
  totalPlayers: number;
  totalGames: number;
  summary: Record<string, number>;
}

function generateWeeklyReport(
  data: string[][],
  weekNumber: number
): WeeklyReport {
  // TODO: 実際の集計ロジックを実装
  return {
    weekNumber,
    totalPlayers: 0,
    totalGames: 0,
    summary: {},
  };
}

function printReport(report: WeeklyReport): void {
  console.log("\n========== 週次レポート ==========");
  console.log(`週番号: ${report.weekNumber}`);
  console.log(`プレイヤー数: ${report.totalPlayers}`);
  console.log(`ゲーム数: ${report.totalGames}`);
  console.log("==================================\n");
}
