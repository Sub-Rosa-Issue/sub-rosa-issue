#!/usr/bin/env node

import { Command } from 'commander';
import { DoctorCommand } from './commands/doctor';
import * as dotenv from 'dotenv';

// Load environment variables from a .env file if present
dotenv.config();

const program = new Command();

program
  .name('sub-rosa-keeper')
  .description('Automated Keeper execution engine and configuration manager')
  .version('1.0.0');

// Register the diagnostic configuration doctor command
program.addCommand(DoctorCommand);

// Parse the command line arguments provided by the operator
program.parse(process.argv);

// If no arguments or commands are provided, display the help menu automatically
if (!process.argv.slice(2).length) {
  program.outputHelp();
}