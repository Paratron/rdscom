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
    await redisClient.rpush(channelName, JSON.stringify(tracedMessage));
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
          const tracedMessage: TracedMessage = JSON.parse(message);
          await handler(tracedMessage.payload, tracedMessage.traceId);
        }
      } catch (error) {
        if (error instanceof Error) {
          await errorHandler(error, 'Error processing message', uuidv4());
        } else {
          await errorHandler(new Error('Unknown error'), 'Error processing message', uuidv4());
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

    start();

    const stop = async () => {
      isRunning = false;
      for (let i = 0; i < activeWorkers; i++) {
        await redisClient.rpush(shutdownSignal, 'STOP');
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

    return { start, stop, setWorklimit, getStats };
  };

  const sendAndWaitForResponse = async (channelName: string, message: any, traceId?: string): Promise<string> => {
    const rpcId = uuidv4();
    const responseChannel = `rpc:${rpcId}`;
    const tracedMessage: TracedMessage = {
      traceId: traceId || uuidv4(),
      payload: JSON.stringify({ rpcId, message, responseChannel })
    };
    
    await redisClient.rpush(channelName, JSON.stringify(tracedMessage));
    
    const result = await redisClient.blpop(responseChannel, 30);
    if (result === null) {
      throw new Error('No response received');
    }
    const [, response] = result;
    await redisClient.del(responseChannel);
    
    return response;
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
          await redisClient.rpush(responseChannel, result);
        } catch (error) {
          console.error('Error processing RPC message:', error);
        }
      },
      errorHandler,
      initialWorklimit
    );
  };

  return { send, sendAndWaitForResponse, listen, listenAndRespond };
};

export { createMessageBroker, MessageHandler, RPCHandler, ErrorHandler, WorkerStats };