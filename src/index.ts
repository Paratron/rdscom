import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

type MessageHandler = (message: string, traceId: string) => Promise<void>;
type RPCHandler = (message: string, traceId: string) => Promise<string>;
type MessageBrokerOptions = {
  logger?: {
    warn: (message: string, meta?: Record<string, unknown>) => void,
    error: (message: string, meta?: Record<string, unknown>) => void
  }
};
export type MalformedMessageHandler = (error: Error, message: string) => Promise<void>;
export type RPCErrorHandler = (error: Error, message: string, traceId: string) => Promise<void>;
type WorkerStats = { activeWorkers: number; worklimit: number };

interface TracedMessage {
  traceId: string;
  payload: string;
}

const createMessageBroker = (redisClient: Redis, options?: MessageBrokerOptions) => {
  const logger = options?.logger ?? console;

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
    const shutdownSignal = `${channelName}:trm`;

    const processMessage = async () => {
      if (!isRunning || (activeWorkers >= worklimit && worklimit !== 0)) {
        return;
      }

      activeWorkers++;
      try {
        const [resultChannel, message] = await redisClient.blpop(channelName, shutdownSignal, 0) as [string, string];
        if (resultChannel === shutdownSignal) {
          return;
        }

        let tracedMessage: TracedMessage;
        try {
          tracedMessage = JSON.parse(message);
        } catch (error) {
          logger.warn('Received malformed message:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            channel: channelName,
            message
          });

          if (errorHandler) {
            await errorHandler(
              new Error(`Malformed message received: ${error instanceof Error ? error.message : 'Unknown error'}`),
              message
            );
          }
          return;
        }

        await handler(tracedMessage.payload, tracedMessage.traceId);
      }
      catch (error: any) {
        logger.error('Redis operation failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          channel: channelName
        });

        isRunning = false;
        activeWorkers = 0;
      }
      finally {
        activeWorkers && activeWorkers--;
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

  const sendAndWaitForResponse = async (channelName: string, message: any, traceId?: string): Promise<string> => {
    const rpcId = uuidv4();
    const responseChannel = `rpc:${rpcId}`;
    const tracedMessage: TracedMessage = {
      traceId: traceId || uuidv4(),
      payload: JSON.stringify({ rpcId, message, responseChannel })
    };

    try {
      await redisClient.rpush(channelName, JSON.stringify(tracedMessage));

      const result = await redisClient.blpop(responseChannel, 30);
      if (result === null) {
        throw new Error('RPC timeout: No response received within 30 seconds');
      }
      const [, response] = result;

      try {
        await redisClient.del(responseChannel);
      } catch (cleanupError) {
        console.warn('Failed to clean up RPC response channel:', cleanupError);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes('RPC timeout')) {
        throw error; // Re-throw timeout errors as-is
      }
      throw new Error(`RPC operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
          const { message, responseChannel } = JSON.parse(messageStr);
          const result = await handler(message, traceId);
          try {
            await redisClient.rpush(responseChannel, result);
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
          logger.warn('Received malformed RPC message:', {
            error: error.message,
            message,
            channel: channelName
          });
        } :
        undefined,
      initialWorklimit
    );
  };

  return { send, sendAndWaitForResponse, listen, listenAndRespond };
};

export { createMessageBroker, MessageHandler, RPCHandler, WorkerStats };