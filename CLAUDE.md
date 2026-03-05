# XPoker Club Management CLI

XPokerから出力されたExcelファイルをGoogle スプレッドシートに取り込み、週次・月次集計を行うCLIツール。

## システム概要

- **入力**: XPokerから出力されたExcelファイル
- **データベース**: Google スプレッドシート
- **連携**: Notion（エージェントへの集金データ共有・集金状況更新・月次集計）
- **主機能**: 週次集計、月次集計

## 技術スタック

- Node.js + TypeScript
- Commander.js（CLIフレームワーク）
- xlsx（Excel解析）
- googleapis（Google Sheets API）
- @notionhq/client（Notion API）

## ディレクトリ構成

```
src/
├── cli.ts              # CLIエントリーポイント
├── commands/           # コマンド実装
│   ├── import.ts       # Excel取込
│   ├── collect.ts      # 集金データ生成
│   ├── sync.ts         # Notion同期
│   ├── monthly.ts      # 月次集計
│   └── migrate.ts      # Notionスキーマ管理
├── lib/                # ライブラリ
│   ├── excel.ts        # Excel解析
│   ├── google-sheets.ts # Google Sheets API
│   ├── notion.ts       # Notion API
│   ├── notion-builders.ts # Notionプロパティビルダー
│   └── utils.ts        # ユーティリティ（設定読込・ロガー）
└── types/              # 型定義
    ├── index.ts        # 共通型（Config等）
    └── notion.ts       # Notion関連の型
```

## コマンド

```bash
# 開発時実行
npm run dev -- <command>

# ビルド後実行
npm run build
npm start <command>
```

| コマンド | 説明 |
|---------|------|
| `import <file>` | XPokerのExcelをスプレッドシートに取込 |
| `collect [weekPeriod]` | 週次データから集金データを生成 |
| `sync [weekPeriod]` | スプレッドシートのデータをNotionに同期 |
| `monthly` | 月次集計レポートを生成してNotionに同期 |
| `migrate` | NotionのDBスキーマを作成・更新 |

## ワークフロー

```
import → collect → sync（週次）
monthly（月次、sync完了後に実行）
```

## Notion DB構成

| DB | 用途 |
|----|------|
| エージェントDB | エージェントのマスターデータ |
| プレイヤーDB | プレイヤーのマスターデータ |
| 週次集金DB | エージェント毎の週次集計 |
| 週次集金個別DB | プレイヤー毎の詳細データ |
| 週次トータルDB | 週次の全体集計 |
| 月次集計DB | 月次の全体集計・オーナー精算 |
| コストDB | ハウスの経費管理 |

## 環境変数

`.env.example` を参照。Google Sheets APIはサービスアカウント認証を使用。
