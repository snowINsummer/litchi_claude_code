/**
 * Claude Code Simple Entry Point
 * 
 * A simplified entry point that provides basic Claude Code functionality
 * by wrapping the core modules with minimal dependencies.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Version
const VERSION = '2.1.88';

// Banner
const BANNER = chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  ╝═╔╝╔═╝║ ║╝╔═╝╔═║╔═ ╔═╝                                    ║
║  ║ ║ ║  ╔═║║║  ║ ║║ ║╔═╝                                    ║
║══╝╝ ╝ ══╝╝ ╝╝══╝══╝══ ══╝                                    ║
║                                                              ║
║   ${chalk.bold('LitchiCode')} ${chalk.dim(`v${VERSION} (Source Recovery)`)}                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

interface ApiConfig {
  baseUrl: string;
  authToken: string;
  model: string;
  models: Record<string, string>;
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || 
    (process.platform === 'win32' ? 'C:\\Users\\' + process.env.USERNAME : '/home/' + process.env.USER);
}

function buildModelsMap(): Record<string, string> {
  const models: Record<string, string> = {};
  const envMap: Record<string, string> = {
    ANTHROPIC_MODEL: 'default',
    ANTHROPIC_SMALL_FAST_MODEL: 'small-fast',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku',
  };
  for (const [envKey, role] of Object.entries(envMap)) {
    if (process.env[envKey]) {
      models[role] = process.env[envKey]!;
    }
  }
  return models;
}

function loadConfig(): ApiConfig | null {
  // Try Claude Code settings
  const claudeSettings = join(getHomeDir(), '.claude', 'settings.json');
  if (existsSync(claudeSettings)) {
    try {
      const config = JSON.parse(readFileSync(claudeSettings, 'utf-8'));
      // Inject env vars from settings into process.env (lower priority than real env vars)
      if (config.env) {
        for (const [key, value] of Object.entries(config.env)) {
          if (!process.env[key] && typeof value === 'string') {
            process.env[key] = value;
          }
        }
      }
      if (config.env?.ANTHROPIC_AUTH_TOKEN) {
        return {
          baseUrl: config.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
          authToken: config.env.ANTHROPIC_AUTH_TOKEN,
          model: config.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          models: buildModelsMap(),
        };
      }
    } catch {}
  }

  // Try Litchi Code settings
  const litchiSettings = join(getHomeDir(), '.litchi', 'config.json');
  if (existsSync(litchiSettings)) {
    try {
      const config = JSON.parse(readFileSync(litchiSettings, 'utf-8'));
      if (config.authToken) {
        return {
          baseUrl: config.baseUrl || 'https://api.anthropic.com',
          authToken: config.authToken,
          model: config.model || 'claude-sonnet-4-20250514',
          models: buildModelsMap(),
        };
      }
    } catch {}
  }

  // Try environment variables
  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLAUDE_API_KEY;
  if (token) {
    return {
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      authToken: token,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      models: buildModelsMap(),
    };
  }

  return null;
}

function showHelp() {
  console.log(BANNER);
  console.log(chalk.bold('\n📚 Usage:\n'));
  console.log(chalk.cyan('  claude [options] [prompt]'));
  console.log();
  console.log(chalk.bold('\nOptions:\n'));
  console.log(chalk.cyan('  -p, --print <text>'), chalk.dim('  Non-interactive mode'));
  console.log(chalk.cyan('  -m, --model <id>'), chalk.dim('       Specify model'));
  console.log(chalk.cyan('  --verbose'), chalk.dim('                 Verbose output'));
  console.log(chalk.cyan('  --version, -v'), chalk.dim('             Show version'));
  console.log(chalk.cyan('  --help, -h'), chalk.dim('               Show help'));
  console.log();
  console.log(chalk.bold('\nExamples:\n'));
  console.log(chalk.dim('  claude'), chalk.dim('                  # Start interactive mode'));
  console.log(chalk.dim('  claude -p "Hello"'), chalk.dim('       # Single prompt'));
  console.log(chalk.dim('  claude -m opus "Help me"'), chalk.dim(' # Use Opus model'));
  console.log();
}

async function sendMessage(config: ApiConfig, messages: { role: string; content: string }[], model: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': config.authToken,
  };

  if (!config.baseUrl.includes('anthropic.com')) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
    delete headers['x-api-key'];
  }

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

async function runInteractiveMode(config: ApiConfig, initialModel: string) {
  const readline = await import('readline');
  const messages: { role: string; content: string }[] = [];
  let currentModel = initialModel;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('litchi> '),
  });

  const fetchRemoteModels = async (): Promise<string[]> => {
    try {
      const res = await fetch(`${config.baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${config.authToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: { id: string }[] };
      return (data.data || []).map(m => m.id).sort();
    } catch {
      return [];
    }
  };
  const printWelcome = () => {
    console.log(chalk.dim('\n🚀 Interactive mode started'));
    console.log(chalk.dim('Type your messages and press Enter to send.'));
    console.log(chalk.dim('Commands: /help, /exit, /clear, /model, /switch, /cost, /new'));
    console.log(chalk.dim('Multi-line: type "..." on a line by itself to send.\n'));
  };

  const showHelp = () => {
    console.log(chalk.bold('\n📚 Commands:\n'));
    console.log(chalk.cyan('  /help       '), chalk.dim('Show this help'));
    console.log(chalk.cyan('  /exit       '), chalk.dim('Exit interactive mode'));
    console.log(chalk.cyan('  /quit       '), chalk.dim('Exit interactive mode'));
    console.log(chalk.cyan('  /clear      '), chalk.dim('Clear screen'));
    console.log(chalk.cyan('  /model <id> '), chalk.dim('Switch model by ID or role name'));
    console.log(chalk.cyan('  /models     '), chalk.dim('List configured models'));
    console.log(chalk.cyan('  /switch     '), chalk.dim('Pick model from server list interactively'));
    console.log(chalk.cyan('  /cost       '), chalk.dim('Show token usage'));
    console.log(chalk.cyan('  /new        '), chalk.dim('Start new conversation'));
    console.log(chalk.cyan('  ...        '), chalk.dim('On line by itself - send multi-line input'));
    console.log();
  };

  const showCost = () => {
    console.log(chalk.bold('\n💰 Token Usage:\n'));
    console.log(chalk.cyan('  Input tokens:  '), chalk.white(totalInputTokens.toLocaleString()));
    console.log(chalk.cyan('  Output tokens: '), chalk.white(totalOutputTokens.toLocaleString()));
    console.log(chalk.cyan('  Total tokens:  '), chalk.white((totalInputTokens + totalOutputTokens).toLocaleString()));
    console.log();
  };

  const showModels = () => {
    console.log(chalk.bold('\n🤖 Configured Models:\n'));
    console.log(chalk.cyan(`  Current: ${currentModel}\n`));
    const entries = Object.entries(config.models);
    if (entries.length > 0) {
      const maxRole = Math.max(...entries.map(([r]) => r.length));
      for (const [role, modelId] of entries) {
        const marker = modelId === currentModel ? chalk.green(' ◀') : '';
        console.log(chalk.dim(`  ${role.padEnd(maxRole)}  `) + chalk.cyan(modelId) + marker);
      }
    } else {
      console.log(chalk.dim('  No models configured in settings'));
    }
    console.log(chalk.dim('\n  Switch: /model <model-id> or /model <role>\n'));
  };

  // Multi-line input handling
  let isMultiLine = false;
  let multiLineBuffer = '';

  const sendUserMessage = async (content: string) => {
    console.log(chalk.dim('\n⏳ Thinking...\n'));

    try {
      const allMessages = [...messages, { role: 'user', content }];
      const result = await sendMessage(config, allMessages, currentModel);

      messages.push({ role: 'user', content });
      messages.push({ role: 'assistant', content: result });

      console.log(chalk.white('\n' + result + '\n'));
      console.log(chalk.dim('─'.repeat(60)));
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
  };

  printWelcome();
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    // Handle multi-line mode
    if (isMultiLine) {
      if (input === '...') {
        // Send multi-line input
        isMultiLine = false;
        const content = multiLineBuffer.trim();
        multiLineBuffer = '';
        if (content) {
          await sendUserMessage(content);
        }
      } else {
        multiLineBuffer += (multiLineBuffer ? '\n' : '') + input;
        console.log(chalk.dim('  (type "..." to send)\n'));
      }
      rl.prompt();
      return;
    }

    // Empty input
    if (!input) {
      rl.prompt();
      return;
    }

    // Built-in commands
    if (input === '/exit' || input === '/quit' || input === '/q') {
      showCost();
      console.log(chalk.dim('👋 Goodbye!\n'));
      rl.close();
      return;
    }

    if (input === '/clear' || input === '/cls') {
      console.clear();
      console.log(chalk.cyan(BANNER));
      rl.prompt();
      return;
    }

    if (input === '/help' || input === '/h') {
      showHelp();
      rl.prompt();
      return;
    }

    if (input === '/models') {
      showModels();
      rl.prompt();
      return;
    }

    if (input === '/model') {
      console.log(chalk.cyan(`\n  Current model: ${currentModel}\n`));
      rl.prompt();
      return;
    }

    if (input.startsWith('/model ')) {
      const value = input.slice(7).trim();
      const resolved = config.models[value] || value;
      currentModel = resolved;
      if (config.models[value]) {
        console.log(chalk.green(`✅ Model set to: ${resolved} (${value})\n`));
      } else {
        console.log(chalk.green(`✅ Model set to: ${resolved}\n`));
      }
      rl.prompt();
      return;
    }

    if (input === '/switch') {
      rl.pause();
      console.log(chalk.dim('\n⏳ Fetching models...\n'));
      const remoteModels = await fetchRemoteModels();
      if (remoteModels.length === 0) {
        console.log(chalk.red('❌ Could not fetch model list from server\n'));
        rl.resume();
        rl.prompt();
        return;
      }
      console.log(chalk.bold('🤖 Select a model:\n'));
      remoteModels.forEach((m, i) => {
        const marker = m === currentModel ? chalk.green(' ◀ current') : '';
        console.log(chalk.dim(`  ${String(i + 1).padStart(2)}.`) + ' ' + chalk.cyan(m) + marker);
      });
      console.log(chalk.dim('\n  Enter number to select (or press Enter to cancel):'));
      rl.question(chalk.cyan('  > '), (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= remoteModels.length) {
          currentModel = remoteModels[num - 1];
          console.log(chalk.green(`\n✅ Switched to: ${currentModel}\n`));
        } else if (answer.trim() !== '') {
          console.log(chalk.yellow('\n⚠ Invalid selection, model unchanged\n'));
        } else {
          console.log(chalk.dim('\n  Cancelled\n'));
        }
        rl.resume();
        rl.prompt();
      });
      return;
    }

    if (input === '/cost') {
      showCost();
      rl.prompt();
      return;
    }

    if (input === '/new' || input === '/reset') {
      messages.length = 0;
      totalInputTokens = 0;
      totalOutputTokens = 0;
      console.log(chalk.green('✅ Conversation reset.\n'));
      rl.prompt();
      return;
    }

    // Multi-line trigger
    if (input === '...') {
      isMultiLine = true;
      multiLineBuffer = '';
      console.log(chalk.dim('📝 Multi-line mode. Type "..." to send.\n'));
      rl.prompt();
      return;
    }

    // Send message
    await sendUserMessage(input);
    rl.prompt();
  });

  rl.on('close', () => {
    showCost();
    process.exit(0);
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n⚠️ Use /exit to quit\n'));
    rl.prompt();
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let prompt: string | undefined;
  let model = 'claude-sonnet-4-20250514';
  let printMode = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--print') {
      printMode = true;
      prompt = args[++i];
    } else if (arg === '-m' || arg === '--model') {
      model = args[++i] || model;
    } else if (arg === '-v' || arg === '--version') {
      console.log(chalk.green(`LitchiCode v${VERSION}`));
      return;
    } else if (arg === '-h' || arg === '--help') {
      showHelp();
      return;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (!arg.startsWith('-')) {
      prompt = arg;
    }
  }

  console.log(BANNER);

  // Load config
  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('\n⚠ No API configuration found.\n'));
    console.log(chalk.dim('Please configure your API credentials:\n'));
    console.log(chalk.dim('  1. Create ~/.claude/settings.json with ANTHROPIC_AUTH_TOKEN'));
    console.log(chalk.dim('  2. Or create ~/.litchi/config.json with authToken'));
    console.log(chalk.dim('  3. Or set ANTHROPIC_AUTH_TOKEN environment variable\n'));
    return;
  }

  model = config.model || model;

  console.log(chalk.green('\n✓ API configured\n'));
  if (verbose) {
    console.log(chalk.dim(`  Base URL: ${config.baseUrl}`));
    console.log(chalk.dim(`  Model: ${model}`));
  }

  if (printMode && prompt) {
    // Non-interactive mode
    console.log(chalk.dim('\n⏳ Thinking...\n'));
    try {
      const result = await sendMessage(config, [{ role: 'user', content: prompt }], model);
      console.log(chalk.white(result));
    } catch (error) {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
      process.exit(1);
    }
  } else {
    // Interactive mode
    await runInteractiveMode(config, model);
  }
}

// Run
main().catch((error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
