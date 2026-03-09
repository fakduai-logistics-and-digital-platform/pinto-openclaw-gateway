import { describe, it, expect, vi } from "vitest";
import plugin from "./index.js";

const createMockApi = () => {
  const registered: Record<string, any> = {};
  return {
    api: {
      runtime: {
        logger: { info: vi.fn(), error: vi.fn() },
        message: { receive: vi.fn().mockResolvedValue(undefined) },
      },
      registerChannel: vi.fn((opts) => {
        registered.channel = opts;
      }),
      registerHttpRoute: vi.fn((opts) => {
        registered.httpRoute = opts;
      }),
    } as any,
    registered,
  };
};

describe("plugin registration", () => {
  it("should have correct id and name", () => {
    expect(plugin.id).toBe("pinto-openclaw-gateway");
    expect(plugin.name).toBe("Pinto Chat");
  });

  it("should register channel and http route", () => {
    const { api } = createMockApi();
    plugin.register(api);
    expect(api.registerChannel).toHaveBeenCalled();
    expect(api.registerHttpRoute).toHaveBeenCalled();
  });

  it("should register http route with auth field", () => {
    const { api, registered } = createMockApi();
    plugin.register(api);
    expect(registered.httpRoute.auth).toBe("plugin");
    expect(registered.httpRoute.path).toBe("/pinto/webhook");
    expect(registered.httpRoute.match).toBe("exact");
  });
});

describe("webhook handler", () => {
  it("should validate webhook secret when configured", async () => {
    const { api, registered } = createMockApi();
    plugin.register(api);

    const handler = registered.httpRoute.handler;
    const req = {
      headers: { "x-pinto-secret": "wrong-secret" },
      body: {
        bot_id: "bot1",
        chat_id: "chat1",
        message: "hi",
        user_id: "user1",
      },
    };
    const res = {
      statusCode: 0,
      end: vi.fn(),
    };

    const result = await handler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it("should reject missing required fields", async () => {
    const { api, registered } = createMockApi();
    plugin.register(api);

    const handler = registered.httpRoute.handler;
    const req = {
      headers: {},
      body: { message: "hi" },
    };
    const res = {
      statusCode: 0,
      end: vi.fn(),
    };

    const result = await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("should forward valid payload to message pipeline", async () => {
    const { api, registered } = createMockApi();
    plugin.register(api);

    const handler = registered.httpRoute.handler;
    const req = {
      headers: {},
      body: {
        bot_id: "bot1",
        chat_id: "chat1",
        message: "hello",
        user_id: "user1",
        username: "testuser",
      },
    };
    const res = {
      statusCode: 0,
      end: vi.fn(),
    };

    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(api.runtime.message.receive).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "pinto",
        accountId: "bot1",
        senderId: "user1",
        targetId: "chat1",
      }),
    );
  });
});
