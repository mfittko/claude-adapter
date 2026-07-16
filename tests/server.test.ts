// Tests for server setup (no port binding)
import { createServer, findAvailablePort } from '../src/server';
import { AdapterConfig } from '../src/types/config';

// Mock logger
jest.mock('../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        withRequestId: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        })),
    },
    LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
}));

const testConfig: AdapterConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    models: {
        opus: 'gpt-4',
        sonnet: 'gpt-4',
        haiku: 'gpt-3.5-turbo',
    },
};

describe('Server', () => {
    describe('createServer', () => {
        it('should create a server with app instance', () => {
            const server = createServer(testConfig);
            expect(server).toBeDefined();
            expect(server.app).toBeDefined();
            expect(typeof server.start).toBe('function');
            expect(typeof server.stop).toBe('function');
        });

        it('should register health endpoint', async () => {
            const server = createServer(testConfig);
            const response = await server.app.inject({
                method: 'GET',
                url: '/health',
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.status).toBe('ok');
            expect(body.adapter).toBe('claude-adapter');
        });

        it('should register messages endpoint', async () => {
            const server = createServer(testConfig);
            const response = await server.app.inject({
                method: 'POST',
                url: '/v1/messages',
                payload: {},
            });

            expect(response.statusCode).toBe(400);
        });

        it('should not expose wildcard CORS', async () => {
            const server = createServer(testConfig);
            const response = await server.app.inject({ method: 'GET', url: '/health' });

            expect(response.headers['access-control-allow-origin']).toBeUndefined();
        });

        it('should enforce process-local bearer authentication when configured', async () => {
            const server = createServer({ ...testConfig, localAuthToken: 'local-secret' });
            const unauthorized = await server.app.inject({
                method: 'POST',
                url: '/v1/messages',
                payload: {},
            });
            const authorized = await server.app.inject({
                method: 'POST',
                url: '/v1/messages',
                headers: { authorization: 'Bearer local-secret' },
                payload: {},
            });

            expect(unauthorized.statusCode).toBe(401);
            expect(authorized.statusCode).toBe(400);
        });

        it('should leave the health check available without credentials', async () => {
            const server = createServer({ ...testConfig, localAuthToken: 'local-secret' });
            const response = await server.app.inject({ method: 'GET', url: '/health' });

            expect(response.statusCode).toBe(200);
        });

        it('should bind only to loopback', async () => {
            const server = createServer(testConfig);
            const port = await findAvailablePort(0);
            try {
                const url = await server.start(port);
                const address = server.app.server.address();
                expect(url).toBe(`http://127.0.0.1:${port}`);
                expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
            } finally {
                await server.stop();
            }
        });
    });
});
