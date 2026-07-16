// Fastify proxy server setup
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { AdapterConfig } from '../types/config';
import { createMessagesHandler } from './handlers';
import { logger } from '../utils/logger';

export interface ProxyServer {
    app: FastifyInstance;
    start: (port: number) => Promise<string>;
    stop: (timeout?: number) => Promise<void>;
}

// Default graceful shutdown timeout in milliseconds
const DEFAULT_SHUTDOWN_TIMEOUT = 10000;

/**
 * Create the proxy server with configured routes
 */
export function createServer(config: AdapterConfig): ProxyServer {
    const app = Fastify({ logger: false });
    const isMakora = config.mode === 'makora';

    if (isMakora && !config.localAuthToken) {
        throw new Error('Makora mode requires a local authentication token');
    }

    if (isMakora) {
        app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
            if (request.routeOptions.url === '/health') return;
            const authorization = request.headers.authorization;
            const supplied = authorization?.startsWith('Bearer ')
                ? authorization.slice('Bearer '.length)
                : request.headers['x-api-key'];
            const expected = Buffer.from(config.localAuthToken!);
            const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                return reply.code(401).send({
                    error: {
                        type: 'authentication_error',
                        message: 'Invalid local proxy authentication token',
                    },
                });
            }
        });
    } else {
        app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version, x-api-key');

            if (request.method === 'OPTIONS') {
                return reply.code(200).send();
            }
        });
    }

    // Health check endpoint
    app.get('/health', async (_request: FastifyRequest, _reply: FastifyReply) => {
        return { status: 'ok', adapter: 'claude-adapter' };
    });

    // Main messages endpoint (matches Anthropic API)
    app.post('/v1/messages', createMessagesHandler(config));

    return {
        app,
        start: async (port: number): Promise<string> => {
            try {
                const address = await app.listen({ port, host: isMakora ? '127.0.0.1' : '0.0.0.0' });
                if (isMakora) return address;
                const boundAddress = app.server.address();
                const actualPort = typeof boundAddress === 'object' && boundAddress ? boundAddress.port : port;
                return `http://localhost:${actualPort}`;
            } catch (err: any) {
                if (err.code === 'EADDRINUSE') {
                    throw new Error(`Port ${port} is already in use. Try a different port.`);
                }
                throw err;
            }
        },
        stop: async (timeout: number = DEFAULT_SHUTDOWN_TIMEOUT): Promise<void> => {

            let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
            const forceShutdown = new Promise<void>((resolve) => {
                timeoutHandle = setTimeout(() => {
                    logger.warn('Graceful shutdown timeout exceeded, closing active connections');
                    app.server.closeAllConnections?.();
                    resolve();
                }, timeout);
            });

            try {
                await Promise.race([app.close(), forceShutdown]);
            } finally {
                if (timeoutHandle) clearTimeout(timeoutHandle);
            }
        },
    };
}

/**
 * Find an available port starting from the preferred port
 */
export async function findAvailablePort(preferredPort: number): Promise<number> {
    const net = await import('net');

    return new Promise((resolve) => {
        const server = net.createServer();

        server.listen(preferredPort, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : preferredPort;
            server.close(() => resolve(port));
        });

        server.on('error', () => {
            // Port is in use, try next port
            resolve(findAvailablePort(preferredPort + 1));
        });
    });
}
