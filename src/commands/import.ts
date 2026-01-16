import { Command } from 'commander';
import { parseExcelFile } from '../lib/excel.js';
import {
  createSheetsClient,
  appendToSheet,
  flattenData,
  generateHeaders,
  appendNewAgents,
  AGENT_HEADERS,
  AgentData,
  appendNewPlayers,
  PLAYER_HEADERS,
  PlayerData,
} from '../lib/google-sheets.js';
import { ParsedExcelData } from '../types/index.js';
import { loadConfig, validateFilePath, logger, formatDate, formatWeekPeriod } from '../lib/utils.js';

/**
 * コマンドオプションの型
 */
interface ImportOptions {
  sheet?: string;
  dryRun?: boolean;
}

/**
 * パースデータからユニークなエージェント情報を抽出
 * エージェントIDがないもの（直接プレーヤー）は除外
 * リマークはエージェント自身（playerId == agentId）のものを使用
 */
function extractUniqueAgents(parsed: ParsedExcelData): AgentData[] {
  const agentMap = new Map<string, AgentData>();

  // まずエージェント情報を収集
  for (const player of parsed.players) {
    // エージェントIDがない場合はスキップ
    if (!player.agentId) {
      continue;
    }

    // 既に登録済みならスキップ
    if (agentMap.has(player.agentId)) {
      continue;
    }

    agentMap.set(player.agentId, {
      agentId: player.agentId,
      agentName: player.agentName || '',
      superAgentId: player.superAgentId || '',
      superAgentName: player.superAgentName || '',
      feeRate: 0.7, // デフォルトのフィーレート
      remark: '', // 後で更新
    });
  }

  // エージェント自身のリマークを設定（playerId == agentId のプレイヤーを探す）
  for (const player of parsed.players) {
    if (agentMap.has(player.playerId)) {
      const agent = agentMap.get(player.playerId)!;
      agent.remark = player.remark || '';
    }
  }

  return Array.from(agentMap.values());
}

/**
 * パースデータからユニークなプレイヤー情報を抽出
 * プレイヤーID + エージェントIDの組み合わせでユニーク化
 * （同じプレイヤーでもエージェントが異なれば別レコード）
 */
function extractUniquePlayers(parsed: ParsedExcelData): PlayerData[] {
  const playerMap = new Map<string, PlayerData>();

  for (const player of parsed.players) {
    // プレイヤーID + エージェントIDの組み合わせをキーとする
    const key = `${player.playerId}:${player.agentId || ''}`;

    // 既に登録済みならスキップ
    if (playerMap.has(key)) {
      continue;
    }

    playerMap.set(key, {
      playerId: player.playerId,
      nickname: player.nickname,
      agentId: player.agentId || '',
      agentName: player.agentName || '',
      country: player.country || '',
      remark: player.remark || '',
      rakebackRate: 0.0, // デフォルトのレーキバックレート
    });
  }

  return Array.from(playerMap.values());
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

    // 3. エージェント情報を抽出
    const agents = extractUniqueAgents(parsed);
    logger.info(`エージェント数: ${agents.length}名`);

    // 4. プレイヤー情報を抽出
    const players = extractUniquePlayers(parsed);
    logger.info(`ユニークプレイヤー数: ${players.length}名`);

    // 5. Dry-runモードの場合はここで終了
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
      logger.info('');
      logger.info('エージェント一覧:');
      agents.slice(0, 5).forEach((a, i) => {
        logger.info(
          `  ${i + 1}. ${a.agentName} (${a.agentId})${a.superAgentName ? ` - Super: ${a.superAgentName}` : ''}`
        );
      });
      if (agents.length > 5) {
        logger.info(`  ... 他 ${agents.length - 5} 名`);
      }
      logger.info('');
      logger.info('プレイヤー一覧:');
      players.slice(0, 5).forEach((p, i) => {
        logger.info(
          `  ${i + 1}. ${p.nickname} (${p.playerId})${p.agentName ? ` - Agent: ${p.agentName}` : ''}`
        );
      });
      if (players.length > 5) {
        logger.info(`  ... 他 ${players.length - 5} 名`);
      }
      return;
    }

    // 6. 設定の読み込み
    const config = loadConfig();

    // 7. Google Sheets クライアントの作成
    const sheets = await createSheetsClient(config);
    logger.info('Google Sheets に接続しました');

    // 8. データのフラット化とヘッダー生成
    const flatData = flattenData(parsed);
    const headers = generateHeaders(parsed.gameTypeNames);
    const weekPeriod = formatWeekPeriod(
      parsed.metadata.periodStart,
      parsed.metadata.periodEnd
    );

    // 9. スプレッドシートへの追記（既存データは上書き）
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

    // 10. エージェントデータの同期（新規エージェントのみ追記）
    const agentResult = await appendNewAgents(
      sheets,
      config.google.spreadsheetId,
      'エージェントデータ',
      agents,
      AGENT_HEADERS
    );

    if (agentResult.addedCount > 0) {
      logger.success(`新規エージェント ${agentResult.addedCount}名を追加しました`);
    } else {
      logger.info('新規エージェントはありませんでした');
    }

    // 11. プレイヤーデータの同期（新規プレイヤーのみ追記）
    const playerResult = await appendNewPlayers(
      sheets,
      config.google.spreadsheetId,
      'プレイヤーデータ',
      players,
      PLAYER_HEADERS
    );

    if (playerResult.addedCount > 0) {
      logger.success(`新規プレイヤー ${playerResult.addedCount}名を追加しました`);
    } else {
      logger.info('新規プレイヤーはありませんでした');
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
