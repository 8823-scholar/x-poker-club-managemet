import { Command } from 'commander';
import {
  createSheetsClient,
  getAvailableWeekPeriods,
} from '../lib/google-sheets.js';
import {
  createNotionClient,
  getAllAgents,
  getAllPlayers,
  createAgent,
  upsertWeeklySummary,
  upsertWeeklyDetail,
  upsertWeeklyTotal,
  upsertPlayer,
  updateWeeklySummaryDetailRelation,
  getAllWeeklySummariesByPeriod,
  getAllWeeklyDetailsBySummary,
  archiveNotionPage,
  readAgentDataFromSheets,
  readCollectionDataFromSheets,
  readPlayerDataFromSheets,
  NotionAgentData,
  NotionWeeklySummaryData,
  NotionWeeklyDetailData,
  NotionWeeklyTotalData,
  NotionPlayerData,
  CollectionDataRow,
} from '../lib/notion.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface SyncOptions {
  collectionSheet?: string;
  agentSheet?: string;
  playerSheet?: string;
  dryRun?: boolean;
}

/**
 * エージェント毎の集計データ
 * ※ Notionでは集計系フィールド（レーキ合計、レーキバック合計、収益合計、金額合計）はrollupで集計
 * ※ totalRake, totalRakeback, totalAmountはエージェント報酬・精算金額の計算に必要なため保持
 */
interface AgentSyncSummary {
  agentId: string;
  agentName: string;
  feeRate: number;
  players: CollectionDataRow[];
  totalRake: number;
  totalRakeback: number;
  totalAmount: number;
  agentReward: number;
  settlementAmount: number;
}

/**
 * 集金データをエージェント毎にグループ化して集計
 */
function groupCollectionByAgent(
  collectionData: CollectionDataRow[],
  agentFeeRates: Map<string, number>
): AgentSyncSummary[] {
  const agentMap = new Map<string, AgentSyncSummary>();

  for (const row of collectionData) {
    const agentKey = row.agentId || '直接';

    if (!agentMap.has(agentKey)) {
      // フィーレートはNotionから取得、なければGoogle Sheetsのエージェントデータから、デフォルト0.7
      const feeRate = agentFeeRates.get(row.agentId) ?? 0.7;

      agentMap.set(agentKey, {
        agentId: row.agentId,
        agentName: row.agentName || '直接',
        feeRate,
        players: [],
        totalRake: 0,
        totalRakeback: 0,
        totalAmount: 0,
        agentReward: 0,
        settlementAmount: 0,
      });
    }

    const agent = agentMap.get(agentKey)!;
    agent.players.push(row);

    // エージェント自身（プレイヤーID = エージェントID）はレーキ・レーキバック集計から除外
    // ※ エージェント報酬はダウンラインユーザーのレーキのみが対象
    const isAgentSelf = row.playerId === row.agentId;
    if (!isAgentSelf) {
      agent.totalRake += row.rake;
      agent.totalRakeback += row.rakeback;
    }
    agent.totalAmount += row.amount;
  }

  // エージェント報酬と精算金額を計算
  for (const agent of agentMap.values()) {
    // エージェント報酬 = (レーキ合計 × フィーレート) - レーキバック合計
    agent.agentReward =
      Math.ceil((agent.totalRake * agent.feeRate - agent.totalRakeback) * 100) / 100;

    // 精算金額 = 金額合計 - エージェント報酬 × 100
    agent.settlementAmount = agent.totalAmount - agent.agentReward * 100;
  }

  // エージェント名でソート（「直接」は最後）
  const agents = Array.from(agentMap.values());
  agents.sort((a, b) => {
    if (a.agentName === '直接') return 1;
    if (b.agentName === '直接') return -1;
    return a.agentName.localeCompare(b.agentName, 'ja');
  });

  return agents;
}

/**
 * syncコマンドの実行
 */
async function runSync(
  weekPeriod: string | undefined,
  options: SyncOptions
): Promise<void> {
  try {
    // 1. 設定の読み込み
    const config = loadConfig();

    if (!config.notion) {
      logger.error('Notion設定が見つかりません。.envファイルを確認してください');
      logger.info('必要な環境変数:');
      logger.info('  - NOTION_API_KEY');
      logger.info('  - NOTION_AGENT_DB_ID');
      logger.info('  - NOTION_PLAYER_DB_ID');
      logger.info('  - NOTION_WEEKLY_SUMMARY_DB_ID');
      logger.info('  - NOTION_WEEKLY_DETAIL_DB_ID');
      logger.info('  - NOTION_WEEKLY_TOTAL_DB_ID');
      process.exit(1);
    }

    // 2. クライアントの作成
    const sheets = await createSheetsClient(config);
    logger.info('Google Sheets に接続しました');

    const notion = createNotionClient(config);
    logger.info('Notion APIに接続しました');

    const collectionSheet = options.collectionSheet || '集金データ';
    const agentSheet = options.agentSheet || 'エージェントデータ';
    const playerSheet = options.playerSheet || 'プレイヤーデータ';

    // 3. 週期間一覧を取得
    const availablePeriods = await getAvailableWeekPeriods(
      sheets,
      config.google.spreadsheetId,
      collectionSheet
    );

    if (availablePeriods.length === 0) {
      logger.error('集金データが見つかりません');
      process.exit(1);
    }

    logger.info(`利用可能な週期間: ${availablePeriods.length}件`);

    // 4. 週期間を決定
    const targetPeriod = weekPeriod || availablePeriods[0];
    if (!availablePeriods.includes(targetPeriod)) {
      logger.error(`指定された週期間が見つかりません: ${targetPeriod}`);
      logger.info('利用可能な週期間:');
      availablePeriods.forEach((p) => logger.info(`  - ${p}`));
      process.exit(1);
    }

    logger.info(`対象週期間: ${targetPeriod}`);

    // 5. Google Sheetsからデータを読み込み
    const collectionData = await readCollectionDataFromSheets(
      sheets,
      config.google.spreadsheetId,
      collectionSheet,
      targetPeriod
    );

    if (collectionData.length === 0) {
      logger.error('対象期間の集金データが見つかりません');
      process.exit(1);
    }

    logger.info(`集金データ: ${collectionData.length}件`);

    // 6. エージェントデータを読み込み
    const sheetsAgentData = await readAgentDataFromSheets(
      sheets,
      config.google.spreadsheetId,
      agentSheet
    );
    logger.info(`エージェントデータ: ${sheetsAgentData.length}件`);

    // 7. プレイヤーデータを読み込み
    const sheetsPlayerData = await readPlayerDataFromSheets(
      sheets,
      config.google.spreadsheetId,
      playerSheet
    );
    logger.info(`プレイヤーデータ: ${sheetsPlayerData.length}件`);

    // Google Sheetsのエージェントデータからフィーレートを取得
    const sheetsFeeRates = new Map<string, number>();
    for (const agent of sheetsAgentData) {
      sheetsFeeRates.set(agent.agentId, agent.feeRate);
    }

    // 7. Notionの既存エージェントを取得
    const existingAgents = await getAllAgents(notion, config.notion.agentDbId);
    logger.info(`Notion既存エージェント: ${existingAgents.size}件`);

    // フィーレートはNotionを優先、なければGoogle Sheets、デフォルト0.7
    const agentFeeRates = new Map<string, number>();
    for (const [agentId, data] of existingAgents) {
      agentFeeRates.set(agentId, data.feeRate);
    }
    for (const [agentId, feeRate] of sheetsFeeRates) {
      if (!agentFeeRates.has(agentId)) {
        agentFeeRates.set(agentId, feeRate);
      }
    }

    // 8. 集金データをエージェント毎にグループ化
    const agentSummaries = groupCollectionByAgent(collectionData, agentFeeRates);
    logger.info(`エージェント数: ${agentSummaries.length}グループ`);

    // Dry-runモードの場合は結果を表示して終了
    if (options.dryRun) {
      logger.info('');
      logger.info('=== Dry-run モード ===');
      logger.info('');

      // 新規エージェントの確認
      const newAgents = agentSummaries.filter(
        (a) => a.agentId && !existingAgents.has(a.agentId)
      );
      if (newAgents.length > 0) {
        logger.info(`新規エージェント（Notionに追加予定）: ${newAgents.length}件`);
        newAgents.forEach((a) =>
          logger.info(`  + ${a.agentName} (${a.agentId})`)
        );
        logger.info('');
      }

      // エージェント毎の集計を表示
      for (const agent of agentSummaries) {
        logger.info(`【${agent.agentName}】(${agent.agentId || 'ID無し'})`);
        logger.info(`  フィーレート: ${(agent.feeRate * 100).toFixed(0)}%`);
        logger.info(`  プレイヤー数: ${agent.players.length}名`);
        logger.info(`  レーキ合計: ${Math.floor(agent.totalRake * 100)}円 ※Notionではrollupで集計`);
        logger.info(`  レーキバック合計: ${Math.floor(agent.totalRakeback * 100)}円 ※Notionではrollupで集計`);
        logger.info(`  エージェント報酬: ${Math.floor(agent.agentReward * 100)}円`);
        logger.info(`  金額合計: ${Math.floor(agent.totalAmount)}円 ※Notionではrollupで集計`);
        logger.info(`  精算金額: ${Math.floor(agent.settlementAmount)}円`);
        logger.info('');

        for (const player of agent.players) {
          const rakebackInfo =
            player.rakebackRate > 0
              ? ` [RB: ${Math.floor(player.rakeback * 100)}円 (${(player.rakebackRate * 100).toFixed(0)}%)]`
              : '';
          logger.info(
            `    ${player.playerNickname} (${player.playerId}): 収益${Math.floor(player.revenue * 100)}円 / レーキ${Math.floor(player.rake * 100)}円${rakebackInfo} / ${Math.floor(player.amount)}円`
          );
        }
        logger.info('');
      }

      // 週次トータルを計算・表示
      const grandTotalRake = agentSummaries.reduce((sum, a) => sum + a.totalRake, 0);
      const grandTotalRakeback = agentSummaries.reduce((sum, a) => sum + a.totalRakeback, 0);
      const grandTotalAgentFee = agentSummaries.reduce((sum, a) => sum + a.agentReward, 0);
      const houseProfit = grandTotalRake - grandTotalRakeback - grandTotalAgentFee;

      logger.info('=== 週次トータル ===');
      logger.info(`  総レーキ: ${Math.floor(grandTotalRake * 100)}円`);
      logger.info(`  総レーキバック: ${Math.floor(grandTotalRakeback * 100)}円`);
      logger.info(`  総エージェントフィー: ${Math.floor(grandTotalAgentFee * 100)}円`);
      logger.info(`  ハウス利益: ${Math.floor(houseProfit * 100)}円`);
      logger.info('');

      return;
    }

    // 9. Notionにエージェントを追加（新規のみ）
    let newAgentCount = 0;
    const agentPageIds = new Map<string, string>();

    for (const summary of agentSummaries) {
      if (!summary.agentId) {
        continue; // 「直接」のエージェントはスキップ
      }

      const existing = existingAgents.get(summary.agentId);
      if (existing) {
        agentPageIds.set(summary.agentId, existing.pageId);
      } else {
        // Google Sheetsのエージェントデータから追加情報を取得
        const sheetsAgent = sheetsAgentData.find(
          (a) => a.agentId === summary.agentId
        );

        const agentData: NotionAgentData = {
          agentId: summary.agentId,
          agentName: summary.agentName,
          remark: sheetsAgent?.remark || '',
          superAgentName: sheetsAgent?.superAgentName || '',
          feeRate: summary.feeRate,
        };

        const pageId = await createAgent(
          notion,
          config.notion.agentDbId,
          agentData
        );
        agentPageIds.set(summary.agentId, pageId);
        newAgentCount++;
        logger.info(`  エージェント追加: ${summary.agentName} (${summary.agentId})`);
      }
    }

    if (newAgentCount > 0) {
      logger.success(`${newAgentCount}件のエージェントを追加しました`);
    }

    // 10. プレイヤーをNotionに同期
    const existingPlayers = await getAllPlayers(notion, config.notion.playerDbId);
    logger.info(`Notion既存プレイヤー: ${existingPlayers.size}件`);

    let playerCreatedCount = 0;
    let playerUpdatedCount = 0;
    // プレイヤーID + エージェントID → プレイヤーページID のマップ
    const playerPageIdMap = new Map<string, string>();

    for (const player of sheetsPlayerData) {
      const agentPageId = player.agentId ? agentPageIds.get(player.agentId) || null : null;
      // キー: プレイヤーID:エージェントページID
      const playerKey = `${player.playerId}:${agentPageId || ''}`;
      const existingPageId = existingPlayers.get(playerKey);

      const playerData: NotionPlayerData = {
        playerId: player.playerId,
        nickname: player.nickname,
        agentId: player.agentId,
        agentPageId,
        country: player.country,
        remark: player.remark,
        rakebackRate: player.rakebackRate,
      };

      const result = await upsertPlayer(
        notion,
        config.notion.playerDbId,
        playerData,
        existingPageId
      );

      // プレイヤーID + エージェントID でマップに登録
      const lookupKey = `${player.playerId}:${player.agentId || ''}`;
      playerPageIdMap.set(lookupKey, result.pageId);

      if (result.created) {
        playerCreatedCount++;
      } else {
        playerUpdatedCount++;
      }
    }

    logger.success(
      `プレイヤー: ${playerCreatedCount}件作成, ${playerUpdatedCount}件更新`
    );

    // 12. 週次集金をNotionに作成/更新
    let summaryCreatedCount = 0;
    let summaryUpdatedCount = 0;
    const summaryPageIds = new Map<string, string>();

    for (const summary of agentSummaries) {
      if (!summary.agentId) {
        continue; // 「直接」のエージェントはスキップ
      }

      const agentPageId = agentPageIds.get(summary.agentId);
      if (!agentPageId) {
        logger.warn(`エージェントのページIDが見つかりません: ${summary.agentId}`);
        continue;
      }

      // ※ 集計系フィールド（レーキ合計、レーキバック合計、収益合計、金額合計）はrollupで自動集計
      // ※ エージェント報酬はpt単位なので円に変換（×100して切り捨て）
      // ※ タイトルにはリマークがあればリマークを優先
      const sheetsAgent = sheetsAgentData.find((a) => a.agentId === summary.agentId);
      const summaryData: NotionWeeklySummaryData = {
        weekPeriod: targetPeriod,
        agentName: summary.agentName,
        agentRemark: sheetsAgent?.remark || undefined,
        agentPageId,
        playerCount: summary.players.length,
        agentReward: Math.floor(summary.agentReward * 100),
        settlementAmount: summary.settlementAmount,
      };

      const result = await upsertWeeklySummary(
        notion,
        config.notion.weeklySummaryDbId,
        summaryData
      );

      summaryPageIds.set(summary.agentId, result.pageId);

      if (result.created) {
        summaryCreatedCount++;
      } else {
        summaryUpdatedCount++;
      }
    }

    logger.success(
      `週次集金: ${summaryCreatedCount}件作成, ${summaryUpdatedCount}件更新`
    );

    // 12.5. 今回のデータに含まれない週次集金を削除
    const existingSummaries = await getAllWeeklySummariesByPeriod(
      notion,
      config.notion.weeklySummaryDbId,
      targetPeriod
    );
    const syncedAgentPageIds = new Set(
      Array.from(summaryPageIds.values()).map((id) => id)
    );
    let summaryDeletedCount = 0;
    for (const [, summaryPageId] of existingSummaries) {
      if (!syncedAgentPageIds.has(summaryPageId)) {
        await archiveNotionPage(notion, summaryPageId);
        summaryDeletedCount++;
      }
    }
    if (summaryDeletedCount > 0) {
      logger.info(`週次集金: ${summaryDeletedCount}件削除`);
    }

    // 13. 週次集金個別をNotionに作成/更新
    let detailCreatedCount = 0;
    let detailUpdatedCount = 0;
    const summaryDetailPageIds = new Map<string, string[]>();

    for (const summary of agentSummaries) {
      if (!summary.agentId) {
        continue; // 「直接」のエージェントはスキップ
      }

      const summaryPageId = summaryPageIds.get(summary.agentId);
      if (!summaryPageId) {
        logger.warn(`集金まとめのページIDが見つかりません: ${summary.agentId}`);
        continue;
      }

      const detailPageIds: string[] = [];

      for (const player of summary.players) {
        // プレイヤーページIDを取得
        // まずGoogle Sheetsから同期したプレイヤーを検索
        const playerLookupKey = `${player.playerId}:${summary.agentId || ''}`;
        let playerPageId = playerPageIdMap.get(playerLookupKey);

        // 見つからない場合はNotionの既存プレイヤーから検索
        if (!playerPageId) {
          const agentPageId = agentPageIds.get(summary.agentId || '') || '';
          const existingPlayerKey = `${player.playerId}:${agentPageId}`;
          playerPageId = existingPlayers.get(existingPlayerKey);
        }

        // 収益・レーキ・レーキバックはpt単位なので円に変換（×100して切り捨て）
        const detailData: NotionWeeklyDetailData = {
          nickname: player.playerNickname,
          summaryPageId,
          playerPageId,
          playerId: player.playerId,
          revenue: Math.floor(player.revenue * 100),
          rake: Math.floor(player.rake * 100),
          rakebackRate: player.rakebackRate,
          rakeback: Math.floor(player.rakeback * 100),
          amount: player.amount,
        };

        const result = await upsertWeeklyDetail(
          notion,
          config.notion.weeklyDetailDbId,
          detailData
        );

        detailPageIds.push(result.pageId);

        if (result.created) {
          detailCreatedCount++;
        } else {
          detailUpdatedCount++;
        }
      }

      summaryDetailPageIds.set(summary.agentId, detailPageIds);
    }

    logger.success(
      `週次集金個別: ${detailCreatedCount}件作成, ${detailUpdatedCount}件更新`
    );

    // 13.5. 今回のデータに含まれない週次集金個別を削除
    let detailDeletedCount = 0;
    for (const [agentId, syncedDetailPageIds] of summaryDetailPageIds) {
      const summaryPageId = summaryPageIds.get(agentId);
      if (!summaryPageId) continue;

      const existingDetails = await getAllWeeklyDetailsBySummary(
        notion,
        config.notion.weeklyDetailDbId,
        summaryPageId
      );

      const syncedDetailPageIdSet = new Set(syncedDetailPageIds);
      for (const [, detailPageId] of existingDetails) {
        if (!syncedDetailPageIdSet.has(detailPageId)) {
          await archiveNotionPage(notion, detailPageId);
          detailDeletedCount++;
        }
      }
    }
    if (detailDeletedCount > 0) {
      logger.info(`週次集金個別: ${detailDeletedCount}件削除`);
    }

    // 14. 週次集金の週次集金個別リレーションを更新
    for (const [agentId, detailPageIds] of summaryDetailPageIds) {
      const summaryPageId = summaryPageIds.get(agentId);
      if (summaryPageId && detailPageIds.length > 0) {
        await updateWeeklySummaryDetailRelation(notion, summaryPageId, detailPageIds);
      }
    }
    logger.success('週次集金の個別リレーションを更新しました');

    // 15. 週次トータルをNotionに同期
    if (config.notion.weeklyTotalDbId) {
      const grandTotalRake = agentSummaries.reduce((sum, a) => sum + a.totalRake, 0);
      const grandTotalRakeback = agentSummaries.reduce((sum, a) => sum + a.totalRakeback, 0);
      const grandTotalAgentFee = agentSummaries.reduce((sum, a) => sum + a.agentReward, 0);
      const houseProfit = grandTotalRake - grandTotalRakeback - grandTotalAgentFee;

      const totalData: NotionWeeklyTotalData = {
        weekPeriod: targetPeriod,
        totalRake: Math.floor(grandTotalRake * 100),
        totalRakeback: Math.floor(grandTotalRakeback * 100),
        totalAgentFee: Math.floor(grandTotalAgentFee * 100),
        houseProfit: Math.floor(houseProfit * 100),
      };

      const totalResult = await upsertWeeklyTotal(
        notion,
        config.notion.weeklyTotalDbId,
        totalData
      );

      if (totalResult.created) {
        logger.success('週次トータルを作成しました');
      } else {
        logger.success('週次トータルを更新しました');
      }
    }

    logger.success('Notion同期が完了しました');

    // 15. エージェントごとの公開URLを出力
    logger.info('');
    logger.info('=== エージェント共有用URL ===');
    for (const summary of agentSummaries) {
      if (!summary.agentId) continue;
      const summaryPageId = summaryPageIds.get(summary.agentId);
      if (!summaryPageId) continue;

      const sheetsAgent = sheetsAgentData.find((a) => a.agentId === summary.agentId);
      const displayName = sheetsAgent?.remark || summary.agentName;
      // NotionページIDのハイフンを除去して公開URLを生成
      const pageIdWithoutHyphens = summaryPageId.replace(/-/g, '');
      const notionUrl = `https://long-coaster-623.notion.site/${pageIdWithoutHyphens}`;
      logger.info(`${displayName}: ${notionUrl}`);
    }
    logger.info('');
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
 * syncコマンドを作成
 */
export function createSyncCommand(): Command {
  const command = new Command('sync')
    .description('Google Sheetsの集金データをNotionに同期')
    .argument(
      '[weekPeriod]',
      '対象の週期間（例: "2025-12-24〜2025-12-30"）。省略時は最新'
    )
    .option(
      '--collection-sheet <name>',
      '集金データのシート名',
      '集金データ'
    )
    .option(
      '--agent-sheet <name>',
      'エージェントデータのシート名',
      'エージェントデータ'
    )
    .option(
      '--player-sheet <name>',
      'プレイヤーデータのシート名',
      'プレイヤーデータ'
    )
    .option('--dry-run', 'Notionに書き込まずに同期内容を表示')
    .action(async (weekPeriod: string | undefined, options: SyncOptions) => {
      await runSync(weekPeriod, options);
    });

  return command;
}
