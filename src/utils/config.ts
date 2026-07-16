// Configuration file management utilities
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AdapterConfig, ClaudeJson, ClaudeSettings } from '../types/config';

const CONFIG_DIR = path.join(os.homedir(), '.claude-adapter');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function writeSecureJson(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
    });
    fs.chmodSync(filePath, 0o600);
}

/**
 * Load configuration from ~/.claude-adapter/config.json
 */
export function loadConfig(): AdapterConfig | null {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return null;
        }
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as AdapterConfig;
    } catch {
        return null;
    }
}

/**
 * Save configuration to ~/.claude-adapter/config.json
 */
export function saveConfig(config: AdapterConfig): void {
    // Ensure directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    writeSecureJson(CONFIG_FILE, config);
}

/**
 * Check if configuration exists
 */
export function configExists(): boolean {
    return fs.existsSync(CONFIG_FILE);
}

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
    return CONFIG_DIR;
}

// Claude settings file paths
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');

/**
 * Update ~/.claude.json to set hasCompletedOnboarding
 */
export function updateClaudeJson(): void {
    let claudeJson: ClaudeJson = {};

    try {
        if (fs.existsSync(CLAUDE_JSON_PATH)) {
            const content = fs.readFileSync(CLAUDE_JSON_PATH, 'utf-8');
            claudeJson = JSON.parse(content);
        }
    } catch {
        throw new Error(`Refusing to overwrite invalid JSON in ${CLAUDE_JSON_PATH}`);
    }

    claudeJson.hasCompletedOnboarding = true;
    writeSecureJson(CLAUDE_JSON_PATH, claudeJson);
}

/**
 * Update ~/.claude/settings.json with proxy environment variables
 */
export function updateClaudeSettings(
    proxyUrl: string,
    models: { opus: string; sonnet: string; haiku: string }
): void {
    // Ensure directory exists
    if (!fs.existsSync(CLAUDE_SETTINGS_DIR)) {
        fs.mkdirSync(CLAUDE_SETTINGS_DIR, { recursive: true });
    }

    let settings: ClaudeSettings = {};

    try {
        if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
            const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
            settings = JSON.parse(content);
        }
    } catch {
        throw new Error(`Refusing to overwrite invalid JSON in ${CLAUDE_SETTINGS_PATH}`);
    }

    // Merge env settings
    settings.env = {
        ...(settings.env || {}),
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_AUTH_TOKEN: 'default',
        ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
        ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
    };

    writeSecureJson(CLAUDE_SETTINGS_PATH, settings);
}

/**
 * Get paths for display purposes
 */
export function getClaudePaths(): { claudeJson: string; claudeSettings: string } {
    return {
        claudeJson: CLAUDE_JSON_PATH,
        claudeSettings: CLAUDE_SETTINGS_PATH,
    };
}
