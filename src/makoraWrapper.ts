import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { AdapterConfig, ModelConfig } from './types/config';
import { createServer, findAvailablePort } from './server';
import { DEFAULT_MAKORA_MODEL, getMakoraModelPolicy, MAKORA_BASE_URL } from './makora';

export interface MakoraLaunchOptions {
    port: number;
    model?: string;
    models?: Partial<ModelConfig>;
    claudeCommand?: string;
    claudeArgs?: string[];
    env?: NodeJS.ProcessEnv;
}

export function createMakoraConfig(
    apiKey: string,
    localAuthToken: string,
    models: ModelConfig
): AdapterConfig {
    return {
        baseUrl: MAKORA_BASE_URL,
        apiKey,
        models,
        toolFormat: 'native',
        mode: 'makora',
        localAuthToken,
    };
}

function claudeModelAlias(model: string, oneMillionEligible: boolean): string {
    return oneMillionEligible && getMakoraModelPolicy(model).claudeOneMillionContext
        ? `${model}[1m]`
        : model;
}

export function buildMakoraChildEnv(
    proxyUrl: string,
    localAuthToken: string,
    models: ModelConfig,
    sourceEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const childEnv = { ...sourceEnv };
    delete childEnv.MAKORA_OPTIMIZE_TOKEN;
    delete childEnv.ANTHROPIC_API_KEY;
    return {
        ...childEnv,
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_AUTH_TOKEN: localAuthToken,
        ANTHROPIC_DEFAULT_OPUS_MODEL: claudeModelAlias(models.opus, true),
        ANTHROPIC_DEFAULT_SONNET_MODEL: claudeModelAlias(models.sonnet, true),
        ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        ENABLE_TOOL_SEARCH: 'false',
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1',
        DISABLE_AUTOUPDATER: '1',
    };
}

/** Start an authenticated loopback proxy, run Claude Code, then stop the proxy. */
export async function launchClaudeWithMakora(options: MakoraLaunchOptions): Promise<number> {
    const env = options.env ?? process.env;
    const apiKey = env.MAKORA_OPTIMIZE_TOKEN;
    if (!apiKey) {
        throw new Error('MAKORA_OPTIMIZE_TOKEN is required for --makora');
    }

    const fallback = options.model ?? DEFAULT_MAKORA_MODEL;
    const models: ModelConfig = {
        opus: options.models?.opus ?? fallback,
        sonnet: options.models?.sonnet ?? fallback,
        haiku: options.models?.haiku ?? fallback,
    };
    const localAuthToken = randomBytes(32).toString('base64url');
    const port = await findAvailablePort(options.port);
    const server = createServer(createMakoraConfig(apiKey, localAuthToken, models));
    const proxyUrl = await server.start(port);

    let child: ReturnType<typeof spawn> | undefined;
    const forwardSignal = (signal: NodeJS.Signals) => {
        if (child && !child.killed) child.kill(signal);
    };
    const onSigint = () => forwardSignal('SIGINT');
    const onSigterm = () => forwardSignal('SIGTERM');

    try {
        child = spawn(options.claudeCommand ?? env.CLAUDE_CODE_COMMAND ?? 'claude', options.claudeArgs ?? [], {
            stdio: 'inherit',
            env: buildMakoraChildEnv(proxyUrl, localAuthToken, models, env),
        });
        process.once('SIGINT', onSigint);
        process.once('SIGTERM', onSigterm);
        return await new Promise<number>((resolve, reject) => {
            child!.once('error', reject);
            child!.once('exit', (code, signal) => {
                if (signal) resolve(signal === 'SIGINT' ? 130 : 143);
                else resolve(code ?? 1);
            });
        });
    } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        await server.stop();
    }
}
