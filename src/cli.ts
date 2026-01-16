#!/usr/bin/env node
import { Command } from 'commander';
import { createImportCommand } from './commands/import.js';
import { createCollectCommand } from './commands/collect.js';
import { createMigrateCommand } from './commands/migrate.js';
import { createSyncCommand } from './commands/sync.js';

const program = new Command();

program
  .name('xpoker')
  .description('XPokerクラブ管理CLI')
  .version('0.1.0');

// コマンドを登録
program.addCommand(createImportCommand());
program.addCommand(createCollectCommand());
program.addCommand(createMigrateCommand());
program.addCommand(createSyncCommand());

program.parse();
