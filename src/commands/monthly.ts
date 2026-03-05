import { Command } from 'commander';
import {
  createNotionClient,
  getLatestWeeklyTotals,
  getWeeklyTotalsByDateRange,
  getCostsByDateRange,
  getOwnerWeeklySummaryByTotals,
  getPlayerPageIdByPlayerId,
  upsertMonthlySummary,
  updateCostMonthlyRelation,
  parseWeekPeriod,
  WeeklyTotalRecord,
} from '../lib/notion.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface MonthlyOptions {
  weeks?: string;
  from?: string;
  to?: string;
  title?: string;
  dryRun?: boolean;
}

/**
 * 月次集計の実行
 */
async function runMonthly(options: MonthlyOptions): Promise<void> {
  try {
    // 1. 設定読み込み・バリデーション
    const config = loadConfig();

    if (!config.notion) {
      logger.error('Notion設定が見つかりません。.envファイルを確認してください');
      process.exit(1);
    }

    if (!config.notion.monthlySummaryDbId || !config.notion.monthlySummaryDataSourceId) {
      logger.error('月次集計DBの設定が見つかりません。NOTION_MONTHLY_SUMMARY_DB_ID / NOTION_MONTHLY_SUMMARY_DATA_SOURCE_ID を設定してください');
      process.exit(1);
    }

    if (!config.notion.weeklyTotalDataSourceId) {
      logger.error('週次トータルDBのData Source IDが設定されていません');
      process.exit(1);
    }

    if (!config.houseOwners) {
      logger.error('ハウスオーナーの設定が見つかりません。HOUSE_OWNER_PLAYER_ID_1 / HOUSE_OWNER_PLAYER_ID_2 を設定してください');
      process.exit(1);
    }

    const weekCount = parseInt(options.weeks || '4', 10);
    if (isNaN(weekCount) || weekCount < 1) {
      logger.error('対象週数は1以上の数値を指定してください');
      process.exit(1);
    }

    // 2. Notionクライアント作成
    const notion = createNotionClient(config);
    logger.info('Notion APIに接続しました');

    // 3. 対象の週次トータルを特定
    let weeklyTotals: WeeklyTotalRecord[];

    if (options.from && options.to) {
      // 開始・終了週の両方指定
      const fromPeriod = parseWeekPeriod(options.from);
      const toPeriod = parseWeekPeriod(options.to);
      logger.info(`期間指定: ${options.from} 〜 ${options.to}`);
      weeklyTotals = await getWeeklyTotalsByDateRange(
        notion,
        config.notion.weeklyTotalDataSourceId,
        fromPeriod.start,
        toPeriod.start
      );
    } else if (options.to) {
      // 終了週のみ指定 → そこから逆算
      const toPeriod = parseWeekPeriod(options.to);
      logger.info(`終了週: ${options.to} から直近${weekCount}週間分を取得`);
      // 終了週以前のデータを取得
      const allTotals = await getWeeklyTotalsByDateRange(
        notion,
        config.notion.weeklyTotalDataSourceId,
        '2000-01-01',
        toPeriod.start
      );
      // 最新n件を取得（日付降順にソートして先頭n件）
      weeklyTotals = allTotals
        .sort((a, b) => b.weekPeriod.localeCompare(a.weekPeriod))
        .slice(0, weekCount)
        .sort((a, b) => a.weekPeriod.localeCompare(b.weekPeriod));
    } else {
      // 未指定 → 最新から逆算
      logger.info(`最新の週次トータルから直近${weekCount}週間分を取得`);
      weeklyTotals = await getLatestWeeklyTotals(
        notion,
        config.notion.weeklyTotalDataSourceId,
        weekCount
      );
      // 日付昇順に並べ替え
      weeklyTotals.sort((a, b) => a.weekPeriod.localeCompare(b.weekPeriod));
    }

    if (weeklyTotals.length === 0) {
      logger.error('対象の週次トータルが見つかりませんでした');
      process.exit(1);
    }

    logger.info(`対象週: ${weeklyTotals.length}件`);
    for (const wt of weeklyTotals) {
      logger.info(`  - ${wt.weekPeriod}`);
    }

    // 4. 月次集計値の計算
    const totalRake = weeklyTotals.reduce((sum, wt) => sum + wt.totalRake, 0);
    const totalRakeback = weeklyTotals.reduce((sum, wt) => sum + wt.totalRakeback, 0);
    const totalAgentFee = weeklyTotals.reduce((sum, wt) => sum + wt.totalAgentFee, 0);
    const houseRevenue = weeklyTotals.reduce((sum, wt) => sum + wt.houseRevenue, 0);

    // 5. コスト取得
    const firstWeekPeriod = parseWeekPeriod(weeklyTotals[0].weekPeriod);
    const lastWeekPeriod = parseWeekPeriod(weeklyTotals[weeklyTotals.length - 1].weekPeriod);
    const periodStart = firstWeekPeriod.start;
    const periodEnd = lastWeekPeriod.end;

    let totalCost = 0;
    let owner1Cost = 0;
    let owner2Cost = 0;
    let costs: { pageId: string; title: string; amount: number; date: string; payerPageId: string | null }[] = [];

    if (config.notion.costDataSourceId) {
      costs = await getCostsByDateRange(
        notion,
        config.notion.costDataSourceId,
        periodStart,
        periodEnd
      );
      totalCost = costs.reduce((sum, c) => sum + c.amount, 0);

      // オーナーのNotionページIDを取得してコストを振り分け
      if (config.notion.playerDataSourceId && costs.length > 0) {
        const owner1PageId = await getPlayerPageIdByPlayerId(
          notion,
          config.notion.playerDataSourceId,
          config.houseOwners.owner1PlayerId
        );
        const owner2PageId = await getPlayerPageIdByPlayerId(
          notion,
          config.notion.playerDataSourceId,
          config.houseOwners.owner2PlayerId
        );

        for (const c of costs) {
          if (owner1PageId && c.payerPageId === owner1PageId) {
            owner1Cost += c.amount;
          } else if (owner2PageId && c.payerPageId === owner2PageId) {
            owner2Cost += c.amount;
          }
        }
      }

      if (costs.length > 0) {
        logger.info(`コスト: ${costs.length}件`);
        for (const c of costs) {
          logger.info(`  - ${c.title}: ¥${c.amount.toLocaleString()} (${c.date})`);
        }
      } else {
        logger.info('対象期間のコストはありません');
      }
    }

    // 6. 利益計算
    const finalProfit = houseRevenue - totalCost;
    const ownerShare = Math.floor(finalProfit / 2);

    // 7. オーナー週次データの取得・集計
    const weeklyTotalPageIds = weeklyTotals.map((wt) => wt.pageId);

    let owner1Summary = { pageIds: [] as string[], totalRevenue: 0, totalRakeback: 0 };
    let owner2Summary = { pageIds: [] as string[], totalRevenue: 0, totalRakeback: 0 };

    if (config.notion.weeklyDetailDataSourceId) {
      logger.info('のすけの週次データを取得中...');
      owner1Summary = await getOwnerWeeklySummaryByTotals(
        notion,
        config.notion.weeklyDetailDataSourceId,
        weeklyTotalPageIds,
        config.houseOwners.owner1PlayerId
      );
      logger.info(`  のすけ:${owner1Summary.pageIds.length}件`);

      logger.info('せいさんの週次データを取得中...');
      owner2Summary = await getOwnerWeeklySummaryByTotals(
        notion,
        config.notion.weeklyDetailDataSourceId,
        weeklyTotalPageIds,
        config.houseOwners.owner2PlayerId
      );
      logger.info(`  せいさん:${owner2Summary.pageIds.length}件`);
    }

    // オーナー最終精算を計算（分配額 + 成績 + レーキバック + 立替コスト補填）
    const owner1FinalSettlement = ownerShare + owner1Summary.totalRevenue + owner1Summary.totalRakeback + owner1Cost;
    const owner2FinalSettlement = ownerShare + owner2Summary.totalRevenue + owner2Summary.totalRakeback + owner2Cost;

    // タイトル生成
    const title = options.title || generateMonthlyTitle(periodStart, periodEnd);

    // 8. 結果表示
    logger.info('');
    logger.info('=== 月次集計結果 ===');
    logger.info(`タイトル: ${title}`);
    logger.info(`期間: ${periodStart} 〜 ${periodEnd}`);
    logger.info(`対象週数: ${weeklyTotals.length}`);
    logger.info('');
    logger.info('--- 収支 ---');
    logger.info(`総レーキ:           ¥${totalRake.toLocaleString()}`);
    logger.info(`総レーキバック:     ¥${totalRakeback.toLocaleString()}`);
    logger.info(`総エージェントフィー: ¥${totalAgentFee.toLocaleString()}`);
    logger.info(`ハウス売上:         ¥${houseRevenue.toLocaleString()}`);
    logger.info(`コスト合計:         ¥${totalCost.toLocaleString()}`);
    logger.info(`最終利益:           ¥${finalProfit.toLocaleString()}`);
    logger.info(`オーナー分配額:     ¥${ownerShare.toLocaleString()}`);
    logger.info('');
    logger.info('--- のすけ ---');
    logger.info(`成績合計:           ¥${owner1Summary.totalRevenue.toLocaleString()}`);
    logger.info(`レーキバック合計:   ¥${owner1Summary.totalRakeback.toLocaleString()}`);
    logger.info(`立替コスト:         ¥${owner1Cost.toLocaleString()}`);
    logger.info(`最終精算:           ¥${owner1FinalSettlement.toLocaleString()}`);
    logger.info('');
    logger.info('--- せいさん ---');
    logger.info(`成績合計:           ¥${owner2Summary.totalRevenue.toLocaleString()}`);
    logger.info(`レーキバック合計:   ¥${owner2Summary.totalRakeback.toLocaleString()}`);
    logger.info(`立替コスト:         ¥${owner2Cost.toLocaleString()}`);
    logger.info(`最終精算:           ¥${owner2FinalSettlement.toLocaleString()}`);

    if (options.dryRun) {
      logger.info('');
      logger.info('=== Dry-run モード ===');
      logger.info('実際の変更は行われませんでした');
      return;
    }

    // 9. Notionに月次集計を作成/更新
    logger.info('');
    logger.info('Notionに月次集計を書き込み中...');

    const summaryData = {
      title,
      periodStart,
      periodEnd,
      weekCount: weeklyTotals.length,
      totalRake,
      totalRakeback,
      totalAgentFee,
      houseRevenue,
      totalCost,
      finalProfit,
      ownerShare,
      owner1Cost,
      owner2Cost,
      owner1FinalSettlement,
      owner2FinalSettlement,
      weeklyTotalPageIds,
      owner1DetailPageIds: owner1Summary.pageIds,
      owner2DetailPageIds: owner2Summary.pageIds,
      costPageIds: costs.map((c) => c.pageId),
    };

    const { pageId, created } = await upsertMonthlySummary(
      notion,
      config.notion.monthlySummaryDbId,
      config.notion.monthlySummaryDataSourceId,
      summaryData
    );
    logger.success(`月次集計ページを${created ? '作成' : '更新'}しました: ${pageId}`);

    // 10. コストDBの月次集計リレーションを更新
    if (costs.length > 0) {
      logger.info('コストのリレーションを更新中...');
      for (const cost of costs) {
        await updateCostMonthlyRelation(notion, cost.pageId, pageId);
      }
      logger.success(`${costs.length}件のコストをリレーション紐付けしました`);
    }

    logger.success('月次集計が完了しました');
  } catch (error) {
    if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error('予期しないエラーが発生しました');
    }
    process.exit(1);
  }
}

/**
 * 月次タイトルを自動生成
 * 期間の終了月をベースに "YYYY-MM月度" 形式のタイトルを生成
 */
function generateMonthlyTitle(periodStart: string, periodEnd: string): string {
  const endDate = new Date(periodEnd);
  const year = endDate.getFullYear();
  const month = String(endDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}月度`;
}

/**
 * monthlyコマンドを作成
 */
export function createMonthlyCommand(): Command {
  const command = new Command('monthly')
    .description('月次集計レポートを生成してNotionに同期')
    .option('-n, --weeks <number>', '対象週数', '4')
    .option('--from <weekPeriod>', '開始週期間（例: "2026-01-27〜2026-02-02"）')
    .option('--to <weekPeriod>', '終了週期間（例: "2026-02-17〜2026-02-23"）')
    .option('--title <title>', '月次集計タイトル（省略時: 自動生成）')
    .option('--dry-run', 'Notionに書き込まずに結果を表示')
    .action(async (options: MonthlyOptions) => {
      await runMonthly(options);
    });

  return command;
}
