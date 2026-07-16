import {
    applyMakoraRequestPolicy,
    getMakoraModelPolicy,
    isMakoraOnsetCollapse,
    DEFAULT_MAKORA_MODEL,
    MAKORA_BASE_URL,
} from '../src/makora';
import { buildMakoraChildEnv, createMakoraConfig } from '../src/makoraWrapper';
import { convertRequestToOpenAI } from '../src/converters/request';
import { AnthropicMessageRequest } from '../src/types/anthropic';

function request(model: string, thinking: 'enabled' | 'disabled' | 'adaptive'): AnthropicMessageRequest {
    return {
        model,
        max_tokens: 1024,
        thinking: { type: thinking, budget_tokens: 512 },
        messages: [
            { role: 'user', content: 'Continue' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'prior reasoning', signature: 'ignored' },
                    { type: 'text', text: 'Prior answer' },
                ],
            },
        ],
    };
}

function convertMakoraRequest(input: AnthropicMessageRequest) {
    return convertRequestToOpenAI(input, input.model, 'native', false, false, true);
}

describe('Makora compatibility', () => {
    it('uses GLM 5.2 FP8 by default', () => {
        expect(DEFAULT_MAKORA_MODEL).toBe('zai-org/GLM-5.2-FP8');
    });

    it('applies GLM, Qwen, and Kimi thinking policies with max_completion_tokens', () => {
        const glmInput = request('zai-org/GLM-5.2-FP8', 'disabled');
        const glm = applyMakoraRequestPolicy(
            convertMakoraRequest(glmInput),
            glmInput,
            getMakoraModelPolicy(glmInput.model)
        );
        expect(glm).toMatchObject({
            max_completion_tokens: 1024,
            reasoning_effort: 'none',
            chat_template_kwargs: { clear_thinking: true },
        });
        expect(glm.max_tokens).toBeUndefined();

        const qwenInput = request('unsloth/Qwen3.6-27B-NVFP4', 'adaptive');
        const qwen = applyMakoraRequestPolicy(
            convertMakoraRequest(qwenInput),
            qwenInput,
            getMakoraModelPolicy(qwenInput.model)
        );
        expect(qwen.chat_template_kwargs).toEqual({ preserve_thinking: true });
        expect(qwen.reasoning_effort).toBe('high');

        const kimiInput = request('moonshotai/Kimi-K2.7-Code', 'enabled');
        const kimi = applyMakoraRequestPolicy(
            convertMakoraRequest(kimiInput),
            kimiInput,
            getMakoraModelPolicy(kimiInput.model)
        );
        expect(kimi.chat_template_kwargs).toEqual({ thinking: true, preserve_thinking: true });
        expect((kimi.messages[1] as any).reasoning_content).toBe('prior reasoning');
        expect(kimi.reasoning_effort).toBeUndefined();

        const deepSeekInput = request('deepseek-ai/DeepSeek-V4-Pro', 'enabled');
        const deepSeek = applyMakoraRequestPolicy(
            convertMakoraRequest(deepSeekInput),
            deepSeekInput,
            getMakoraModelPolicy(deepSeekInput.model)
        );
        expect(deepSeek.reasoning_effort).toBe('high');
        expect((deepSeek.messages[1] as any).reasoning_content).toBe('prior reasoning');
    });

    it('uses known per-model endpoint and guards only GLM family', () => {
        expect(getMakoraModelPolicy('amd/Llama-3.3-70B-Instruct-FP8-KV').baseUrl)
            .toBe('https://inference.makora.com/llama3-3-70b-instruct-fp8/v1');
        expect(getMakoraModelPolicy('AMD/LLAMA-3.3-70B-INSTRUCT-FP8-KV').baseUrl)
            .toBe('https://inference.makora.com/llama3-3-70b-instruct-fp8/v1');
        expect(getMakoraModelPolicy('zai-org/GLM-5.2-NVFP4').guardedForNanCollapse).toBe(true);
        expect(getMakoraModelPolicy('moonshotai/Kimi-K2.7-Code').guardedForNanCollapse).toBeUndefined();
    });

    it('detects repeated short-unit reasoning only at onset', () => {
        expect(isMakoraOnsetCollapse('!'.repeat(40))).toBe(true);
        expect(isMakoraOnsetCollapse('{},'.repeat(20))).toBe(true);
        expect(isMakoraOnsetCollapse('Normal reasoning with enough varied content to exceed forty chars.')).toBe(false);
    });

    it('builds process-only config and safe Claude environment', () => {
        const models = { opus: 'o', sonnet: 's', haiku: 'h' };
        const config = createMakoraConfig('upstream-key', 'local-key', models);
        expect(config).toMatchObject({
            baseUrl: MAKORA_BASE_URL,
            apiKey: 'upstream-key',
            localAuthToken: 'local-key',
            mode: 'makora',
            toolFormat: 'native',
        });

        const env = buildMakoraChildEnv('http://127.0.0.1:3080', 'local-key', models, {
            MAKORA_OPTIMIZE_TOKEN: 'upstream-key',
        });
        expect(env.MAKORA_OPTIMIZE_TOKEN).toBeUndefined();
        expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-key');
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('s');
        expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1');
        expect(env.ENABLE_TOOL_SEARCH).toBe('false');
        expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    });
});
