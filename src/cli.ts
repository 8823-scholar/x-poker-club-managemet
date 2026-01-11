#!/usr/bin/env node
import { Command } from 'commander';
import { createImportCommand } from './commands/import.js';

const program = new Command();

program
  .name('xpoker')
  .description('XPokerクラブ管理CLI')
  .version('0.1.0');

// コマンドを登録
program.addCommand(createImportCommand());

program.parse();
