import { RedisOptions } from 'ioredis';

declare module 'rdscom' {
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
   * @returns A promise that resolves with the response message.
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
     * @param ttlSeconds - Optional timeout in seconds (default: 30).
     * @returns A promise that resolves with the response message.
     */
    sendAndWaitForResponse: (
      channelName: string,
      message: string,
      traceId?: string,
      ttlSeconds?: number
    ) => Promise<string>;

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

    /**
     * Bind an event listener.
     * @param event - The event name to listen for.
     * @param listener - The callback function to execute when the event occurs.
     */
    on: (event: string, listener: (...args: any[]) => void) => void;

    /**
     * Bind a one-time event listener.
     * @param event - The event name to listen for.
     * @param listener - The callback function to execute when the event occurs.
     */
    once: (event: string, listener: (...args: any[]) => void) => void;

    /**
     * Remove an event listener.
     * @param event - The event name.
     * @param listener - The listener function to remove.
     */
    off: (event: string, listener: (...args: any[]) => void) => void;

    /**
     * Stops the message broker and cleans up resources.
     * @returns A promise that resolves when cleanup is complete.
     */
    stop: () => Promise<void>;
  }

  /**
   * Custom logger interface.
   */
  export interface Logger {
    /**
     * Log a warning message.
     * @param args - Arguments to log.
     */
    warn: (...args: any[]) => void;

    /**
     * Log an error message.
     * @param args - Arguments to log.
     */
    error: (...args: any[]) => void;
  }

  /**
   * Options for creating a message broker.
   */
  export interface MessageBrokerOptions {
    /**
     * Optional custom logger. Defaults to console if not provided.
     */
    logger?: Logger;
  }

  /**
   * Creates a new message broker instance.
   * @param redisConfig - Redis configuration options.
   * @param options - Optional message broker options.
   * @returns A message broker instance.
   */
  export function createMessageBroker(
    redisConfig: RedisOptions,
    options?: MessageBrokerOptions
  ): MessageBroker;
}