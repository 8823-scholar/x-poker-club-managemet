/**
 * Excelメタデータ
 */
export interface ExcelMetadata {
  /** 期間開始日 */
  periodStart: Date;
  /** 期間終了日 */
  periodEnd: Date;
  /** タイムゾーン */
  timezone: string;
  /** エクスポート実行ユーザーID */
  exportedBy: string;
  /** クラブ名 */
  clubName: string;
  /** クラブID */
  clubId: string;
}

/**
 * ゲームタイプ別データ
 */
export interface GameTypeData {
  /** プレーヤー収益 */
  revenue: number | null;
  /** クラブレーキ */
  rake: number | null;
  /** ハンド数 */
  hands: number | null;
}

/**
 * プレーヤー行データ
 */
export interface PlayerRow {
  /** ニックネーム */
  nickname: string;
  /** プレーヤーID */
  playerId: string;
  /** リマーク（備考） */
  remark: string;
  /** エージェント名 */
  agentName: string | null;
  /** エージェントID */
  agentId: string | null;
  /** Super Agent名 */
  superAgentName: string | null;
  /** Super Agent ID */
  superAgentId: string | null;
  /** 国/地域 */
  country: string;
  /** プレーヤー収益合計 */
  playerRevenueTotal: number | null;
  /** クラブレーキ合計 */
  clubRevenueTotal: number | null;
  /** ハンド数合計 */
  handsTotal: number | null;
  /** ゲームタイプ別データ */
  gameTypes: Record<string, GameTypeData>;
}

/**
 * Excelパース結果
 */
export interface ParsedExcelData {
  /** メタデータ */
  metadata: ExcelMetadata;
  /** プレーヤーデータ */
  players: PlayerRow[];
  /** ゲームタイプ一覧（順序保持） */
  gameTypeNames: string[];
}

/**
 * 設定
 */
export interface Config {
  google: {
    /** サービスアカウントキー（Base64エンコード） */
    serviceAccountKey: string;
    /** スプレッドシートID */
    spreadsheetId: string;
  };
  notion?: {
    /** Notion APIキー */
    apiKey: string;
    /** エージェントDBのID */
    agentDbId: string;
    /** プレイヤーDBのID */
    playerDbId: string;
    /** 週次集金DBのID */
    weeklySummaryDbId: string;
    /** 週次集金個別DBのID */
    weeklyDetailDbId: string;
  };
}
