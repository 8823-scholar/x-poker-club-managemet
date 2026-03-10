import { Command } from 'commander';
import {
  createNotionClient,
  parseNotionPageUrl,
  getWeeklyDetailPageProperties,
  calculateStaking,
  deleteStakingBlocks,
  appendStakingBlocks,
} from '../lib/notion.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * ステーキング精算の実行
 */
async function runStaking(pageUrl: string): Promise<void> {
  try {
    // 1. 設定読み込み
    const config = loadConfig();

    if (!config.notion) {
      logger.error('Notion設定が見つかりません。.envファイルを確認してください');
      process.exit(1);
    }

    // 2. ページID抽出
    const pageId = parseNotionPageUrl(pageUrl);
    logger.info(`ページID: ${pageId}`);

    // 3. Notionクライアント作成
    const notion = createNotionClient(config);
    logger.info('Notion APIに接続しました');

    // 4. ページプロパティ取得
    const props = await getWeeklyDetailPageProperties(notion, pageId);
    logger.info(`プレイヤー: ${props.playerName}`);
    logger.info(`成績: ¥${props.seiseki.toLocaleString()}`);
    logger.info(`レーキバック: ¥${props.rakeback.toLocaleString()}`);
    logger.info(`精算金額: ¥${props.seisanKingaku.toLocaleString()}`);

    // 5. ステーキング計算
    const calc = calculateStaking(props.seisanKingaku, props.seiseki, props.rakeback);

    logger.info('');
    logger.info('=== ステーキング精算 ===');
    logger.info(`対ハウス精算:       ¥${calc.houseSettlement.toLocaleString()}`);
    logger.info(`のすけステーキング: ¥${calc.nosukeStaking.toLocaleString()}`);
    logger.info(`のすけレーキバック: ¥${calc.nosukeRakeback.toLocaleString()}`);
    logger.info(`最終精算:           ¥${calc.finalSettlement.toLocaleString()}`);

    // 6. 既存ブロック削除 + 新規ブロック追記
    logger.info('');
    logger.info('Notionページに書き込み中...');
    await deleteStakingBlocks(notion, pageId);
    await appendStakingBlocks(notion, pageId, calc);

    logger.success('ステーキング精算をNotionページに追記しました');
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
 * stakingコマンドを作成
 */
export function createStakingCommand(): Command {
  const command = new Command('staking')
    .description('週次集金個別ページのステーキング精算を計算してNotionに追記')
    .argument('<pageUrl>', 'NotionページのURLまたはページID')
    .action(async (pageUrl: string) => {
      await runStaking(pageUrl);
    });

  return command;
}
