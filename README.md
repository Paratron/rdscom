# rdscom

A lightweight and efficient TypeScript library for message queuing and RPC (Remote Procedure Call) using Redis. This library provides a simple interface for message passing and remote procedure calls while letting you manage Redis connections according to your application's needs.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Redis Connection Management](#redis-connection-management)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

## Overview

rdscom helps you implement two common messaging patterns:

1. **Message Queuing**: Send messages between different parts of your application or between different applications, with messages being processed by one or more workers.

2. **RPC (Remote Procedure Call)**: Make a request to another service and wait for a response, enabling asynchronous request-response patterns across services.

## Installation

Install rdscom and its peer dependency:

```bash
npm install rdscom ioredis
```

## Core Concepts

### Message Queuing

Message queuing allows different parts of your system to communicate asynchronously. Messages are delivered with very low latency when receivers are actively listening, while also being persisted in Redis until a receiver processes them.

Key characteristics:
- Near real-time delivery when receivers are active
- Messages are stored in Redis until successfully processed
- Messages accumulate when no receivers are listening
- First-in-first-out (FIFO) processing within each channel

Common use cases include:
- Processing background jobs
- Distributing work across multiple services
- Decoupling components of your application
- Handling high-throughput operations
- Implementing resilient service communication

Example: A web service that needs to process uploaded images might send a message to a worker service that handles the image processing, allowing the web service to quickly respond to the user while the processing happens in the background.

Note: Since messages persist until processed, consider implementing message expiry or cleanup strategies for scenarios where old messages become irrelevant. You might want to:
- Monitor queue lengths
- Implement periodic cleanup of old messages
- Set up alerts for queue size thresholds
- Consider using Redis's built-in key expiration for certain channels

### Remote Procedure Call (RPC)

RPC in rdscom implements an asynchronous request-response pattern that's useful when you need to:
- Make a request and handle the response later
- Call functions in other services without blocking
- Implement asynchronous request-response patterns across services
- Maintain loose coupling while getting responses from other services

Example: A service needs to validate user credentials against an authentication service before proceeding.

## Advanced Usage

### Distributed Tracing

rdscom includes built-in support for distributed tracing through `traceId`s:

```typescript
// Sending with trace ID
await broker.send(
  'user-service', 
  JSON.stringify({ action: 'create' }),
  'request-123'  // optional traceId
);

// Receiving with trace ID
const worker = broker.listen(
  'user-service',
  async (message, traceId) => {
    console.log(`Processing ${traceId}:`, message);
  },
  async (error, message, traceId) => {
    console.error(`Error for ${traceId}:`, error);
  }
);

// RPC with trace ID
const rpcWorker = broker.listenAndRespond(
  'auth-service',
  async (message, traceId) => {
    console.log(`RPC request ${traceId}`);
    return 'response';
  },
  async (error, message, traceId) => {
    console.error(`RPC error ${traceId}:`, error);
  }
);
```

TraceIds can be used to:
- Link messages to their handlers across services
- Track request-response pairs in RPC calls
- Correlate logs across your system
- Integrate with existing tracing systems (e.g., OpenTelemetry)

If not provided, rdscom automatically generates traceIds using UUID v4.

## Redis Connection Management

rdscom does NOT manage Redis connections - this is intentional and gives you full control over:
- Connection configuration
- Error handling
- Connection pooling
- Reconnection strategies

You are responsible for:
1. Creating and configuring the Redis client
2. Handling connection errors
3. Proper cleanup when shutting down

Example of proper Redis connection management:

```typescript
import { Redis } from 'ioredis';
import { createMessageBroker } from 'rdscom';

// Create and configure Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Handle Redis connection events
redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

// Create message broker
const broker = createMessageBroker(redis);

// Cleanup on application shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
});
```

## Basic Usage

### Sending Messages

```typescript
// Simple message sending
await broker.send('user-service', JSON.stringify({ 
  action: 'create',
  data: { name: 'John Doe' }
}));
```

### Receiving Messages

```typescript
// Start a worker to process messages
const worker = broker.listen(
  'user-service',
  async (message) => {
    const data = JSON.parse(message);
    console.log('Processing message:', data);
    // Process the message...
  },
  async (error, message) => {
    console.error('Error processing message:', error);
    // Handle the error...
  }
);

// Later, stop the worker gracefully
await worker.stop();
```

### Using RPC

```typescript
// RPC Server (responder)
const rpcWorker = broker.listenAndRespond(
  'auth-service',
  async (message) => {
    const { username, password } = JSON.parse(message);
    // Validate credentials...
    return JSON.stringify({ valid: true });
  },
  async (error, message) => {
    console.error('RPC error:', error);
  }
);

// RPC Client (caller)
try {
  const response = await broker.sendAndWaitForResponse(
    'auth-service',
    JSON.stringify({ username: 'user', password: 'pass' })
  );
  const result = JSON.parse(response);
  console.log('Auth result:', result);
} catch (error) {
  if (error.message.includes('timeout')) {
    console.error('Auth service did not respond in time');
  } else {
    console.error('Auth request failed:', error);
  }
}
```

## Advanced Usage

### Message Processing Behavior

**Single Listener:**
```typescript
// With default worklimit of 1:
const worker = broker.listen(
  'channel',
  async (msg, traceId) => {
    // This handler processes one message at a time
    // Next message won't start until this one finishes
    await processMessage(msg);
  },
  async (err, msg, traceId) => { /* ... */ }
);
```

The default behavior (worklimit=1) processes messages sequentially:
- Messages are processed one at a time in FIFO order
- Next message won't start processing until current one completes
- This happens even if many messages arrive simultaneously
- It's not like an event emitter that fires multiple callbacks
- Ensures orderly, sequential processing by default

**Multiple Listeners:**
```typescript
// In Service A:
const worker1 = broker.listen('channel', handler1, errorHandler);

// In Service B:
const worker2 = broker.listen('channel', handler2, errorHandler);
```

When multiple services or processes listen to the same channel:
- Messages are automatically distributed among all listeners
- Each message is processed by exactly one listener
- Redis handles the distribution automatically
- Great for load balancing and scaling horizontally
- Order of processing may vary across listeners

**Worker Limits:**
- Default limit is 1 worker (single-threaded processing)
- Setting limit to 0 means unlimited concurrent processing
- The limit controls how many messages can be processed simultaneously
- Existing processing is never interrupted when reducing the limit

```typescript
// Start with default (1 worker)
const worker = broker.listen(
  'channel',
  async (msg, traceId) => { /* ... */ },
  async (err, msg, traceId) => { /* ... */ }
);

// Start with custom worker limit
const multiWorker = broker.listen(
  'channel',
  async (msg, traceId) => { /* ... */ },
  async (err, msg, traceId) => { /* ... */ },
  5  // 5 concurrent workers
);

// Adjust limits dynamically
worker.setWorklimit(10);  // Scale up to 10 workers
worker.setWorklimit(0);   // No limit on concurrent processing

// Monitor current state
const stats = worker.getStats();
console.log(`Active/Total workers: ${stats.activeWorkers}/${stats.worklimit}`);
```

**How Workers Process Messages:**
- A worker is considered "busy" while its message handler (the async callback) is running
- Only after the handler resolves will the worker pick up the next message
- The worklimit controls how many messages can be processed simultaneously
- Setting a worklimit of 0 means unlimited concurrent processing

**When to Adjust Limits:**
- Increase for CPU-bound tasks that benefit from parallelism
- Increase for I/O-bound tasks to handle concurrent operations
- Reduce if you're overwhelming downstream services
- Set to 1 for tasks that must be processed sequentially
- Monitor system resources and adjust accordingly

**Best Practices:**
- Start with the default (1) and increase based on needs
- Monitor `activeWorkers` to understand your workload
- Consider Redis connection limits when setting high worker counts
- Remember each worker holds a message in memory while processing



## Error Handling

rdscom provides multiple layers of error handling:

1. **Redis Operation Errors**: Errors from Redis operations (connection issues, etc.)
2. **Message Processing Errors**: Errors in your message handlers
3. **RPC Timeouts**: When RPC responses aren't received in time (default 30 seconds)

Example of comprehensive error handling:

```typescript
// Message processing with retries
const worker = broker.listen(
  'important-channel',
  async (message, traceId) => {
    try {
      await processWithRetries(message);
    } catch (error) {
      // After retries exhausted
      await moveToDeadLetter(message, error);
      throw error; // Will be caught by error handler
    }
  },
  async (error, message, traceId) => {
    await logError({
      error,
      message,
      traceId,
      channel: 'important-channel'
    });
  }
);
```

## API Reference

### createMessageBroker(redisClient: Redis): MessageBroker
Creates a new message broker instance.
- `redisClient`: An ioredis client instance

### MessageBroker

#### send(channelName: string, message: string, traceId?: string): Promise<void>
Sends a message to a channel.
- `channelName`: The channel to send to
- `message`: The message content
- `traceId`: Optional trace ID for tracking

#### listen(channelName: string, handler: MessageHandler, errorHandler: ErrorHandler, initialWorklimit?: number): Worker
Starts listening for messages on a channel.
- `channelName`: The channel to listen on
- `handler`: Function called for each message
- `errorHandler`: Function called when errors occur
- `initialWorklimit`: Optional worker limit (default: 1)
- Returns a Worker instance

#### sendAndWaitForResponse(channelName: string, message: any, traceId?: string): Promise<string>
Sends a message and waits for a response (RPC).
- `channelName`: The channel to send to
- `message`: The request message
- `traceId`: Optional trace ID
- Returns a promise that resolves with the response
- Times out after 30 seconds by default

#### listenAndRespond(channelName: string, handler: RPCHandler, errorHandler: ErrorHandler, initialWorklimit?: number): Worker
Sets up an RPC responder.
- `channelName`: The channel to listen on
- `handler`: Function to process requests and return responses
- `errorHandler`: Function called when errors occur
- `initialWorklimit`: Optional worker limit (default: 1)
- Returns a Worker instance

### Worker

#### start(): void
Starts the worker if it was previously stopped.

#### stop(): Promise<void>
Gracefully stops the worker.

#### setWorklimit(newLimit: number): void
Changes the worker concurrency limit.
- `newLimit`: New maximum number of concurrent workers (0 for unlimited)

#### getStats(): WorkerStats
Returns current worker statistics.
- Returns: `{ activeWorkers: number, worklimit: number }`

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

MIT License