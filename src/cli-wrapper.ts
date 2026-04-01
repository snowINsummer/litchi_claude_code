/**
 * Claude Code CLI Wrapper
 * 
 * Simplified wrapper that handles the most critical imports
 * and provides a minimal working CLI.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   Claude Code 2.1.88 (Source Recovery)                       ║
║                                                              ║
║   Powered by Claude AI                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));

// Check for config
const configPath = join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'settings.json');
const litchiConfigPath = join(process.env.HOME || process.env.USERPROFILE || '', '.litchi', 'config.json');

console.log(chalk.dim('\nChecking configuration...\n'));

if (existsSync(configPath)) {
  console.log(chalk.green('✓ Found Claude Code settings'));
} else if (existsSync(litchiConfigPath)) {
  console.log(chalk.green('✓ Found Litchi Code settings'));
  try {
    const config = JSON.parse(readFileSync(litchiConfigPath, 'utf-8'));
    if (config.baseUrl) {
      process.env.ANTHROPIC_BASE_URL = config.baseUrl;
    }
    if (config.authToken) {
      process.env.ANTHROPIC_AUTH_TOKEN = config.authToken;
    }
  } catch (e) {
    console.error(chalk.red('Failed to read config:', e));
  }
} else {
  console.log(chalk.yellow('⚠ No configuration found'));
  console.log(chalk.dim('Please run: claude login'));
  console.log(chalk.dim('Or set ANTHROPIC_AUTH_TOKEN environment variable\n'));
}

// Try to load main CLI
async function loadMainCLI() {
  try {
    console.log(chalk.dim('\nLoading Claude Code modules...\n'));
    
    // Try to import the bootstrap
    const bootstrap = await import('./entrypoints/cli.tsx');
    console.log(chalk.green('✓ Claude Code modules loaded'));
    
    return true;
  } catch (error) {
    console.error(chalk.red('\n✗ Failed to load Claude Code:'));
    console.error(chalk.dim(String(error)));
    return false;
  }
}

// Run
loadMainCLI().then((success) => {
  if (!success) {
    console.log(chalk.dim('\nNote: Full Claude Code functionality requires additional setup.'));
    console.log(chalk.dim('The source code has complex dependencies on:')));
    console.log(chalk.dim('  - bun:bundle macros'));
    console.log(chalk.dim('  - GrowthBook analytics'));
    console.log(chalk.dim('  - Enterprise MDM integration'));
    console.log(chalk.dim('\nConsider using litchi-code for a simpler experience.\n'));
  }
});
