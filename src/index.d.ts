import { Redis } from 'ioredis';

declare module 'rdscom' {
  export type MessageHandler = (message: string, traceId: string) => Promise<void>;
  export type ErrorHandler = (error: Error, message: string, traceId: string) => Promise<void>;
  export type RPCHandler = (message: string, traceId: string) => Promise<string>;

  export interface WorkerStats {
    activeWorkers: number;
    worklimit: number;
  }

  export interface Worker {
    start: () => void;
    stop: () => Promise<void>;
    setWorklimit: (newLimit: number) => void;
    getStats: () => WorkerStats;
  }

  export interface MessageBroker {
    send: (channelName: string, message: string, traceId?: string) => Promise<void>;
    listen: (
      channelName: string,
      handler: MessageHandler,
      errorHandler: ErrorHandler,
      initialWorklimit?: number
    ) => Worker;
    sendAndWaitForResponse: (channelName: string, message: any, traceId?: string) => Promise<string>;
    listenAndRespond: (
      channelName: string,
      handler: RPCHandler,
      errorHandler: ErrorHandler,
      initialWorklimit?: number
    ) => Worker;
  }

  export function createMessageBroker(redisClient: Redis): MessageBroker;
}