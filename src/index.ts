import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

type MessageHandler = (message: string, traceId: string) => Promise<void>;
type RPCHandler = (message: string, traceId: string) => Promise<string>;
type ErrorHandler = (error: Error, message: string, traceId: string) => Promise<void>;
type WorkerStats = { activeWorkers: number; worklimit: number };

interface TracedMessage {
  traceId: string;
  payload: string;
}

const createMessageBroker = (redisClient: Redis) => {
  const send = async (channelName: string, message: string, traceId?: string): Promise<void> => {
    const tracedMessage: TracedMessage = {
      traceId: traceId || uuidv4(),
      payload: message
    };
    try {
      await redisClient.rpush(channelName, JSON.stringify(tracedMessage));
    } catch (error) {
      throw new Error(`Failed to send message to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const listen = (
    channelName: string, 
    handler: MessageHandler, 
    errorHandler: ErrorHandler,
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
        const result = await redisClient.blpop(channelName, shutdownSignal, 0);
        if (result) {
          const [resultChannel, message] = result;
          if (resultChannel === shutdownSignal) {
            return;
          }
          try {
            const tracedMessage: TracedMessage = JSON.parse(message);
            await handler(tracedMessage.payload, tracedMessage.traceId);
          } catch (parseError) {
            await errorHandler(
              new Error(`Failed to parse message: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`),
              message,
              uuidv4()
            );
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          await errorHandler(
            new Error(`Redis operation failed: ${error.message}`),
            'Error processing message',
            uuidv4()
          );
        } else {
          await errorHandler(
            new Error('Unknown Redis error occurred'),
            'Error processing message',
            uuidv4()
          );
        }
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
      try {
        for (let i = 0; i < activeWorkers; i++) {
          await redisClient.rpush(shutdownSignal, 'STOP');
        }
        while (activeWorkers > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await redisClient.del(shutdownSignal);
      } catch (error) {
        throw new Error(`Failed to stop worker: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
    errorHandler: ErrorHandler,
    initialWorklimit: number = 1
  ) => {
    return listen(
      channelName,
      async (messageStr: string, traceId: string) => {
        try {
          const { rpcId, message, responseChannel } = JSON.parse(messageStr);
          const result = await handler(message, traceId);
          try {
            await redisClient.rpush(responseChannel, result);
          } catch (error) {
            throw new Error(`Failed to send RPC response: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        } catch (error) {
          await errorHandler(
            error instanceof Error ? error : new Error('Unknown error in RPC handler'),
            messageStr,
            traceId
          );
        }
      },
      errorHandler,
      initialWorklimit
    );
  };

  return { send, sendAndWaitForResponse, listen, listenAndRespond };
};

export { createMessageBroker, MessageHandler, RPCHandler, ErrorHandler, WorkerStats };