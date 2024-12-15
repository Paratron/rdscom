# rdscom

A lightweight and efficient TypeScript library for message queuing and RPC (Remote Procedure Call) using Redis.

## Table of Contents

- [rdscom](#rdscom)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Features](#features)
  - [Usage](#usage)
    - [Creating a Message Broker](#creating-a-message-broker)
    - [Error Handling](#error-handling)
    - [Sending Messages](#sending-messages)
    - [Receiving Messages](#receiving-messages)
    - [RPC (Remote Procedure Call)](#rpc-remote-procedure-call)
  - [API Reference](#api-reference)
  - [Advanced Usage](#advanced-usage)
    - [Adjusting Worker Limit](#adjusting-worker-limit)
    - [Retrieving Worker Statistics](#retrieving-worker-statistics)
    - [Error Handling Best Practices](#error-handling-best-practices)
  - [Contributing](#contributing)
  - [License](#license)

## Installation

You can install rdscom using npm:

```bash
npm install rdscom
```

Make sure you have `ioredis` installed as a peer dependency:

```bash
npm install ioredis
```

## Features

- Simple message sending and receiving over Redis
- Support for RPC (Remote Procedure Call)
- Built-in distributed tracing
- Dynamic worker limit adjustment
- Clean worker shutdown
- Comprehensive error handling for Redis operations
- Graceful failure recovery

## Usage

### Creating a Message Broker

```typescript
import { Redis } from 'ioredis';
import { createMessageBroker } from 'rdscom';

// Redis connection should be managed by your application
const redisClient = new Redis({
  host: 'your-redis-host',
  port: 6379,
});

// Handle Redis connection errors at the application level
redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

const messageBroker = createMessageBroker(redisClient);
```

### Error Handling

The library provides comprehensive error handling for all Redis operations:

```typescript
// Sending messages with error handling
try {
  await messageBroker.send('channel-name', 'Hello, World!');
} catch (error) {
  console.error('Failed to send message:', error);
}

// Handling processing errors in listeners
const worker = messageBroker.listen(
  'channel-name',
  async (message, traceId) => {
    console.log(`Received message: ${message}, TraceID: ${traceId}`);
  },
  async (error, message, traceId) => {
    // All Redis errors and message parsing errors will be caught here
    console.error(`Error processing message: ${error}, TraceID: ${traceId}`);
  }
);

// RPC with error handling
try {
  const result = await messageBroker.sendAndWaitForResponse('rpc-channel', 'Hello, RPC!');
  console.log('RPC result:', result);
} catch (error) {
  if (error.message.includes('timeout')) {
    console.error('RPC request timed out');
  } else {
    console.error('RPC failed:', error);
  }
}
```

### Sending Messages

```typescript
// Simple send
await messageBroker.send('channel-name', 'Hello, World!');

// Send with custom trace ID
await messageBroker.send('channel-name', 'Hello, World!', 'custom-trace-id');
```

### Receiving Messages

```typescript
const worker = messageBroker.listen(
  'channel-name',
  async (message, traceId) => {
    console.log(`Received message: ${message}, TraceID: ${traceId}`);
  },
  async (error, message, traceId) => {
    console.error(`Error processing message: ${error}, TraceID: ${traceId}`);
  }
);

// Later, when you want to stop the worker:
await worker.stop();
```

### RPC (Remote Procedure Call)

Sender:
```typescript
const result = await messageBroker.sendAndWaitForResponse('rpc-channel', 'Hello, RPC!');
console.log('RPC result:', result);
```

Receiver:
```typescript
const rpcHandler = messageBroker.listenAndRespond(
  'rpc-channel',
  async (message, traceId) => {
    console.log(`Received RPC request: ${message}, TraceID: ${traceId}`);
    return `Processed: ${message}`;
  },
  async (error, message, traceId) => {
    console.error(`Error processing RPC: ${error}, TraceID: ${traceId}`);
  }
);
```

## API Reference

`createMessageBroker(redisClient: Redis)`

Creates a new message broker. The Redis client should be managed by your application, including connection handling and error management.

-----

`messageBroker.send(channelName: string, message: string, traceId?: string): Promise<void>`

Sends a message to a specified channel. Throws an error if the Redis operation fails.

Parameters:
- `channelName`: The Redis channel to send the message to
- `message`: The message content
- `traceId` (optional): Custom trace ID for distributed tracing

-----

`messageBroker.listen(channelName: string, handler: MessageHandler, errorHandler: ErrorHandler, initialWorklimit?: number): Worker`

Starts a listener for a specified channel. Returns a worker instance that can be used to control the listener.

Parameters:
- `channelName`: The Redis channel to listen on
- `handler`: Function to process received messages
- `errorHandler`: Function to handle processing errors
- `initialWorklimit` (optional): Initial number of concurrent workers (default: 1)

-----

`messageBroker.sendAndWaitForResponse(channelName: string, message: any, traceId?: string): Promise<string>`

Sends an RPC request and waits for the response. Throws an error if the operation fails or times out (30 second default timeout).

Parameters:
- `channelName`: The Redis channel to send the RPC request to
- `message`: The request message
- `traceId` (optional): Custom trace ID for distributed tracing

-----

`messageBroker.listenAndRespond(channelName: string, handler: RPCHandler, errorHandler: ErrorHandler, initialWorklimit?: number): Worker`

Starts an RPC handler for a specified channel. Returns a worker instance.

Parameters:
- `channelName`: The Redis channel to listen for RPC requests
- `handler`: Function to process requests and return responses
- `errorHandler`: Function to handle processing errors
- `initialWorklimit` (optional): Initial number of concurrent workers (default: 1)

## Advanced Usage

### Adjusting Worker Limit

```typescript
const worker = messageBroker.listen(/*...*/);
worker.setWorklimit(10); // Changes the worker limit to 10
```

### Retrieving Worker Statistics

```typescript
const stats = worker.getStats();
console.log(`Active workers: ${stats.activeWorkers}, Worker limit: ${stats.worklimit}`);
```

### Error Handling Best Practices

1. Always handle Redis connection errors at the application level
2. Implement error handlers for your listeners
3. Use try-catch blocks around RPC operations
4. Monitor worker statistics for health checks

## Contributing

Contributions are welcome! Please read the contribution guidelines before submitting pull requests.

## License

This library is licensed under the MIT License. See the LICENSE file for more information.