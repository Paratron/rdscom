import { Redis } from 'ioredis';
import { createMessageBroker, MessageHandler, ErrorHandler, RPCHandler } from '../src/index';

// Mock ioredis
jest.mock('ioredis', () => {
    const mRedis = {
        rpush: jest.fn().mockResolvedValue(1),
        blpop: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
    };
    return {
        Redis: jest.fn(() => mRedis),
    };
});

describe('rdscom', () => {
  let redisClient: jest.Mocked<Redis>;
  let messageBroker: ReturnType<typeof createMessageBroker>;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient = new Redis() as jest.Mocked<Redis>;
    redisClient.rpush.mockResolvedValue(1);
    redisClient.blpop.mockResolvedValue(null);
    redisClient.del.mockResolvedValue(1);
    messageBroker = createMessageBroker(redisClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('send', () => {
    it('should send a message to the specified channel', async () => {
      await messageBroker.send('test-channel', 'Hello, World!');

      expect(redisClient.rpush).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining('"payload":"Hello, World!"')
      );
    });

    it('should handle Redis errors during send', async () => {
      const error = new Error('Redis connection lost');
      redisClient.rpush.mockRejectedValueOnce(error);

      await expect(messageBroker.send('test-channel', 'Hello, World!'))
        .rejects
        .toThrow('Failed to send message to Redis: Redis connection lost');
    });

    it('should include traceId if provided', async () => {
      const traceId = 'test-trace-id';
      await messageBroker.send('test-channel', 'Hello, World!', traceId);

      expect(redisClient.rpush).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining(`"traceId":"${traceId}"`)
      );
    });
  });

  describe('listen', () => {
    it('should handle Redis errors during message processing', async () => {
      const handler: MessageHandler = jest.fn();
      const errorHandler: ErrorHandler = jest.fn();
      const error = new Error('Redis connection lost');
      
      redisClient.blpop
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(['test-channel', JSON.stringify({ traceId: 'test-trace', payload: 'test-message' })]);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      // Wait for the error to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Redis operation failed: Redis connection lost') }),
        'Error processing message',
        expect.any(String)
      );

      await worker.stop();
    });

    it('should handle malformed messages', async () => {
      const handler: MessageHandler = jest.fn();
      const errorHandler: ErrorHandler = jest.fn();
      
      redisClient.blpop.mockResolvedValueOnce(['test-channel', 'invalid-json']);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Failed to parse message') }),
        'invalid-json',
        expect.any(String)
      );

      await worker.stop();
    });

    it('should handle errors during worker shutdown', async () => {
      const handler: MessageHandler = jest.fn();
      const errorHandler: ErrorHandler = jest.fn();
      const error = new Error('Redis connection lost');
      
      redisClient.rpush.mockRejectedValueOnce(error);
      redisClient.del.mockRejectedValueOnce(error);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);
      
      await expect(worker.stop()).rejects.toThrow('Failed to stop worker: Redis connection lost');
    });
  });

  describe('sendAndWaitForResponse', () => {
    beforeEach(() => {
      // Reset mock implementations specifically for this describe block
      redisClient.rpush.mockResolvedValue(1);
      redisClient.blpop.mockResolvedValue(null);
      redisClient.del.mockResolvedValue(1);
    });

    it('should handle timeout when no response is received', async () => {
      // Explicitly set the mock for this test
      redisClient.blpop.mockResolvedValueOnce(null);

      await expect(messageBroker.sendAndWaitForResponse('test-channel', 'test-message'))
        .rejects
        .toThrow('RPC timeout: No response received within 30 seconds');
    });

    it('should handle Redis errors during RPC', async () => {
      const error = new Error('Redis connection lost');
      // Explicitly set the mock for this test
      redisClient.rpush.mockRejectedValueOnce(error);

      await expect(messageBroker.sendAndWaitForResponse('test-channel', 'test-message'))
        .rejects
        .toThrow('RPC operation failed: Redis connection lost');
    });

    it('should handle cleanup failures gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const error = new Error('Cleanup failed');
      
      // Reset all mocks for this specific test
      redisClient.rpush.mockReset().mockResolvedValue(1);
      redisClient.blpop.mockReset().mockResolvedValue(['rpc:test', 'response']);
      redisClient.del.mockReset().mockRejectedValue(error);

      const response = await messageBroker.sendAndWaitForResponse('test-channel', 'test-message');
      
      expect(response).toBe('response');
      expect(consoleSpy).toHaveBeenCalledWith('Failed to clean up RPC response channel:', error);
      
      consoleSpy.mockRestore();
    });
  });

  describe('listenAndRespond', () => {
    it('should handle Redis errors in RPC response', async () => {
      const handler: RPCHandler = jest.fn().mockResolvedValue('response');
      const errorHandler: ErrorHandler = jest.fn();
      const error = new Error('Redis connection lost');

      redisClient.blpop.mockResolvedValueOnce(['test-channel', JSON.stringify({
        traceId: 'test-trace',
        payload: JSON.stringify({ rpcId: 'test-rpc', message: 'test-message', responseChannel: 'rpc:test' })
      })]);
      redisClient.rpush.mockRejectedValueOnce(error);

      const worker = messageBroker.listenAndRespond('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Failed to send RPC response') }),
        expect.any(String),
        'test-trace'
      );

      await worker.stop();
    });

    it('should handle malformed RPC messages', async () => {
      const handler: RPCHandler = jest.fn();
      const errorHandler: ErrorHandler = jest.fn();

      redisClient.blpop.mockResolvedValueOnce(['test-channel', JSON.stringify({
        traceId: 'test-trace',
        payload: 'invalid-json'
      })]);

      const worker = messageBroker.listenAndRespond('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(String),
        'test-trace'
      );

      await worker.stop();
    });
  });
});