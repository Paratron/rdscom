# rdscom

A lightweight and efficient TypeScript library for message queuing and RPC (Remote Procedure Call) using Redis.

## Table of Contents

- [rdscom](#rdscom)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Key Features](#key-features)
  - [Core Concepts](#core-concepts)
    - [Message Queuing](#message-queuing)
      - [Common Use Cases](#common-use-cases)
    - [Remote Procedure Call (RPC)](#remote-procedure-call-rpc)
  - [Installation](#installation)
  - [Basic Usage](#basic-usage)
    - [Sending Messages](#sending-messages)
    - [Receiving Messages](#receiving-messages)
    - [Using RPC](#using-rpc)
      - [Setting up an RPC Responder](#setting-up-an-rpc-responder)
      - [Making an RPC Call](#making-an-rpc-call)
  - [Advanced Usage](#advanced-usage)
    - [Distributed Tracing](#distributed-tracing)
    - [Worker Management](#worker-management)
    - [Redis Connection Management](#redis-connection-management)
    - [Logging Configuration](#logging-configuration)
  - [Error Handling](#error-handling)
    - [Redis Connection Errors](#redis-connection-errors)
    - [Malformed Messages](#malformed-messages)
  - [API Reference](#api-reference)
    - [`send(channel: string, message: string, traceId?: string): Promise<void>`](#sendchannel-string-message-string-traceid-string-promisevoid)
    - [`listen(channel: string, handler: Function, errorHandler?: Function, initialWorklimit?: number): Worker`](#listenchannel-string-handler-function-errorhandler-function-initialworklimit-number-worker)
    - [`sendAndWaitForResponse(channel: string, message: string, traceId?: string): Promise<string>`](#sendandwaitforresponsechannel-string-message-string-traceid-string-promisestring)
    - [`listenAndRespond(channel: string, handler: Function, errorHandler?: Function): Worker`](#listenandrespondchannel-string-handler-function-errorhandler-function-worker)
  - [License](#license)

---

## Overview

`rdscom` is a lightweight and efficient TypeScript library designed for message queuing and remote procedure calls (RPC) using Redis. It facilitates asynchronous communication and scalable processing across distributed systems.

### Key Features
- **Message Queuing**: Reliable, FIFO-based message delivery with persistence until processed.
- **Remote Procedure Call (RPC)**: Asynchronous request-response pattern across services.
- **Distributed Tracing**: Built-in trace ID support for seamless log correlation.
- **Customizable Logging**: Integrates with your existing logging systems.
- **Scalable Workers**: Dynamically control concurrency with worker limits.
- **Full Redis Control**: You manage Redis connections for complete flexibility.

---

## Core Concepts

### Message Queuing

Message queuing enables asynchronous communication by delivering messages with low latency when receivers are listening, while ensuring persistence until processing.

Key characteristics:
- Near real-time delivery when listeners are active.
- FIFO order within each channel.
- Messages persist in Redis until successfully processed.

#### Common Use Cases
- Background job processing
- Load balancing across multiple services
- Decoupling system components
- Handling high-throughput operations

---

### Remote Procedure Call (RPC)

RPC allows services to make asynchronous requests and handle responses without blocking. It promotes loose coupling while enabling communication between services.

Example: A service validates user credentials by making an RPC call to an authentication service.

Benefits:
- Enables request-response patterns across services.
- Supports asynchronous and non-blocking operations.

---

## Installation

Install `rdscom` and its peer dependency, [ioredis](https://www.npmjs.com/package/ioredis):

```bash
npm install rdscom ioredis
```

---

## Basic Usage

### Sending Messages

Send messages to a specific channel:
```typescript
await broker.send('user-service', JSON.stringify({
  action: 'create',
  data: { name: 'John Doe' }
}));
```

### Receiving Messages

Start listening on a channel:
```typescript
const worker = broker.listen(
  'user-service',
  async (message) => {
    const data = JSON.parse(message);
    console.log('Processing message:', data);
    await processMessage(data);
  }
);

// Gracefully stop the worker later
await worker.stop();
```

### Using RPC

#### Setting up an RPC Responder
```typescript
const rpcWorker = broker.listenAndRespond(
  'auth-service',
  async (message) => {
    const { username, password } = JSON.parse(message);
    return JSON.stringify({ valid: username === 'admin' });
  }
);
```

#### Making an RPC Call
```typescript
try {
  const response = await broker.sendAndWaitForResponse(
    'auth-service',
    JSON.stringify({ username: 'user', password: 'pass' })
  );
  const result = JSON.parse(response);
  console.log('Authentication result:', result);
} catch (error) {
  console.error('Error during RPC:', error.message);
}
```

---

## Advanced Usage

### Distributed Tracing

Built-in support for trace IDs:
```typescript
await broker.send(
  'user-service',
  JSON.stringify({ action: 'create' }),
  'trace-123'
);
```
Trace IDs help:
- Link messages to handlers across services.
- Track RPC request-response pairs.
- Correlate logs across systems.

### Worker Management

Control concurrency using worker limits:
```typescript
const worker = broker.listen('channel', async (message) => { /* ... */ }, undefined, 5);

// Adjust limits dynamically
worker.setWorklimit(10);  // Increase to 10 workers
worker.setWorklimit(0);   // Unlimited concurrency
```

### Redis Connection Management

You manage Redis connections for full flexibility:
```typescript
import { Redis } from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

const broker = createMessageBroker(redis);
```

### Logging Configuration

Integrate with your logging system:
```typescript
const broker = createMessageBroker(redisClient, { logger: customLogger });
```

__Heads up!__: Make sure your custom logger implements at least a `warn()` and `error()` method.

```typescript
interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

---

## Error Handling

### Redis Connection Errors

Handle Redis errors at the application level:
```typescript
redis.on('error', (error) => {
  console.error('Redis error:', error);
});
```

### Malformed Messages

By default, malformed messages are logged and dropped. Provide an error handler to customize:
```typescript
const worker = broker.listen(
  'channel',
  async (message) => { /* ... */ },
  async (error, rawMessage) => {
    console.warn('Malformed message:', { error, rawMessage });
  }
);
```

---

## API Reference

### `send(channel: string, message: string, traceId?: string): Promise<void>`

**Description**: Sends a message to a specific channel.

**Arguments**:
- `channel` (string): The name of the Redis channel to send the message to.
- `message` (string): The content of the message. Should be a stringified JSON object or other valid string.
- `traceId?` (string, optional): An optional unique identifier for tracing the message. If not provided, a UUID will be generated.

**Example**:
```typescript
await broker.send('user-service', JSON.stringify({ action: 'create' }), 'trace-123');
```

---

### `listen(channel: string, handler: Function, errorHandler?: Function, initialWorklimit?: number): Worker`

**Description**: Starts listening for messages on a channel.

**Arguments**:
- `channel` (string): The name of the channel to listen on.
- `handler` (Function): The function to process each message.
- `errorHandler?` (Function, optional): Handles malformed messages.
- `initialWorklimit?` (number, optional): Limits concurrent workers (default is 1).

**Example**:
```typescript
const worker = broker.listen('channel', async (message) => { console.log(message); });
```

---

### `sendAndWaitForResponse(channel: string, message: string, traceId?: string): Promise<string>`

**Description**: Sends an RPC message and waits for a response.

**Arguments**:
- `channel` (string): The channel to send the message to.
- `message` (string): The content of the message.
- `traceId?` (string, optional): A unique identifier for tracing.

**Example**:
```typescript
const response = await broker.sendAndWaitForResponse('auth-service', JSON.stringify({ user: 'admin' }));
```

---

### `listenAndRespond(channel: string, handler: Function, errorHandler?: Function): Worker`

**Description**: Sets up an RPC responder.

**Arguments**:
- `channel` (string): The name of the channel to respond to.
- `handler` (Function): The function to handle requests.
- `errorHandler?` (Function, optional): Handles errors during request processing.

**Example**:
```typescript
const rpcWorker = broker.listenAndRespond('auth-service', async (message) => { return 'response'; });
```

---

## License

This project is licensed under the MIT License.