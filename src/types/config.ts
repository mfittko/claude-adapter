// Configuration types for claude-adapter

export interface AdapterConfig {
    baseUrl: string;
    apiKey: string;
    models: ModelConfig;
    toolFormat?: 'native' | 'xml';  // Default: 'native'
    port?: number;
    mode?: 'generic' | 'makora';
    /** Process-local credential required by the loopback proxy. */
    localAuthToken?: string;
}

export interface ModelConfig {
    opus: string;
    sonnet: string;
    haiku: string;
}

export interface ClaudeSettings {
    env?: Record<string, string>;
    [key: string]: unknown; // Preserve other settings
}

export interface ClaudeJson {
    hasCompletedOnboarding?: boolean;
    [key: string]: unknown; // Preserve other settings
}
