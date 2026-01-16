import { Command } from 'commander';
import { parseExcelFile } from '../lib/excel.js';
import {
  createSheetsClient,
  appendToSheet,
  flattenData,
  generateHeaders,
} from '../lib/google-sheets.js';
import { loadConfig, validateFilePath, logger, formatDate, formatWeekPeriod } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface ImportOptions {
  sheet?: string;
  dryRun?: boolean;
}

/**
 * importコマンドの実行
 */
async function runImport(file: string, options: ImportOptions): Promise<void> {
  try {
    // 1. ファイルパスの検証
    const filePath = validateFilePath(file);
    logger.info(`ファイルを読み込み中: ${filePath}`);

    // 2. Excelファイルの解析
    const parsed = await parseExcelFile(filePath);

    logger.info(
      `期間: ${formatDate(parsed.metadata.periodStart)} - ${formatDate(parsed.metadata.periodEnd)}`
    );
    logger.info(
      `クラブ: ${parsed.metadata.clubName} (ID: ${parsed.metadata.clubId})`
    );
    logger.info(`プレーヤー数: ${parsed.players.length}名`);
    logger.info(`ゲームタイプ数: ${parsed.gameTypeNames.length}種類`);

    // 3. Dry-runモードの場合はここで終了
    if (options.dryRun) {
      logger.info('=== Dry-run モード ===');
      parsed.players.slice(0, 5).forEach((p, i) => {
        logger.info(
          `  ${i + 1}. ${p.nickname} (${p.playerId}): 収益 ${p.playerRevenueTotal}, レーキ ${p.clubRevenueTotal}, ハンド数 ${p.handsTotal}`
        );
      });
      if (parsed.players.length > 5) {
        logger.info(`  ... 他 ${parsed.players.length - 5} 名`);
      }
      logger.info('');
      logger.info('ゲームタイプ一覧:');
      parsed.gameTypeNames.forEach((name, i) => {
        logger.info(`  ${i + 1}. ${name}`);
      });
      return;
    }

    // 4. 設定の読み込み
    const config = loadConfig();

    // 5. Google Sheets クライアントの作成
    const sheets = await createSheetsClient(config);
    logger.info('Google Sheets に接続しました');

    // 6. データのフラット化とヘッダー生成
    const flatData = flattenData(parsed);
    const headers = generateHeaders(parsed.gameTypeNames);
    const weekPeriod = formatWeekPeriod(
      parsed.metadata.periodStart,
      parsed.metadata.periodEnd
    );

    // 7. スプレッドシートへの追記（既存データは上書き）
    const sheetName = options.sheet || '週次データ';
    const result = await appendToSheet(
      sheets,
      config.google.spreadsheetId,
      sheetName,
      flatData,
      headers,
      weekPeriod,
      parsed.metadata.clubId
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
 * importコマンドを作成
 */
export function createImportCommand(): Command {
  const command = new Command('import')
    .description('XPokerのExcelファイルをGoogle Sheetsに取り込む')
    .argument('<file>', 'XPokerからエクスポートしたExcelファイルのパス')
    .option('-s, --sheet <name>', 'スプレッドシートのシート名', '週次データ')
    .option('--dry-run', 'スプレッドシートに書き込まずに解析結果を表示')
    .action(async (file: string, options: ImportOptions) => {
      await runImport(file, options);
    });

  return command;
}
