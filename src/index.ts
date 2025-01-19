import { Redis, RedisOptions } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

type MessageHandler = (message: string, traceId: string) => Promise<void>;
type RPCHandler = (message: string, traceId: string) => Promise<string>;
type MessageBrokerOptions = {
  logger?: {
    warn: (...args: any[]) => void,
    error: (...args: any[]) => void
  }
};

export type MalformedMessageHandler = (error: Error, message: string) => Promise<void>;
export type RPCErrorHandler = (error: Error, message: string, traceId: string) => Promise<void>;
type WorkerStats = { activeWorkers: number; worklimit: number };

interface TracedMessage {
  traceId: string;
  payload: string;
}

const createMessageBroker = (redisConfig: RedisOptions, options?: MessageBrokerOptions) => {
  const brokerId = uuidv4();
  const logger = options?.logger ?? console;
  const events = new EventEmitter();

  // Create main Redis client
  const redisClient = new Redis(redisConfig);

  // Set up event handling for main client
  redisClient.on('error', (error) => events.emit('error', error));
  redisClient.on('connect', () => events.emit('connect'));
  redisClient.on('reconnecting', () => events.emit('reconnecting'));
  redisClient.on('ready', () => events.emit('ready'));
  redisClient.on('end', () => events.emit('end'));

  const send = async (channelName: string, message: string, traceId?: string): Promise<void> => {
    const tracedMessage: TracedMessage = {
      traceId: traceId || uuidv4(),
      payload: message
    };
    await redisClient.rpush(channelName, JSON.stringify(tracedMessage));
  };

  const listen = (
    channelName: string,
    handler: MessageHandler,
    errorHandler?: MalformedMessageHandler,
    initialWorklimit: number = 1
  ) => {
    let worklimit = initialWorklimit;
    let activeWorkers = 0;
    let isRunning = false;

    const channelClient = new Redis(redisConfig);
    const shutdownSignal = `${channelName}:trm`;

    // Set up event handling for channel client
    channelClient.on('error', (error) => events.emit('error', error, channelName));
    channelClient.on('ready', () => events.emit('ready', channelName));

    const processMessage = async () => {
      if (!isRunning || (activeWorkers >= worklimit && worklimit !== 0)) {
        return;
      }

      activeWorkers++;
      try {
        const [resultChannel, message] = await channelClient.blpop(
          channelName,
          shutdownSignal,
          0
        ) as [string, string];

        if (resultChannel === shutdownSignal) {
          return;
        }

        let tracedMessage: TracedMessage;
        try {
          tracedMessage = JSON.parse(message);
        } catch (error) {
          logger.warn('Received malformed message:', error, message);

          if (errorHandler) {
            await errorHandler(
              new Error(`Malformed message received: ${error instanceof Error ? error.message : 'Unknown error'}`),
              message
            );
          }
          return;
        }

        await handler(tracedMessage.payload, tracedMessage.traceId);
      } catch (error) {
        // Stop processing on connection error
        isRunning = false;
        activeWorkers--;
        await channelClient.quit();
        events.emit('error', error, channelName);
        return;
      } finally {
        activeWorkers--;
        if (isRunning) {
          setImmediate(processMessage);
        }
      }
    };

    const start = () => {
      if (!isRunning) {
        isRunning = true;
        for (let i = 0; i < worklimit; i++) {
          processMessage();
        }
      }
    };

    const stop = async () => {
      isRunning = false;
      for (let i = 0; i < activeWorkers; i++) {
        await redisClient.rpush(shutdownSignal, '1');
      }
      while (activeWorkers > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await redisClient.del(shutdownSignal);
      await channelClient.quit();
    };

    const setWorklimit = (newLimit: number) => {
      worklimit = newLimit;
      while (activeWorkers < worklimit && isRunning) {
        processMessage();
      }
    };

    const getStats = (): WorkerStats => ({ activeWorkers, worklimit });

    start();
    return { start, stop, setWorklimit, getStats };
  };

  let rpcResponseEmitter: EventEmitter | null = null;
  let rpcResponseListener: any;
  function getRPCResponseEmitter(): EventEmitter {
    if (rpcResponseEmitter) {
      return rpcResponseEmitter;
    }

    rpcResponseEmitter = new EventEmitter();
    const rpcRedisClient = new Redis(redisConfig);

    async function awaitResponses(){
      const responseChannel = `rpc:backchannel:${brokerId}`;
      const response = await rpcRedisClient.blpop(responseChannel, 0);
      const { rpcId, message } = JSON.parse(response![1]);
      rpcResponseEmitter!.emit(rpcId, message);
      awaitResponses();
    }

    awaitResponses();

    return rpcResponseEmitter;
  }

  const sendAndWaitForResponse = (channelName: string, message: any, traceId?: string, ttlSeconds = 30): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const rpcId = uuidv4();
      const responseChannel = `rpc:backchannel:${brokerId}`;
      const tracedMessage: TracedMessage = {
        traceId: traceId || uuidv4(),
        payload: JSON.stringify({ rpcId, message, responseChannel })
      };

      await redisClient.rpush(channelName, JSON.stringify(tracedMessage)); /*await redisClient
        .multi()
        .rpush(channelName, JSON.stringify(tracedMessage))
        .expire(channelName, ttlSeconds)
        .exec();*/

      const responseEmitter = getRPCResponseEmitter();

      function responseHandler(response: string) {
        clearTimeout(timeout);
        resolve(response);
      }

      responseEmitter.once(rpcId, responseHandler);

      const timeout = setTimeout(() => {
        responseEmitter.off(rpcId, responseHandler);
        throw new Error('RPC timeout: No response received within ' + ttlSeconds + ' seconds');
        reject();
      }, ttlSeconds * 1000);
    });
  };

  const listenAndRespond = (
    channelName: string,
    handler: RPCHandler,
    errorHandler?: RPCErrorHandler,
    initialWorklimit: number = 1
  ) => {
    return listen(
      channelName,
      async (messageStr: string, traceId: string) => {
        try {
          const { rpcId, message, responseChannel } = JSON.parse(messageStr);
          const result = await handler(message, traceId);
          try {
            await redisClient.rpush(responseChannel, JSON.stringify({ rpcId, message: result }));
          } catch (error) {
            throw new Error(`Failed to send RPC response: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        } catch (error) {
          if (errorHandler) {
            await errorHandler(
              error instanceof Error ? error : new Error('Unknown error in RPC handler'),
              messageStr,
              traceId
            );
          }
        }
      },
      errorHandler ?
        async (error, message) => {
          logger.warn('Received malformed RPC message:', error, message);
        } :
        undefined,
      initialWorklimit
    );
  };

  const stop = async () => {
    if (rpcResponseEmitter) {
      rpcResponseEmitter.removeAllListeners();
      rpcResponseEmitter = null;
      rpcResponseListener?.stop();
    }

    events.removeAllListeners();

    await redisClient.quit();
  };

  return {
    send,
    sendAndWaitForResponse,
    listen,
    listenAndRespond,
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
    stop
  };
};

export { createMessageBroker, MessageHandler, RPCHandler, WorkerStats };