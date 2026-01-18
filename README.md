# XPoker Club Management CLI

XPokerから出力されたExcelファイルをGoogle スプレッドシートに取り込み、週次集計を行うCLIツール。
Notion連携により、エージェントへの集金データ共有も可能。

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
| `NOTION_API_KEY` | Notion APIキー（Notion連携時に必要） |
| `NOTION_AGENT_DB_ID` | エージェントDBのID |
| `NOTION_PLAYER_DB_ID` | プレイヤーDBのID |
| `NOTION_WEEKLY_SUMMARY_DB_ID` | 週次集金DBのID |
| `NOTION_WEEKLY_DETAIL_DB_ID` | 週次集金個別DBのID |

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

### collect

週次データからエージェント毎の集金データを生成。

```bash
npm run dev -- collect [weekPeriod] [options]

# 引数
#   weekPeriod          対象の週期間（例: "2025-12-24〜2025-12-30"）。省略時は最新

# オプション
#   --source-sheet <name>  読み込み元のシート名（デフォルト: 週次データ）
#   --target-sheet <name>  出力先のシート名（デフォルト: 集金データ）
#   --dry-run              書き込まずに結果を表示
```

**例:**
```bash
# 最新週の集金データを確認
npm run dev -- collect --dry-run

# 特定週の集金データを生成
npm run dev -- collect "2025-12-24〜2025-12-30"
```

### migrate

Notionデータベースのスキーマを作成・更新。

```bash
npm run dev -- migrate [options]

# オプション
#   --dry-run  スキーマの変更をシミュレートのみ行う
```

**例:**
```bash
# スキーマ変更の確認
npm run dev -- migrate --dry-run

# スキーマを更新
npm run dev -- migrate
```

### sync

Google Sheetsの集金データをNotionに同期。

```bash
npm run dev -- sync [weekPeriod] [options]

# 引数
#   weekPeriod               対象の週期間（例: "2025-12-24〜2025-12-30"）。省略時は最新

# オプション
#   --collection-sheet <name>  集金データのシート名（デフォルト: 集金データ）
#   --agent-sheet <name>       エージェントデータのシート名（デフォルト: エージェントデータ）
#   --player-sheet <name>      プレイヤーデータのシート名（デフォルト: プレイヤーデータ）
#   --dry-run                  Notionに書き込まずに同期内容を表示
```

**例:**
```bash
# 同期内容の確認
npm run dev -- sync --dry-run

# 最新週のデータをNotionに同期
npm run dev -- sync

# 特定週のデータを同期
npm run dev -- sync "2025-12-24〜2025-12-30"
```

## Notion連携の設定

### 1. Notion Integrationの作成

1. [Notion Integrations](https://www.notion.so/my-integrations) にアクセス
2. 「New integration」をクリック
3. 名前を入力して作成
4. 「Internal Integration Secret」をコピーして `NOTION_API_KEY` に設定

### 2. データベースの作成

以下の4つのデータベースを作成:

- **エージェントDB**: エージェントのマスターデータ
- **プレイヤーDB**: プレイヤーのマスターデータ
- **週次集金DB**: エージェント毎の週次集計
- **週次集金個別DB**: プレイヤー毎の詳細データ

### 3. Integrationの接続

各データベースで:
1. 右上の「...」メニューをクリック
2. 「Connections」から作成したIntegrationを追加

### 4. Database IDの取得

データベースURLから取得:
```
https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
                      ↑ この32文字がDatabase ID
```

### 5. スキーマの初期化

```bash
npm run dev -- migrate
```

## Notionデータベース構造

### エージェントDB

| プロパティ | 型 | 説明 |
|-----------|------|------|
| エージェント名 | Title | エージェント名 |
| エージェントID | Text | 一意のID |
| リマーク | Text | 備考 |
| Super Agent | Text | 上位エージェント名 |
| フィーレート | Number (%) | 報酬率（デフォルト70%） |

### プレイヤーDB

| プロパティ | 型 | 説明 |
|-----------|------|------|
| ニックネーム | Title | プレイヤーのニックネーム |
| プレイヤーID | Text | 一意のID |
| エージェント | Relation | エージェントDBへのリレーション |
| 国/地域 | Text | プレイヤーの国/地域 |
| リマーク | Text | 備考 |
| レーキバックレート | Number (%) | レーキバック率 |

### 週次集金DB

| プロパティ | 型 | 説明 |
|-----------|------|------|
| タイトル | Title | 「{週期間} - {エージェント名}」 |
| 週期間 | Date (Range) | 対象週期間（開始日〜終了日） |
| エージェント | Relation | エージェントDBへのリレーション |
| プレイヤー数 | Number | 配下プレイヤー数 |
| レーキ合計 | Rollup (sum/¥) | 週次集金個別DBのレーキを集計 (円) |
| レーキバック合計 | Rollup (sum/¥) | 週次集金個別DBのレーキバックを集計 (円) |
| エージェント報酬 | Number (¥) | (レーキ合計 × フィーレート) - レーキバック合計 |
| 成績合計 | Rollup (sum/¥) | 週次集金個別DBの成績を集計 (円) |
| 精算金額合計 | Rollup (sum/¥) | 週次集金個別DBの精算金額を集計 (円) |
| 対ハウス精算金額 | Number (¥) | クラブとの精算金額 (円) |

### 週次集金個別DB

| プロパティ | 型 | 説明 |
|-----------|------|------|
| プレイヤー名 | Title | プレイヤーのニックネーム |
| 週次集金 | Relation | 週次集金DBへのリレーション |
| プレイヤー | Relation | プレイヤーDBへのリレーション |
| プレイヤーID | Text | プレイヤーID |
| 成績 | Number (¥) | 円 |
| レーキ | Number (¥) | 円 |
| レーキバックレート | Number (%) | 0-100% |
| レーキバック | Number (¥) | 円 |
| 精算金額 | Number (¥) | 円 |
