# rdscom

A lightweight and efficient TypeScript library for message queuing and RPC (Remote Procedure Call) using Redis.

## Table of Contents

- [Installation](#installation)
- [Features](#features)
- [Usage](#usage)
  - [Creating a Message Broker](#creating-a-message-broker)
  - [Sending Messages](#sending-messages)
  - [Receiving Messages](#receiving-messages)
  - [RPC (Remote Procedure Call)](#rpc-remote-procedure-call)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
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

## Usage

### Creating a Message Broker

```typescript
import { Redis } from 'ioredis';
import { createMessageBroker } from 'rdscom';

const redisClient = new Redis({
  host: 'your-redis-host',
  port: 6379,
});

const messageBroker = createMessageBroker(redisClient);
```

### Sending Messages

```typescript
await messageBroker.send('channel-name', 'Hello, World!');
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

Creates a new message broker.

-----

`messageBroker.send(channelName: string, message: string, traceId?: string): Promise<void>`

Sends a message to a specified channel.

-----

`messageBroker.listen(channelName: string, handler: MessageHandler, errorHandler: ErrorHandler, initialWorklimit?: number)`

Starts a listener for a specified channel.

-----

`messageBroker.sendAndWaitForResponse(channelName: string, message: any, traceId?: string): Promise<string>`

Sends an RPC request and waits for the response.

-----

`messageBroker.listenAndRespond(channelName: string, handler: RPCHandler, errorHandler: ErrorHandler, initialWorklimit?: number)`

Starts an RPC handler for a specified channel.

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

## Contributing

Contributions are welcome! Please read the contribution guidelines before submitting pull requests.

## License

This library is licensed under the MIT License. See the LICENSE file for more information.