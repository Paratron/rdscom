import { createMessageBroker, MessageHandler, MalformedMessageHandler, RPCHandler, RPCErrorHandler } from '../src/index';

describe('rdscom', () => {
  let redisClient: {
    rpush: jest.Mock,
    blpop: jest.Mock,
    del: jest.Mock
  };
  let messageBroker: ReturnType<typeof createMessageBroker>;
  let mockLogger: { warn: jest.Mock, error: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    redisClient = {
      rpush: jest.fn().mockResolvedValue(1),
      blpop: jest.fn().mockImplementation((...args) => {
        const channelName = args[0];
        return Promise.resolve([channelName, 'test-value']);
      }),
      del: jest.fn().mockResolvedValue(1),
    };

    mockLogger = {
      warn: jest.fn(),
      error: jest.fn()
    };

    messageBroker = createMessageBroker(redisClient as any, { logger: mockLogger });
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
        .toThrow(error);
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
    it('should log Redis error and stop workers when Redis fails', async () => {
      const handler: MessageHandler = jest.fn();
      const e = new Error('Redis connection lost');

      redisClient.blpop.mockRejectedValueOnce(e);

      const worker = messageBroker.listen('test-channel', handler);

      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Redis operation failed:',
        expect.objectContaining({
          error: 'Redis connection lost',
          channel: 'test-channel'
        })
      );

      const stats = worker.getStats();
      expect(stats.activeWorkers).toBe(0);
    });

    it('should handle malformed messages', async () => {
      const handler: MessageHandler = jest.fn();
      const errorHandler: MalformedMessageHandler = jest.fn();

      redisClient.blpop.mockResolvedValueOnce(['test-channel', 'invalid-json']);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Received malformed message:',
        expect.objectContaining({
          error: expect.any(String),
          channel: 'test-channel',
          message: 'invalid-json'
        })
      );

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Malformed message received') }),
        'invalid-json'
      );

      await worker.stop();
    });

    it('should track worker stats correctly', async () => {
      const handler: MessageHandler = jest.fn();
      const worker = messageBroker.listen('test-channel', handler);

      const initialStats = worker.getStats();
      expect(initialStats.worklimit).toBe(1);
      expect(initialStats.activeWorkers).toBeGreaterThanOrEqual(0);

      worker.setWorklimit(5);
      expect(worker.getStats().worklimit).toBe(5);

      await worker.stop();
      worker.start();

      expect(redisClient.rpush).toHaveBeenCalledWith('test-channel:trm', '1');
    });
  });

  describe('sendAndWaitForResponse', () => {
    it('should handle timeout when no response is received', async () => {
      redisClient.blpop.mockResolvedValueOnce(null);

      const responsePromise = messageBroker.sendAndWaitForResponse('test-channel', 'test-message');

      jest.advanceTimersByTime(31000);
      await expect(responsePromise).rejects.toThrow('RPC timeout: No response received within 30 seconds');
    });

    it('should handle successful RPC communication', async () => {
      const responseMessage = 'response-data';
      redisClient.blpop.mockResolvedValueOnce(['rpc:test', responseMessage]);

      const response = await messageBroker.sendAndWaitForResponse('test-channel', 'test-message');

      expect(response).toBe(responseMessage);
      expect(redisClient.del).toHaveBeenCalled();
    });

    it('should handle cleanup failures gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const error = new Error('Cleanup failed');

      redisClient.blpop.mockResolvedValueOnce(['rpc:test', 'response']);
      redisClient.del.mockRejectedValueOnce(error);

      const response = await messageBroker.sendAndWaitForResponse('test-channel', 'test-message');

      expect(response).toBe('response');
      expect(consoleSpy).toHaveBeenCalledWith('Failed to clean up RPC response channel:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('listenAndRespond', () => {
    it('should handle RPC messages successfully', async () => {
      const handler: RPCHandler = jest.fn().mockResolvedValue('response');
      const messageData = {
        rpcId: 'test-rpc',
        message: 'test-message',
        responseChannel: 'rpc:test'
      };

      redisClient.blpop.mockResolvedValueOnce([
        'test-channel',
        JSON.stringify({
          traceId: 'test-trace',
          payload: JSON.stringify(messageData)
        })
      ]);

      const worker = messageBroker.listenAndRespond('test-channel', handler);

      // Flush initial worker setup
      await Promise.resolve();
      jest.runAllTimers();
      // Flush the blpop resolution
      await Promise.resolve();
      jest.runAllTimers();
      // Flush the handler execution
      await Promise.resolve();
      jest.runAllTimers();

      expect(handler).toHaveBeenCalledWith('test-message', 'test-trace');
      expect(redisClient.rpush).toHaveBeenCalledWith('rpc:test', 'response');

      await worker.stop();
    });

    it('should handle errors in RPC response sending', async () => {
      const handler: RPCHandler = jest.fn().mockResolvedValue('response');
      const errorHandler: RPCErrorHandler = jest.fn().mockResolvedValue(undefined);  // Mock the errorHandler as async
      const error = new Error('Redis connection lost');

      const messageData = {
        rpcId: 'test-rpc',
        message: 'test-message',
        responseChannel: 'rpc:test'
      };

      redisClient.blpop.mockResolvedValueOnce([
        'test-channel',
        JSON.stringify({
          traceId: 'test-trace',
          payload: JSON.stringify(messageData)
        })
      ]);
      redisClient.rpush.mockRejectedValueOnce(error);

      const worker = messageBroker.listenAndRespond('test-channel', handler, errorHandler);

      // Initial worker setup
      await Promise.resolve();
      jest.runAllTimers();
      // Message processing
      await Promise.resolve();
      jest.runAllTimers();
      // Handler execution
      await Promise.resolve();
      jest.runAllTimers();
      // Error handler execution
      await Promise.resolve();
      jest.runAllTimers();
      // Final promise resolution
      await Promise.resolve();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Failed to send RPC response') }),
        expect.any(String),
        'test-trace'
      );

      await worker.stop();
    });
  });
});