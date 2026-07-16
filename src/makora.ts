import { AnthropicMessageRequest } from './types/anthropic';
import { OpenAIChatRequest, OpenAIAssistantMessage } from './types/openai';

export const MAKORA_BASE_URL = 'https://inference.makora.com/v1';
export const DEFAULT_MAKORA_MODEL = 'zai-org/GLM-5.2-FP8';

export interface MakoraModelPolicy {
    family: 'deepseek' | 'glm' | 'qwen' | 'kimi' | 'other';
    baseUrl?: string;
    maxTokensField: 'max_completion_tokens';
    assistantReasoningField?: 'reasoning_content';
    guardedForNanCollapse?: boolean;
}

const LLAMA_OVERRIDE = 'amd/Llama-3.3-70B-Instruct-FP8-KV';
const LLAMA_OVERRIDE_URL = 'https://inference.makora.com/llama3-3-70b-instruct-fp8/v1';

/** Resolve Makora compatibility by model family. Unknown models stay usable. */
export function getMakoraModelPolicy(model: string): MakoraModelPolicy {
    const normalized = model.toLowerCase();
    const base = { maxTokensField: 'max_completion_tokens' as const };

    if (normalized.includes('deepseek')) {
        return {
            ...base,
            family: 'deepseek',
            ...(normalized.includes('v4-pro') ? { assistantReasoningField: 'reasoning_content' as const } : {}),
        };
    }
    if (normalized.includes('glm-5.2')) {
        return {
            ...base,
            family: 'glm',
            guardedForNanCollapse: true,
        };
    }
    if (normalized.includes('qwen3.6')) {
        return { ...base, family: 'qwen' };
    }
    if (normalized.includes('kimi-k2.7')) {
        return {
            ...base,
            family: 'kimi',
            assistantReasoningField: 'reasoning_content',
        };
    }
    return {
        ...base,
        family: 'other',
        ...(normalized === LLAMA_OVERRIDE.toLowerCase() ? { baseUrl: LLAMA_OVERRIDE_URL } : {}),
    };
}

/** Apply vLLM payload controls used by Makora's current model templates. */
export function applyMakoraRequestPolicy(
    request: OpenAIChatRequest,
    anthropicRequest: AnthropicMessageRequest,
    policy: MakoraModelPolicy
): OpenAIChatRequest {
    const result = request as OpenAIChatRequest & Record<string, unknown>;
    const maxTokens = result.max_tokens ?? result.max_completion_tokens;
    delete result.max_tokens;
    result.max_completion_tokens = maxTokens;

    // Claude Code may omit `thinking` or use adaptive thinking. Only an explicit
    // disabled value turns reasoning off for Makora's reasoning models.
    const thinkingOn = anthropicRequest.thinking?.type !== 'disabled';
    if (policy.family === 'glm') {
        result.reasoning_effort = thinkingOn ? 'high' : 'none';
        result.chat_template_kwargs = { clear_thinking: !thinkingOn };
    } else if (policy.family === 'qwen') {
        result.reasoning_effort = thinkingOn ? 'high' : 'none';
        result.chat_template_kwargs = { preserve_thinking: thinkingOn };
    } else if (policy.family === 'kimi') {
        result.chat_template_kwargs = {
            thinking: thinkingOn,
            preserve_thinking: thinkingOn,
        };
    } else if (policy.family === 'deepseek' && thinkingOn) {
        result.reasoning_effort = 'high';
    }

    if (policy.assistantReasoningField && thinkingOn) {
        result.messages = result.messages.map(message => {
            if (message.role !== 'assistant') return message;
            const assistant = message as OpenAIAssistantMessage;
            if (!assistant.reasoning) return message;
            return { ...assistant, [policy.assistantReasoningField!]: assistant.reasoning };
        });
    }

    return result;
}

const ONSET_WINDOW_CHARS = 64;
const ONSET_MIN_CHARS = 40;
const ONSET_MIN_REPS = 20;
const UNIT_MAX_LEN = 3;

/** Detect the GLM NaN-argmax fixed point at reasoning onset. */
export function isMakoraOnsetCollapse(text: string): boolean {
    const onset = text.slice(0, ONSET_WINDOW_CHARS);
    if (onset.length < ONSET_MIN_CHARS || /^\s/.test(onset)) return false;

    for (let unitLength = 1; unitLength <= UNIT_MAX_LEN; unitLength++) {
        if (onset.length < unitLength * ONSET_MIN_REPS) continue;
        let repeated = true;
        for (let index = unitLength; index < onset.length; index++) {
            if (onset[index] !== onset[index % unitLength]) {
                repeated = false;
                break;
            }
        }
        if (repeated) return true;
    }
    return false;
}
