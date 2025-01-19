import { createMessageBroker, MessageHandler, MalformedMessageHandler, RPCHandler, RPCErrorHandler } from '../src/index';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Redis from 'ioredis';

const rpush = vi.fn();
const blpop = vi.fn();
const del = vi.fn();
const quit = vi.fn();
const on = vi.fn();

// Mock ioredis
vi.mock('ioredis', () => {
  // Mock implementation of the Redis class
  const mockRedis = vi.fn(() => ({
    rpush,
    blpop,
    del,
    quit,
    on
  }));

  return {
    __esModule: true,
    default: mockRedis,
    Redis: mockRedis,
  };
});

describe('rdscom', () => {
  let messageBroker: ReturnType<typeof createMessageBroker>;
  let mockLogger: { warn: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      warn: vi.fn(),
      error: vi.fn()
    };

    messageBroker = createMessageBroker({
      host: 'localhost',
      port: 6379
    }, { logger: mockLogger });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send a message to the specified channel', async () => {
      await messageBroker.send('test-channel', 'Hello, World!');

      expect(rpush).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining('"payload":"Hello, World!"')
      );
    });

    it('should handle Redis errors during send', async () => {
      const error = new Error('Redis connection lost');
      rpush.mockRejectedValueOnce(error);

      await expect(messageBroker.send('test-channel', 'Hello, World!'))
        .rejects
        .toThrow(error);
    });

    it('should include traceId if provided', async () => {
      const traceId = 'test-trace-id';
      await messageBroker.send('test-channel', 'Hello, World!', traceId);

      expect(rpush).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining(`"traceId":"${traceId}"`)
      );
    });
  });

  describe('listen', () => {
    // it('should log Redis error and stop workers when Redis fails', async () => {
    //   const handler: MessageHandler = vi.fn();
    //   const e = new Error('Redis connection lost');
    //   blpop.mockRejectedValueOnce(e);

    //   const worker = messageBroker.listen('test-channel', handler);

    //   vi.advanceTimersByTime(100);
    //   await Promise.resolve();

    //   expect(mockLogger.error).toHaveBeenCalledWith(
    //     'Redis operation failed:',
    //     expect.objectContaining({
    //       error: 'Redis connection lost',
    //       channel: 'test-channel'
    //     })
    //   );

    //   const stats = worker.getStats();
    //   expect(stats.activeWorkers).toBe(0);
    // });

    it('should handle malformed messages', async () => {
      const handler: MessageHandler = vi.fn();
      const errorHandler: MalformedMessageHandler = vi.fn();
      
      blpop.mockResolvedValueOnce(['test-channel', 'invalid-json']);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      vi.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Received malformed message:',
        expect.any(Error),
        'invalid-json'
      );

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Malformed message received') }),
        'invalid-json'
      );

      await worker.stop();
    });

    it('should track worker stats correctly', async () => {
      const handler: MessageHandler = vi.fn();
      const worker = messageBroker.listen('test-channel', handler);

      const initialStats = worker.getStats();
      expect(initialStats.worklimit).toBe(1);
      expect(initialStats.activeWorkers).toBeGreaterThanOrEqual(0);

      worker.setWorklimit(5);
      expect(worker.getStats().worklimit).toBe(5);

      await worker.stop();
      worker.start();

      expect(rpush).toHaveBeenCalledWith('test-channel:trm', '1');
    });
  });

  describe('RPC communication', () => {
    it('should handle successful RPC communication', async () => {
      const responseData = { rpcId: 'test-id', message: 'response-data' };

      blpop.mockImplementationOnce(async () => {
        return ['rpc:backchannel:test', JSON.stringify(responseData)];
      });

      const responsePromise = messageBroker.sendAndWaitForResponse('test-channel', 'test-message');

      vi.advanceTimersByTime(100);
      const response = await responsePromise;

      expect(response).toBe('response-data');
    });

    it('should timeout when no response is received', async () => {
      const responsePromise = messageBroker.sendAndWaitForResponse('test-channel', 'test-message');

      vi.advanceTimersByTime(31000);
      await expect(responsePromise).rejects.toThrow('RPC timeout');
    });

    it('should handle RPC response processing', async () => {
      const handler: RPCHandler = vi.fn().mockResolvedValue('response');
      const mockRedisInstance = MockRedis.mock.instances[1];

      const messageData = {
        traceId: 'test-trace',
        payload: JSON.stringify({
          rpcId: 'test-rpc',
          message: 'test-message',
          responseChannel: 'rpc:backchannel:test'
        })
      };

      mockRedisInstance.blpop.mockResolvedValueOnce([
        'test-channel',
        JSON.stringify(messageData)
      ]);

      const worker = messageBroker.listenAndRespond('test-channel', handler);

      await Promise.resolve();
      vi.runAllTimers();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith('test-message', 'test-trace');
      expect(mockRedisInstance.rpush).toHaveBeenCalledWith(
        'rpc:backchannel:test',
        expect.stringContaining('response')
      );

      await worker.stop();
    });
  });
});