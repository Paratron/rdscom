import { Redis } from 'ioredis';
import { createMessageBroker, MessageHandler, ErrorHandler, RPCHandler } from '../src/index';

// Mock ioredis
jest.mock('ioredis');

describe('rdscom', () => {
  let redisClient: jest.Mocked<Redis>;
  let messageBroker: ReturnType<typeof createMessageBroker>;

  beforeEach(() => {
    redisClient = new Redis() as jest.Mocked<Redis>;
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

    it('should include a traceId if provided', async () => {
      const traceId = 'test-trace-id';
      await messageBroker.send('test-channel', 'Hello, World!', traceId);

      expect(redisClient.rpush).toHaveBeenCalledWith(
        'test-channel',
        expect.stringContaining(`"traceId":"${traceId}"`)
      );
    });
  });

  describe('listen', () => {
    it('should start listening on the specified channel', async () => {
      const handler: MessageHandler = jest.fn();
      const errorHandler: ErrorHandler = jest.fn();

      redisClient.blpop.mockResolvedValueOnce(['test-channel', JSON.stringify({ traceId: 'test-trace', payload: 'test-message' })]);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(redisClient.blpop).toHaveBeenCalledWith('test-channel', 'test-channel:shutdown', 0);
      expect(handler).toHaveBeenCalledWith('test-message', 'test-trace');

      await worker.stop();
    });

    it('should handle errors', async () => {
      const handler: MessageHandler = jest.fn(() => { throw new Error('Test error'); });
      const errorHandler: ErrorHandler = jest.fn();

      redisClient.blpop.mockResolvedValueOnce(['test-channel', JSON.stringify({ traceId: 'test-trace', payload: 'test-message' })]);

      const worker = messageBroker.listen('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error), expect.any(String), expect.any(String));

      await worker.stop();
    });
  });

  describe('sendAndWaitForResponse', () => {
    it('should send a message and wait for a response', async () => {
      const responseMessage = 'Response message';
      redisClient.rpush.mockResolvedValueOnce(1);
      redisClient.blpop.mockResolvedValueOnce(['rpc:test-id', responseMessage]);

      const response = await messageBroker.sendAndWaitForResponse('test-channel', 'Test message');

      expect(redisClient.rpush).toHaveBeenCalledWith('test-channel', expect.any(String));
      expect(redisClient.blpop).toHaveBeenCalledWith(expect.stringContaining('rpc:'), 30);
      expect(response).toBe(responseMessage);
    });
  });

  describe('listenAndRespond', () => {
    it('should listen for RPC requests and respond', async () => {
      const handler: RPCHandler = jest.fn().mockResolvedValue('Response');
      const errorHandler: ErrorHandler = jest.fn();

      redisClient.blpop.mockResolvedValueOnce(['test-channel', JSON.stringify({ 
        traceId: 'test-trace', 
        payload: JSON.stringify({ rpcId: 'test-rpc', message: 'Test message', responseChannel: 'rpc:test-rpc' }) 
      })]);

      const worker = messageBroker.listenAndRespond('test-channel', handler, errorHandler);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith('Test message', 'test-trace');
      expect(redisClient.rpush).toHaveBeenCalledWith('rpc:test-rpc', 'Response');

      await worker.stop();
    });
  });
});