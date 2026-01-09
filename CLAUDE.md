# XPoker Club Management CLI

XPokerから出力されたExcelファイルをGoogle スプレッドシートに取り込み、週次集計を行うCLIツール。

## システム概要

- **入力**: XPokerから出力されたExcelファイル
- **データベース**: Google スプレッドシート
- **連携**: Notion（エージェントへの集金データ共有・集金状況更新）
- **主機能**: 週次集計

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
│   ├── sync.ts         # Notion同期
│   └── report.ts       # 週次レポート
├── lib/                # ライブラリ
│   ├── excel.ts        # Excel解析
│   ├── google-sheets.ts # Google Sheets API
│   ├── notion.ts       # Notion API
│   └── utils.ts        # ユーティリティ
└── types/              # 型定義
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
| `sync` | スプレッドシートのデータをNotionに同期 |
| `report` | 週次集計レポートを生成 |

## 環境変数

`.env.example` を参照。Google Sheets APIはサービスアカウント認証を使用。
