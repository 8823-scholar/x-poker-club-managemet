#!/usr/bin/env node
import { Command } from "commander";
import dotenv from "dotenv";
import { importCommand } from "./commands/import.js";
import { syncCommand } from "./commands/sync.js";
import { reportCommand } from "./commands/report.js";

// 環境変数の読み込み
dotenv.config();

const program = new Command();

program
  .name("xpoker")
  .description("XPoker Club Management CLI - Excel取込・週次集計・Notion連携")
  .version("0.1.0");

// import: Excelファイルをスプレッドシートに取り込む
program
  .command("import")
  .description("XPokerのExcelファイルをスプレッドシートに取り込む")
  .argument("<file>", "取り込むExcelファイルのパス")
  .option("-s, --sheet <name>", "対象シート名", "Sheet1")
  .action(importCommand);

// sync: Notionにデータを同期
program
  .command("sync")
  .description("スプレッドシートのデータをNotionに同期")
  .option("-w, --week <number>", "対象週番号")
  .action(syncCommand);

// report: 週次レポートを生成
program
  .command("report")
  .description("週次集計レポートを生成")
  .option("-w, --week <number>", "対象週番号（省略時は今週）")
  .option("-o, --output <format>", "出力形式 (console|json)", "console")
  .action(reportCommand);

program.parse();
