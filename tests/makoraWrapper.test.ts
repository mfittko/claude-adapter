import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { createServer, findAvailablePort } from '../src/server';
import { launchClaudeWithMakora } from '../src/makoraWrapper';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../src/server', () => ({
    createServer: jest.fn(),
    findAvailablePort: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;
const createServerMock = createServer as jest.MockedFunction<typeof createServer>;
const findAvailablePortMock = findAvailablePort as jest.MockedFunction<typeof findAvailablePort>;

function mockServer() {
    const server = {
        app: {} as any,
        start: jest.fn().mockResolvedValue('http://127.0.0.1:4000'),
        stop: jest.fn().mockResolvedValue(undefined),
    };
    createServerMock.mockReturnValue(server);
    findAvailablePortMock.mockResolvedValue(4000);
    return server;
}

describe('Makora wrapper lifecycle', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the Claude exit code, hides the upstream token, and stops the proxy', async () => {
        const server = mockServer();
        const child = Object.assign(new EventEmitter(), {
            killed: false,
            kill: jest.fn(),
        });
        spawnMock.mockReturnValue(child as any);
        setImmediate(() => child.emit('exit', 7, null));

        await expect(launchClaudeWithMakora({
            port: 3080,
            claudeCommand: 'claude-test',
            claudeArgs: ['--version'],
            env: { MAKORA_OPTIMIZE_TOKEN: 'upstream-secret' },
        })).resolves.toBe(7);

        expect(spawnMock).toHaveBeenCalledWith(
            'claude-test',
            ['--version'],
            expect.objectContaining({
                stdio: 'inherit',
                env: expect.objectContaining({
                    ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000',
                }),
            })
        );
        expect((spawnMock.mock.calls[0][2]!.env as Record<string, string | undefined>).MAKORA_OPTIMIZE_TOKEN)
            .toBeUndefined();
        expect(server.stop).toHaveBeenCalledTimes(1);
    });

    it('stops the proxy when Claude fails to spawn', async () => {
        const server = mockServer();
        const child = Object.assign(new EventEmitter(), {
            killed: false,
            kill: jest.fn(),
        });
        spawnMock.mockReturnValue(child as any);
        setImmediate(() => child.emit('error', new Error('spawn failed')));

        await expect(launchClaudeWithMakora({
            port: 3080,
            env: { MAKORA_OPTIMIZE_TOKEN: 'upstream-secret' },
        })).rejects.toThrow('spawn failed');
        expect(server.stop).toHaveBeenCalledTimes(1);
    });
});
