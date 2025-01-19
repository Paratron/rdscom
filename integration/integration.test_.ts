/**
 * This integration test needs a locally running REDIS server.
 */
import Redis from "ioredis";
import { createMessageBroker } from "../src";

const redisClient = new Redis("redis://127.0.0.1:6379");

const broker = createMessageBroker({
    host: "127.0.0.1",
});

describe("RPC", () => {
    afterAll(() => {
        broker.stop();
    });

    it("Should be able to listen to and send messages to channels", () => {
        const channel = "test";
        let received: string[] = [];

        const channelObj = broker.listen(channel, async (msg) => {
            received.push(msg);
        });

        broker.send(channel, "Hello, world!");
        broker.send(channel, "How are you?");

        setTimeout(() => {
            expect(received).toEqual(["Hello, world!", "How are you?"]);
            channelObj.stop();
        }, 1000);
    });

    it("should send and receive RPC messages", async () => {
        const rpcChannel = "rpc:test";
        let remoteMessage = "";

        const channelObj = broker.listenAndRespond(rpcChannel, async (message) => {
             remoteMessage = message;
             return "pong";
         });

        const result = await broker.sendAndWaitForResponse(rpcChannel, "ping");

        expect(remoteMessage).toBe("ping");
        expect(result).toBe("pong");

        channelObj.stop();
    });
});