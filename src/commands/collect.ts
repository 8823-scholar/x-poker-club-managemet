import { Command } from 'commander';
import {
  createSheetsClient,
  getAvailableWeekPeriods,
  readWeeklyData,
  readPlayerRakebackRates,
  appendCollectionData,
  COLLECTION_HEADERS,
  WeeklyPlayerData,
  createPlayerKey,
} from '../lib/google-sheets.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface CollectOptions {
  sourceSheet?: string;
  targetSheet?: string;
  dryRun?: boolean;
}

/**
 * エージェント集計データ
 */
interface AgentSummary {
  agentName: string;
  agentId: string;
  players: {
    nickname: string;
    playerId: string;
    revenuePoints: number;
    clubRake: number;
    rakebackRate: number;
    rakeback: number;
    revenueYen: number;
  }[];
  totalPayment: number; // 支払合計（プラス収益の合計）
  totalCollection: number; // 回収合計（マイナス収益の絶対値合計）
  netAmount: number; // 差引（支払 - 回収）
}

/**
 * プレーヤーデータをエージェント毎にグループ化
 */
function groupByAgent(
  players: WeeklyPlayerData[],
  rakebackRates: Map<string, number>
): AgentSummary[] {
  const agentMap = new Map<string, AgentSummary>();

  for (const player of players) {
    const agentKey = player.agentId || '直接';
    const agentName = player.agentName || '直接';

    if (!agentMap.has(agentKey)) {
      agentMap.set(agentKey, {
        agentName,
        agentId: player.agentId || '',
        players: [],
        totalPayment: 0,
        totalCollection: 0,
        netAmount: 0,
      });
    }

    const agent = agentMap.get(agentKey)!;
    const revenuePoints = player.playerRevenue;
    const clubRake = player.clubRake;

    // プレイヤーのレーキバックレートを取得（デフォルト: 0）
    const playerKey = createPlayerKey(player.playerId, player.agentId || '');
    const rakebackRate = rakebackRates.get(playerKey) || 0;

    // レーキバック = レーキ × レーキバックレート（小数点以下2桁で切り上げ）
    // 浮動小数点誤差対策: 整数（銭単位）で計算
    const clubRakeCents = Math.round(clubRake * 100);
    const rakebackCents = Math.ceil(clubRakeCents * rakebackRate);
    const rakeback = rakebackCents / 100;

    // 金額 = (収益 + レーキバック) × 100
    const revenueYen = (revenuePoints + rakeback) * 100;

    agent.players.push({
      nickname: player.nickname,
      playerId: player.playerId,
      revenuePoints,
      clubRake,
      rakebackRate,
      rakeback,
      revenueYen,
    });

    // 集計
    if (revenueYen > 0) {
      agent.totalPayment += revenueYen;
    } else {
      agent.totalCollection += Math.abs(revenueYen);
    }
  }

  // 差引を計算
  for (const agent of agentMap.values()) {
    agent.netAmount = agent.totalPayment - agent.totalCollection;
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
 * 集金データをスプレッドシート用の配列に変換
 */
function buildCollectionData(
  weekPeriod: string,
  agents: AgentSummary[]
): string[][] {
  const rows: string[][] = [];

  for (const agent of agents) {
    for (const player of agent.players) {
      rows.push([
        weekPeriod,
        agent.agentName,
        agent.agentId,
        player.nickname,
        player.playerId,
        String(player.revenuePoints),
        String(player.clubRake),
        String(player.rakebackRate),
        String(player.rakeback),
        String(player.revenueYen),
      ]);
    }
  }

  return rows;
}

/**
 * collectコマンドの実行
 */
async function runCollect(
  weekPeriod: string | undefined,
  options: CollectOptions
): Promise<void> {
  try {
    // 1. 設定の読み込み
    const config = loadConfig();

    // 2. Google Sheets クライアントの作成
    const sheets = await createSheetsClient(config);
    logger.info('Google Sheets に接続しました');

    const sourceSheet = options.sourceSheet || '週次データ';
    const targetSheet = options.targetSheet || '集金データ';

    // 3. 週期間一覧を取得
    const availablePeriods = await getAvailableWeekPeriods(
      sheets,
      config.google.spreadsheetId,
      sourceSheet
    );

    if (availablePeriods.length === 0) {
      logger.error('週次データが見つかりません');
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

    // 5. 週次データを読み込み
    const weeklyData = await readWeeklyData(
      sheets,
      config.google.spreadsheetId,
      sourceSheet,
      targetPeriod
    );

    if (weeklyData.length === 0) {
      logger.error('対象期間のデータが見つかりません');
      process.exit(1);
    }

    logger.info(`プレーヤー数: ${weeklyData.length}名`);

    // 6. プレイヤーデータからレーキバックレートを取得
    const rakebackRates = await readPlayerRakebackRates(
      sheets,
      config.google.spreadsheetId,
      'プレイヤーデータ'
    );
    logger.info(`レーキバックレート登録数: ${rakebackRates.size}件`);

    // 7. エージェント毎にグループ化
    const agents = groupByAgent(weeklyData, rakebackRates);
    logger.info(`エージェント数: ${agents.length}グループ`);

    // 8. 集金データを生成
    const collectionData = buildCollectionData(targetPeriod, agents);

    // 9. Dry-runモードの場合は結果を表示して終了
    if (options.dryRun) {
      logger.info('=== Dry-run モード ===');
      logger.info('');
      for (const agent of agents) {
        logger.info(`【${agent.agentName}】(${agent.agentId || 'ID無し'})`);
        for (const player of agent.players) {
          const rakebackInfo =
            player.rakebackRate > 0
              ? ` [RB: ${player.rakeback.toFixed(2)}pt (${(player.rakebackRate * 100).toFixed(0)}%)]`
              : '';
          logger.info(
            `  ${player.nickname} (${player.playerId}): 収益${player.revenuePoints}pt / レーキ${player.clubRake}pt${rakebackInfo} / ${player.revenueYen}円`
          );
        }
        logger.info('');
      }
      return;
    }

    // 10. スプレッドシートに書き込み（週期間のみで冪等性担保）
    const result = await appendCollectionData(
      sheets,
      config.google.spreadsheetId,
      targetSheet,
      collectionData,
      COLLECTION_HEADERS,
      targetPeriod
    );

    if (result.deletedRows > 0) {
      logger.info(`既存データ ${result.deletedRows}行を削除しました`);
    }
    logger.success(`${result.addedRows}行を追加しました`);
    logger.info(`範囲: ${result.range}`);
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
 * collectコマンドを作成
 */
export function createCollectCommand(): Command {
  const command = new Command('collect')
    .description('週次データからエージェント毎の集金データを生成')
    .argument('[weekPeriod]', '対象の週期間（例: "2025-12-24〜2025-12-30"）。省略時は最新')
    .option(
      '--source-sheet <name>',
      '読み込み元のシート名',
      '週次データ'
    )
    .option(
      '--target-sheet <name>',
      '出力先のシート名',
      '集金データ'
    )
    .option('--dry-run', 'スプレッドシートに書き込まずに結果を表示')
    .action(async (weekPeriod: string | undefined, options: CollectOptions) => {
      await runCollect(weekPeriod, options);
    });

  return command;
}
