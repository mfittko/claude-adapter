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
const makoraConfig: AdapterConfig = {
    ...testConfig,
    mode: 'makora',
    localAuthToken: 'local-secret',
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

        it('should preserve wildcard CORS and OPTIONS handling in generic mode', async () => {
            const server = createServer(testConfig);
            const getResponse = await server.app.inject({ method: 'GET', url: '/health' });
            const optionsResponse = await server.app.inject({ method: 'OPTIONS', url: '/v1/messages' });

            expect(getResponse.headers['access-control-allow-origin']).toBe('*');
            expect(optionsResponse.statusCode).toBe(200);
            expect(optionsResponse.headers['access-control-allow-methods']).toContain('POST');
            expect(optionsResponse.headers['access-control-allow-headers']).toContain('Authorization');
        });

        it('should fail closed when Makora has no local authentication token', () => {
            expect(() => createServer({ ...testConfig, mode: 'makora' }))
                .toThrow('Makora mode requires a local authentication token');
        });

        it('should enforce process-local bearer authentication in Makora mode', async () => {
            const server = createServer(makoraConfig);
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
            expect(unauthorized.json()).toEqual({
                error: {
                    type: 'authentication_error',
                    message: 'Invalid local proxy authentication token',
                },
            });
            expect(authorized.statusCode).toBe(400);
        });

        it('should leave the Makora health check available without credentials or CORS', async () => {
            const server = createServer(makoraConfig);
            const response = await server.app.inject({ method: 'GET', url: '/health?ready=1' });

            expect(response.statusCode).toBe(200);
            expect(response.headers['access-control-allow-origin']).toBeUndefined();
        });

        it('should bind Makora only to loopback', async () => {
            const server = createServer(makoraConfig);
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

        it('should bind generic mode to all interfaces and return localhost with the actual port', async () => {
            const server = createServer(testConfig);
            try {
                const url = await server.start(0);
                const address = server.app.server.address();
                const actualPort = typeof address === 'object' && address?.port;
                expect(actualPort).toBeGreaterThan(0);
                expect(typeof address === 'object' && address?.address).toBe('0.0.0.0');
                expect(url).toBe(`http://localhost:${actualPort}`);
            } finally {
                await server.stop();
            }
        });
    });
});
