import { Command } from 'commander';
import { Client } from '@notionhq/client';
import {
  createNotionClient,
  ensureDatabaseProperties,
  ensureRollupProperties,
  getDatabaseProperties,
  AGENT_DB_SCHEMA,
  PLAYER_DB_SCHEMA,
  WEEKLY_SUMMARY_DB_SCHEMA,
  WEEKLY_SUMMARY_ROLLUP_SCHEMA,
  WEEKLY_SUMMARY_DETAIL_RELATION_NAME,
  WEEKLY_DETAIL_DB_SCHEMA,
  WEEKLY_DETAIL_TOTAL_RELATION_NAME,
  WEEKLY_TOTAL_DB_SCHEMA,
  WEEKLY_TOTAL_SUMMARY_RELATION_NAME,
  WEEKLY_SUMMARY_TOTAL_RELATION_NAME,
} from '../lib/notion.js';
import {
  dataSourceProps,
  buildDataSourceProperties,
} from '../lib/notion-builders.js';
import { loadConfig, logger } from '../lib/utils.js';

/**
 * 特定のリレーションプロパティを作成（参照先DBが異なる場合は再作成）
 */
async function ensureRelationProperty(
  client: Client,
  dataSourceId: string,
  propertyName: string,
  targetDatabaseId: string,
  targetDataSourceId: string,
  dryRun: boolean
): Promise<{ created: boolean; existing: boolean; recreated: boolean }> {
  const existingProps = await getDatabaseProperties(client, dataSourceId);
  const existingProp = existingProps[propertyName];

  if (existingProp) {
    if (existingProp.type === 'relation') {
      // リレーション型だが、参照先DBが異なる場合は再作成
      const existingTargetId = existingProp.relation.database_id?.replace(/-/g, '') || '';
      const expectedTargetId = targetDatabaseId.replace(/-/g, '');

      if (existingTargetId === expectedTargetId) {
        return { created: false, existing: true, recreated: false };
      }

      // 参照先が異なるのでリネームして再作成
      if (!dryRun) {
        await client.dataSources.update({
          data_source_id: dataSourceId,
          properties: buildDataSourceProperties({
            [propertyName]: dataSourceProps.rename(`${propertyName}_old`),
          }),
        });
      }
    } else {
      // 別の型で存在する場合はリネーム
      if (!dryRun) {
        await client.dataSources.update({
          data_source_id: dataSourceId,
          properties: buildDataSourceProperties({
            [propertyName]: dataSourceProps.rename(`${propertyName}_old`),
          }),
        });
      }
    }
  }

  if (!dryRun) {
    await client.dataSources.update({
      data_source_id: dataSourceId,
      properties: buildDataSourceProperties({
        [propertyName]: dataSourceProps.singleRelation(targetDataSourceId),
      }),
    });
  }

  const wasRecreated = existingProp?.type === 'relation';
  return { created: true, existing: false, recreated: wasRecreated };
}

/**
 * 双方向リレーションプロパティを作成
 */
async function ensureDualRelationProperty(
  client: Client,
  dataSourceId: string,
  propertyName: string,
  targetDatabaseId: string,
  targetDataSourceId: string,
  syncedPropertyName: string,
  dryRun: boolean
): Promise<{ created: boolean; existing: boolean; recreated: boolean }> {
  const existingProps = await getDatabaseProperties(client, dataSourceId);
  const existingProp = existingProps[propertyName];

  if (existingProp) {
    if (existingProp.type === 'relation') {
      const existingTargetId = existingProp.relation.database_id?.replace(/-/g, '') || '';
      const expectedTargetId = targetDatabaseId.replace(/-/g, '');

      if (existingTargetId === expectedTargetId) {
        return { created: false, existing: true, recreated: false };
      }

      if (!dryRun) {
        await client.dataSources.update({
          data_source_id: dataSourceId,
          properties: buildDataSourceProperties({
            [propertyName]: dataSourceProps.rename(`${propertyName}_old`),
          }),
        });
      }
    } else {
      if (!dryRun) {
        await client.dataSources.update({
          data_source_id: dataSourceId,
          properties: buildDataSourceProperties({
            [propertyName]: dataSourceProps.rename(`${propertyName}_old`),
          }),
        });
      }
    }
  }

  if (!dryRun) {
    await client.dataSources.update({
      data_source_id: dataSourceId,
      properties: buildDataSourceProperties({
        [propertyName]: dataSourceProps.dualRelation(targetDataSourceId, syncedPropertyName),
      }),
    });
  }

  const wasRecreated = existingProp?.type === 'relation';
  return { created: true, existing: false, recreated: wasRecreated };
}

/**
 * 週次集金DBに週次集金個別DBへのリレーションを作成
 */
async function ensureDetailRelation(
  client: Client,
  summaryDataSourceId: string,
  detailDataSourceId: string,
  dryRun: boolean
): Promise<{ created: boolean; existing: boolean }> {
  const existingProps = await getDatabaseProperties(client, summaryDataSourceId);
  const existingProp = existingProps[WEEKLY_SUMMARY_DETAIL_RELATION_NAME];

  if (existingProp) {
    if (existingProp.type === 'relation') {
      return { created: false, existing: true };
    }
    // 別の型で存在する場合はリネーム
    if (!dryRun) {
      await client.dataSources.update({
        data_source_id: summaryDataSourceId,
        properties: buildDataSourceProperties({
          [WEEKLY_SUMMARY_DETAIL_RELATION_NAME]: dataSourceProps.rename(`${WEEKLY_SUMMARY_DETAIL_RELATION_NAME}_old`),
        }),
      });
    }
  }

  if (!dryRun) {
    await client.dataSources.update({
      data_source_id: summaryDataSourceId,
      properties: buildDataSourceProperties({
        [WEEKLY_SUMMARY_DETAIL_RELATION_NAME]: dataSourceProps.singleRelation(detailDataSourceId),
      }),
    });
  }

  return { created: true, existing: false };
}

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
      logger.info('  - NOTION_WEEKLY_TOTAL_DB_ID');
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
        dataSourceId: config.notion.agentDataSourceId,
        schema: AGENT_DB_SCHEMA,
      },
      {
        name: 'プレイヤーDB',
        id: config.notion.playerDbId,
        dataSourceId: config.notion.playerDataSourceId,
        schema: PLAYER_DB_SCHEMA,
        relationDataSourceId: config.notion.agentDataSourceId,
      },
      {
        name: '週次集金DB',
        id: config.notion.weeklySummaryDbId,
        dataSourceId: config.notion.weeklySummaryDataSourceId,
        schema: WEEKLY_SUMMARY_DB_SCHEMA,
        relationDataSourceId: config.notion.agentDataSourceId,
      },
      {
        name: '週次集金個別DB',
        id: config.notion.weeklyDetailDbId,
        dataSourceId: config.notion.weeklyDetailDataSourceId,
        schema: WEEKLY_DETAIL_DB_SCHEMA,
        relationDataSourceId: config.notion.weeklySummaryDataSourceId,
      },
      {
        name: '週次トータルDB',
        id: config.notion.weeklyTotalDbId,
        dataSourceId: config.notion.weeklyTotalDataSourceId,
        schema: WEEKLY_TOTAL_DB_SCHEMA,
      },
    ];

    for (const db of databases) {
      if (!db.dataSourceId) {
        logger.warn(`${db.name} のDataSource IDが設定されていません。スキップします`);
        continue;
      }

      logger.info(`${db.name} のスキーマを確認中...`);

      if (options.dryRun) {
        // Dry-runモード: 現在のプロパティと必要なプロパティを比較
        const existingProps = await getDatabaseProperties(notion, db.dataSourceId);
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
          db.dataSourceId,
          db.schema,
          db.relationDataSourceId
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

    // 4. 週次集金個別DBの「集金済み」→「精算済み」リネーム
    if (config.notion.weeklyDetailDataSourceId) {
      const detailPropsForRename = await getDatabaseProperties(notion, config.notion.weeklyDetailDataSourceId);
      const oldSettledProp = detailPropsForRename['集金済み'] as { type?: string } | undefined;
      const newSettledProp = detailPropsForRename['精算済み'] as { type?: string } | undefined;

      if (oldSettledProp && !newSettledProp) {
        if (options.dryRun) {
          logger.info('週次集金個別DB のプロパティリネーム予定: 集金済み → 精算済み');
        } else {
          await notion.dataSources.update({
            data_source_id: config.notion.weeklyDetailDataSourceId,
            properties: buildDataSourceProperties({
              '集金済み': dataSourceProps.rename('精算済み'),
            }),
          });
          logger.success('週次集金個別DB のプロパティをリネームしました: 集金済み → 精算済み');
        }
      }
    }

    // 5. 週次集金個別DBにプレイヤーDBへのリレーションを追加
    if (config.notion.weeklyDetailDataSourceId && config.notion.playerDbId) {
      logger.info('週次集金個別DB のプレイヤーリレーションを確認中...');

      const detailProps = await getDatabaseProperties(notion, config.notion.weeklyDetailDataSourceId);
      const existingPlayerRelation = detailProps['プレイヤー'];

      if (options.dryRun) {
        if (!existingPlayerRelation) {
          logger.info('  追加予定のリレーション: プレイヤー');
        } else if (existingPlayerRelation.type !== 'relation') {
          logger.info('  リレーションに変換予定: プレイヤー (既存は プレイヤー_old にリネーム)');
        } else {
          // 参照先DBを確認
          const existingTargetId = existingPlayerRelation.relation.database_id?.replace(/-/g, '') || '';
          const expectedTargetId = config.notion.playerDbId.replace(/-/g, '');
          if (existingTargetId !== expectedTargetId) {
            logger.warn('  リレーション再作成予定: プレイヤー (参照先DBが異なるため)');
            logger.warn(`    現在の参照先: ${existingTargetId}`);
            logger.warn(`    正しい参照先: ${expectedTargetId}`);
          } else {
            logger.info('  リレーションプロパティ: プレイヤー (既存)');
          }
        }
      } else {
        const playerRelationResult = await ensureRelationProperty(
          notion,
          config.notion.weeklyDetailDataSourceId,
          'プレイヤー',
          config.notion.playerDbId,
          config.notion.playerDataSourceId,
          false
        );
        if (playerRelationResult.recreated) {
          logger.success('  リレーションプロパティを再作成しました: プレイヤー (参照先DBを修正)');
        } else if (playerRelationResult.created) {
          logger.success('  リレーションプロパティを追加しました: プレイヤー');
        } else {
          logger.info('  リレーションプロパティ: プレイヤー (既存)');
        }
      }
    }

    // 6. 週次集金DBに週次集金個別DBへのリレーションとrollupプロパティを追加
    if (config.notion.weeklySummaryDataSourceId && config.notion.weeklyDetailDataSourceId) {
      logger.info('週次集金DB のリレーション・rollupプロパティを確認中...');

      // 4.1. 週次集金個別DBへのリレーションを作成
      const summaryProps = await getDatabaseProperties(notion, config.notion.weeklySummaryDataSourceId);
      const existingRelation = summaryProps[WEEKLY_SUMMARY_DETAIL_RELATION_NAME];

      if (options.dryRun) {
        if (!existingRelation) {
          logger.info(`  追加予定のリレーション: ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME}`);
        } else if (existingRelation.type !== 'relation') {
          logger.info(`  リレーションに変換予定: ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME} (既存は ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME}_old にリネーム)`);
        } else {
          logger.info(`  リレーションプロパティ: ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME} (既存)`);
        }
      } else {
        const relationResult = await ensureDetailRelation(
          notion,
          config.notion.weeklySummaryDataSourceId,
          config.notion.weeklyDetailDataSourceId,
          false
        );
        if (relationResult.created) {
          logger.success(`  リレーションプロパティを追加しました: ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME}`);
        } else {
          logger.info(`  リレーションプロパティ: ${WEEKLY_SUMMARY_DETAIL_RELATION_NAME} (既存)`);
        }
      }

      // 4.2. rollupプロパティを作成
      const rollupNames = Object.keys(WEEKLY_SUMMARY_ROLLUP_SCHEMA);
      const missingRollups: string[] = [];
      const convertRollups: string[] = [];

      for (const name of rollupNames) {
        const existingProp = summaryProps[name];
        if (!existingProp) {
          missingRollups.push(name);
        } else if (existingProp.type !== 'rollup') {
          convertRollups.push(name);
        }
      }

      if (options.dryRun) {
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
        const rollupResult = await ensureRollupProperties(
          notion,
          config.notion.weeklySummaryDataSourceId,
          WEEKLY_SUMMARY_ROLLUP_SCHEMA,
          WEEKLY_SUMMARY_DETAIL_RELATION_NAME
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
      }
    }

    // 7. 週次トータルDBと週次集金DBの双方向リレーションを追加
    if (config.notion.weeklyTotalDataSourceId && config.notion.weeklySummaryDbId) {
      logger.info('週次トータルDB ⇔ 週次集金DB の双方向リレーションを確認中...');

      const totalProps = await getDatabaseProperties(notion, config.notion.weeklyTotalDataSourceId);
      const existingRelation = totalProps[WEEKLY_TOTAL_SUMMARY_RELATION_NAME];

      if (options.dryRun) {
        if (!existingRelation) {
          logger.info(`  追加予定の双方向リレーション:`);
          logger.info(`    週次トータルDB.${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} → 週次集金DB`);
          logger.info(`    週次集金DB.${WEEKLY_SUMMARY_TOTAL_RELATION_NAME} → 週次トータルDB`);
        } else if (existingRelation.type !== 'relation') {
          logger.info(`  リレーションに変換予定: ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} (既存は ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME}_old にリネーム)`);
        } else {
          logger.info(`  双方向リレーションプロパティ: ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} ⇔ ${WEEKLY_SUMMARY_TOTAL_RELATION_NAME} (既存)`);
        }
      } else {
        const relationResult = await ensureDualRelationProperty(
          notion,
          config.notion.weeklyTotalDataSourceId,
          WEEKLY_TOTAL_SUMMARY_RELATION_NAME,
          config.notion.weeklySummaryDbId,
          config.notion.weeklySummaryDataSourceId,
          WEEKLY_SUMMARY_TOTAL_RELATION_NAME,
          false
        );
        if (relationResult.recreated) {
          logger.success(`  双方向リレーションを再作成しました: ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} ⇔ ${WEEKLY_SUMMARY_TOTAL_RELATION_NAME}`);
        } else if (relationResult.created) {
          logger.success(`  双方向リレーションを追加しました: ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} ⇔ ${WEEKLY_SUMMARY_TOTAL_RELATION_NAME}`);
        } else {
          logger.info(`  双方向リレーションプロパティ: ${WEEKLY_TOTAL_SUMMARY_RELATION_NAME} ⇔ ${WEEKLY_SUMMARY_TOTAL_RELATION_NAME} (既存)`);
        }
      }
    }

    // 8. 週次集金個別DBに週次トータルDBへのリレーションを追加
    if (config.notion.weeklyDetailDataSourceId && config.notion.weeklyTotalDbId) {
      logger.info('週次集金個別DB → 週次トータルDB のリレーションを確認中...');

      const detailProps = await getDatabaseProperties(notion, config.notion.weeklyDetailDataSourceId);
      const existingTotalRelation = detailProps[WEEKLY_DETAIL_TOTAL_RELATION_NAME];

      if (options.dryRun) {
        if (!existingTotalRelation) {
          logger.info(`  追加予定のリレーション: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME}`);
        } else if (existingTotalRelation.type !== 'relation') {
          logger.info(`  リレーションに変換予定: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME} (既存は ${WEEKLY_DETAIL_TOTAL_RELATION_NAME}_old にリネーム)`);
        } else {
          // 参照先DBを確認
          const existingTargetId = existingTotalRelation.relation.database_id?.replace(/-/g, '') || '';
          const expectedTargetId = config.notion.weeklyTotalDbId.replace(/-/g, '');
          if (existingTargetId !== expectedTargetId) {
            logger.warn(`  リレーション再作成予定: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME} (参照先DBが異なるため)`);
            logger.warn(`    現在の参照先: ${existingTargetId}`);
            logger.warn(`    正しい参照先: ${expectedTargetId}`);
          } else {
            logger.info(`  リレーションプロパティ: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME} (既存)`);
          }
        }
      } else {
        const totalRelationResult = await ensureRelationProperty(
          notion,
          config.notion.weeklyDetailDataSourceId,
          WEEKLY_DETAIL_TOTAL_RELATION_NAME,
          config.notion.weeklyTotalDbId,
          config.notion.weeklyTotalDataSourceId,
          false
        );
        if (totalRelationResult.recreated) {
          logger.success(`  リレーションプロパティを再作成しました: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME} (参照先DBを修正)`);
        } else if (totalRelationResult.created) {
          logger.success(`  リレーションプロパティを追加しました: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME}`);
        } else {
          logger.info(`  リレーションプロパティ: ${WEEKLY_DETAIL_TOTAL_RELATION_NAME} (既存)`);
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
