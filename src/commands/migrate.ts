import { Command } from 'commander';
import {
  createNotionClient,
  ensureDatabaseProperties,
  getDatabaseProperties,
  AGENT_DB_SCHEMA,
  PLAYER_DB_SCHEMA,
  WEEKLY_SUMMARY_DB_SCHEMA,
  WEEKLY_DETAIL_DB_SCHEMA,
} from '../lib/notion.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface MigrateOptions {
  dryRun?: boolean;
}

/**
 * migrateコマンドの実行
 */
async function runMigrate(options: MigrateOptions): Promise<void> {
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
      process.exit(1);
    }

    // 2. Notionクライアントの作成
    const notion = createNotionClient(config);
    logger.info('Notion APIに接続しました');

    // 3. 各データベースのスキーマを確認・更新
    const databases = [
      {
        name: 'エージェントDB',
        id: config.notion.agentDbId,
        schema: AGENT_DB_SCHEMA,
      },
      {
        name: 'プレイヤーDB',
        id: config.notion.playerDbId,
        schema: PLAYER_DB_SCHEMA,
        relationDbId: config.notion.agentDbId,
      },
      {
        name: '週次集金まとめDB',
        id: config.notion.weeklySummaryDbId,
        schema: WEEKLY_SUMMARY_DB_SCHEMA,
        relationDbId: config.notion.agentDbId,
      },
      {
        name: '週次集金個別DB',
        id: config.notion.weeklyDetailDbId,
        schema: WEEKLY_DETAIL_DB_SCHEMA,
        relationDbId: config.notion.weeklySummaryDbId,
      },
    ];

    for (const db of databases) {
      if (!db.id) {
        logger.warn(`${db.name} のIDが設定されていません。スキップします`);
        continue;
      }

      logger.info(`${db.name} のスキーマを確認中...`);

      if (options.dryRun) {
        // Dry-runモード: 現在のプロパティと必要なプロパティを比較
        const existingProps = await getDatabaseProperties(notion, db.id);
        const existingNames = new Set(Object.keys(existingProps));
        // タイトルプロパティは追加できないので除外
        const requiredNames = Object.keys(db.schema).filter(
          (name) => !('title' in (db.schema as Record<string, Record<string, unknown>>)[name])
        );

        const missing = requiredNames.filter((name) => !existingNames.has(name));
        const existing = requiredNames.filter((name) => existingNames.has(name));

        logger.info(`  既存のプロパティ: ${existing.length}件`);
        existing.forEach((name) => logger.info(`    - ${name}`));

        if (missing.length > 0) {
          logger.info(`  追加予定のプロパティ: ${missing.length}件`);
          missing.forEach((name) => logger.info(`    + ${name}`));
        } else {
          logger.info('  追加が必要なプロパティはありません');
        }
      } else {
        // 実際にスキーマを更新
        const result = await ensureDatabaseProperties(
          notion,
          db.id,
          db.schema,
          db.relationDbId
        );

        if (result.added.length > 0) {
          logger.success(`  ${result.added.length}件のプロパティを追加しました`);
          result.added.forEach((name) => logger.info(`    + ${name}`));
        } else {
          logger.info('  スキーマは最新です');
        }
      }
    }

    if (options.dryRun) {
      logger.info('');
      logger.info('=== Dry-run モード ===');
      logger.info('実際の変更は行われませんでした');
    } else {
      logger.success('スキーマの更新が完了しました');
    }
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
 * migrateコマンドを作成
 */
export function createMigrateCommand(): Command {
  const command = new Command('migrate')
    .description('Notionデータベースのスキーマを作成・更新')
    .option('--dry-run', 'スキーマの変更をシミュレートのみ行う')
    .action(async (options: MigrateOptions) => {
      await runMigrate(options);
    });

  return command;
}
