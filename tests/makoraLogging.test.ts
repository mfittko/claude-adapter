import { convertRequestToOpenAI } from '../src/converters/request';
import { createMessagesHandler } from '../src/server/handlers';
import { logger, LogLevel } from '../src/utils/logger';
import { AdapterConfig } from '../src/types/config';

const makoraConfig: AdapterConfig = {
    baseUrl: 'https://inference.makora.com/v1',
    apiKey: 'upstream-key',
    localAuthToken: 'local-key',
    mode: 'makora',
    toolFormat: 'native',
    models: { opus: 'model', sonnet: 'model', haiku: 'model' },
};

describe('Makora wrapper logging', () => {
    it('keeps proxy info, warnings, errors, and repair logs off the child TUI without changing generic logging', async () => {
        const log = jest.spyOn(console, 'log').mockImplementation();
        const error = jest.spyOn(console, 'error').mockImplementation();
        logger.setLevel(LogLevel.INFO);
        try {
            const reply = {
                header: jest.fn().mockReturnThis(),
                code: jest.fn().mockReturnThis(),
                send: jest.fn().mockReturnThis(),
            };
            await createMessagesHandler(makoraConfig)({ body: {} } as any, reply as any);

            const request = {
                model: 'model',
                max_tokens: 32,
                messages: [
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'duplicate', name: 'tool', input: {} }] },
                    { role: 'assistant', content: [{ type: 'tool_use', id: 'duplicate', name: 'tool', input: {} }] },
                ],
            } as any;
            convertRequestToOpenAI(request, 'model', 'native', false, false, true, true);

            const silent = logger.withRequestId('makora', true);
            silent.info('sent');
            silent.warn('warning');
            silent.error('failed', new Error('failure'));
            silent.print('raw');

            expect(log).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();

            logger.info('generic output');
            expect(log).toHaveBeenCalledTimes(1);
            expect(error).not.toHaveBeenCalled();
        } finally {
            log.mockRestore();
            error.mockRestore();
        }
    });
});
