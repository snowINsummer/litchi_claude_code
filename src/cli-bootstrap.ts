/**
 * Claude Code Entry Point Wrapper
 * 
 * This file provides a simplified entry point that:
 * 1. Handles bun:bundle feature flags
 * 2. Provides MACRO definitions
 * 3. Wraps the original cli entrypoint
 */

// Define global MACRO object
declare global {
  var MACRO: {
    VERSION: string;
  };
}

globalThis.MACRO = {
  VERSION: '2.1.88'
};

// Mock bun:bundle feature function
// In production builds, this is replaced at build time for dead code elimination
const featureFlags: Record<string, boolean> = {
  // Core features - enabled by default
  'DAEMON': false,  // Disable daemon mode
  'BRIDGE_MODE': false,  // Disable bridge mode
  'BG_SESSIONS': false,  // Disable background sessions
  'TEMPLATES': false,  // Disable templates
  'BYOC_ENVIRONMENT_RUNNER': false,  // Disable BYOC
  'SELF_HOSTED_RUNNER': false,  // Disable self-hosted runner
  'CHICAGO_MCP': false,  // Disable Chicago MCP
  'DUMP_SYSTEM_PROMPT': false,  // Disable system prompt dump
  'ABLATION_BASELINE': false,  // Disable ablation
  // Agent features
  'COORDINATOR_MODE': false,  // Disable coordinator
  'KAIROS': false,  // Disable KAIROS (assistant mode)
  'VOICE_MODE': false,  // Disable voice mode
  // Other features
  'PROACTIVE': false,
  'AGENT_TRIGGERS': false,
  'MONITOR_TOOL': false,
};

// Feature flag function - mimics bun:bundle behavior
export function feature(name: string): boolean {
  // Check environment variable override
  const envKey = `CLAUDE_CODE_FEATURE_${name}`;
  if (process.env[envKey] !== undefined) {
    return process.env[envKey] === '1' || process.env[envKey] === 'true';
  }
  return featureFlags[name] ?? false;
}

// Re-export for compatibility
export { feature };

// Now import and run the actual CLI
import('./cli-wrapper.js').catch((err) => {
  console.error('Failed to start Claude Code:', err);
  process.exit(1);
});
