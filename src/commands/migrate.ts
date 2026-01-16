import { Command } from 'commander';
import {
  createNotionClient,
  ensureDatabaseProperties,
  ensureRollupProperties,
  getDatabaseProperties,
  AGENT_DB_SCHEMA,
  PLAYER_DB_SCHEMA,
  WEEKLY_SUMMARY_DB_SCHEMA,
  WEEKLY_SUMMARY_ROLLUP_SCHEMA,
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

        // スキーマからタイトルプロパティ名を取得
        let requiredTitleName: string | undefined;
        for (const [propName, propConfig] of Object.entries(db.schema)) {
          if ('title' in (propConfig as Record<string, unknown>)) {
            requiredTitleName = propName;
            break;
          }
        }

        // 既存のタイトルプロパティを見つける
        let existingTitleName: string | undefined;
        for (const [propName, propConfig] of Object.entries(existingProps)) {
          if ((propConfig as Record<string, unknown>).type === 'title') {
            existingTitleName = propName;
            break;
          }
        }

        // タイトルプロパティのリネームが必要か確認
        if (requiredTitleName && existingTitleName && requiredTitleName !== existingTitleName) {
          logger.info(`  タイトルプロパティのリネーム予定: ${existingTitleName} → ${requiredTitleName}`);
        }

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

        if (result.renamed) {
          logger.success(`  タイトルプロパティをリネームしました: ${result.renamed}`);
        }

        if (result.added.length > 0) {
          logger.success(`  ${result.added.length}件のプロパティを追加しました`);
          result.added.forEach((name) => logger.info(`    + ${name}`));
        } else if (!result.renamed) {
          logger.info('  スキーマは最新です');
        }
      }
    }

    // 4. 週次集金まとめDBにrollupプロパティを追加
    if (config.notion.weeklySummaryDbId && config.notion.weeklyDetailDbId) {
      logger.info('週次集金まとめDB のrollupプロパティを確認中...');

      // 週次集金まとめDBのプロパティを取得して、週次集金個別DBからの逆リレーション名を見つける
      const summaryProps = await getDatabaseProperties(notion, config.notion.weeklySummaryDbId);
      let reverseRelationName: string | undefined;

      for (const [propName, propConfig] of Object.entries(summaryProps)) {
        const prop = propConfig as { type?: string; relation?: { database_id?: string } };
        if (
          prop.type === 'relation' &&
          prop.relation?.database_id === config.notion.weeklyDetailDbId
        ) {
          reverseRelationName = propName;
          break;
        }
      }

      if (options.dryRun) {
        const rollupNames = Object.keys(WEEKLY_SUMMARY_ROLLUP_SCHEMA);
        const missingRollups: string[] = [];
        const convertRollups: string[] = [];

        for (const name of rollupNames) {
          const existingProp = summaryProps[name] as { type?: string } | undefined;
          if (!existingProp) {
            missingRollups.push(name);
          } else if (existingProp.type !== 'rollup') {
            convertRollups.push(name);
          }
        }

        if (reverseRelationName) {
          logger.info(`  リレーションプロパティ: ${reverseRelationName}`);
          if (convertRollups.length > 0) {
            logger.info(`  rollupに変換予定のプロパティ: ${convertRollups.length}件`);
            convertRollups.forEach((name) => logger.info(`    ~ ${name} (既存プロパティは ${name}_old にリネーム)`));
          }
          if (missingRollups.length > 0) {
            logger.info(`  追加予定のrollupプロパティ: ${missingRollups.length}件`);
            missingRollups.forEach((name) => logger.info(`    + ${name}`));
          }
          if (convertRollups.length === 0 && missingRollups.length === 0) {
            logger.info('  rollupプロパティは最新です');
          }
        } else {
          logger.warn('  週次集金個別DBからのリレーションが見つかりません');
          logger.info('  先に週次集金個別DBのスキーマを更新してください');
        }
      } else {
        if (reverseRelationName) {
          const rollupResult = await ensureRollupProperties(
            notion,
            config.notion.weeklySummaryDbId,
            WEEKLY_SUMMARY_ROLLUP_SCHEMA,
            reverseRelationName
          );

          if (rollupResult.converted.length > 0) {
            logger.success(`  ${rollupResult.converted.length}件のプロパティをrollupに変換しました`);
            rollupResult.converted.forEach((name) => logger.info(`    ~ ${name} (旧プロパティは ${name}_old にリネーム)`));
          }
          if (rollupResult.added.length > 0) {
            logger.success(`  ${rollupResult.added.length}件のrollupプロパティを追加しました`);
            rollupResult.added.forEach((name) => logger.info(`    + ${name}`));
          }
          if (rollupResult.converted.length === 0 && rollupResult.added.length === 0) {
            logger.info('  rollupプロパティは最新です');
          }
        } else {
          logger.warn('  週次集金個別DBからのリレーションが見つかりません');
          logger.info('  先に週次集金個別DBのスキーマを更新してください');
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
