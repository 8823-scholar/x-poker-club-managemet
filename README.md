# XPoker Club Management CLI

XPokerから出力されたExcelファイルをGoogle スプレッドシートに取り込むCLIツール。

## セットアップ

```bash
npm install
cp .env.example .env
# .env に環境変数を設定
```

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | サービスアカウントのJSON認証情報（Base64エンコード） |
| `GOOGLE_SPREADSHEET_ID` | スプレッドシートID（URLの `/d/` と `/edit` の間の文字列） |
| `NOTION_API_KEY` | Notion APIキー（オプション） |
| `NOTION_DATABASE_ID` | NotionデータベースID（オプション） |

## コマンド

```bash
# 開発時
npm run dev -- <command>

# ビルド後
npm run build && npm start <command>
```

### import

Excelファイルをスプレッドシートに取り込む。

```bash
npm run dev -- import <file> [options]

# オプション
#   -s, --sheet <name>  シート名（デフォルト: 週次データ）
#   --dry-run           書き込まずに解析結果のみ表示
```

**例:**
```bash
# 解析結果の確認
npm run dev -- import ./data.xlsx --dry-run

# スプレッドシートに取り込み
npm run dev -- import ./data.xlsx
```
