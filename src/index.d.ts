import { Redis } from 'ioredis';

declare module 'rdscom' {
  /**
   * Logger interface for custom logging.
   */
  export interface Logger {
    /**
     * Logs a warning message.
     * @param message - The warning message to log.
     * @param meta - Optional metadata to include with the log.
     */
    warn: (message: string, meta?: Record<string, unknown>) => void;
  }

  /**
   * Handler for processing messages.
   * @param message - The message to process.
   * @param traceId - The trace ID associated with the message.
   */
  export type MessageHandler = (message: string, traceId: string) => Promise<void>;

  /**
   * Handler for processing RPC messages.
   * @param message - The RPC message to process.
   * @param traceId - The trace ID associated with the message.
   */
  export type RPCHandler = (message: string, traceId: string) => Promise<string>;

  /**
   * Handler for malformed messages.
   * @param error - The error encountered while processing the message.
   * @param message - The malformed message.
   */
  export type MalformedMessageHandler = (error: Error, message: string) => Promise<void>;

  /**
   * Handler for RPC errors.
   * @param error - The error encountered while processing the RPC message.
   * @param message - The RPC message.
   * @param traceId - The trace ID associated with the message.
   */
  export type RPCErrorHandler = (error: Error, message: string, traceId: string) => Promise<void>;

  /**
   * Statistics for a worker.
   */
  export interface WorkerStats {
    /**
     * The number of active workers.
     */
    activeWorkers: number;

    /**
     * The work limit for the worker.
     */
    worklimit: number;
  }

  /**
   * Worker interface for managing message processing.
   */
  export interface Worker {
    /**
     * Starts the worker if it was previously stopped.
     */
    start: () => void;

    /**
     * Gracefully stops the worker.
     * @returns A promise that resolves when the worker has stopped.
     */
    stop: () => Promise<void>;

    /**
     * Changes the worker concurrency limit.
     * @param newLimit - The new concurrency limit.
     */
    setWorklimit: (newLimit: number) => void;

    /**
     * Returns current worker statistics.
     * @returns The current worker statistics.
     */
    getStats: () => WorkerStats;
  }

  /**
   * Message broker interface for sending and receiving messages.
   */
  export interface MessageBroker {
    /**
     * Sends a message to a channel.
     * @param channelName - The name of the channel.
     * @param message - The message to send.
     * @param traceId - Optional trace ID for the message.
     * @returns A promise that resolves when the message has been sent.
     */
    send: (channelName: string, message: string, traceId?: string) => Promise<void>;

    /**
     * Starts listening for messages on a channel.
     * @param channelName - The name of the channel.
     * @param handler - The handler to process messages.
     * @param errorHandler - Optional handler for malformed messages.
     * @param initialWorklimit - Optional initial concurrency limit.
     * @returns A worker instance for managing the listener.
     */
    listen: (
      channelName: string,
      handler: MessageHandler,
      errorHandler?: MalformedMessageHandler,
      initialWorklimit?: number
    ) => Worker;

    /**
     * Sends a message and waits for a response (RPC).
     * @param channelName - The name of the channel.
     * @param message - The message to send.
     * @param traceId - Optional trace ID for the message.
     * @returns A promise that resolves with the response message.
     */
    sendAndWaitForResponse: (channelName: string, message: any, traceId?: string) => Promise<string>;

    /**
     * Sets up an RPC responder.
     * @param channelName - The name of the channel.
     * @param handler - The handler to process RPC messages.
     * @param errorHandler - Optional handler for RPC errors.
     * @param initialWorklimit - Optional initial concurrency limit.
     * @returns A worker instance for managing the responder.
     */
    listenAndRespond: (
      channelName: string,
      handler: RPCHandler,
      errorHandler?: RPCErrorHandler,
      initialWorklimit?: number
    ) => Worker;
  }

  /**
   * Options for creating a message broker.
   */
  export interface MessageBrokerOptions {
    /**
     * Optional custom logger.
     */
    logger?: Logger;
  }

  /**
   * Creates a new message broker instance.
   * @param redisClient - An ioredis client instance.
   * @param options - Optional message broker options.
   * @returns A message broker instance.
   */
  export function createMessageBroker(redisClient: Redis, options?: MessageBrokerOptions): MessageBroker;
}