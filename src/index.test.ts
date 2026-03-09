import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

const createMockApi = () => {
  const registered: Record<string, any> = {};
  return {
    api: {
      runtime: {
        logger: { info: vi.fn(), error: vi.fn() },
      },
      registerChannel: vi.fn((opts) => {
        registered.channel = opts;
      }),
      registerHttpRoute: vi.fn(),
    } as any,
    registered,
  };
};

describe("plugin registration", () => {
  it("should have correct id and name", () => {
    expect(plugin.id).toBe("pinto-openclaw-gateway");
    expect(plugin.name).toBe("Pinto Chat");
  });

  it("should register the pinto channel plugin", () => {
    const { api, registered } = createMockApi();
    plugin.register(api);
    expect(api.registerChannel).toHaveBeenCalledTimes(1);
    expect(registered.channel.plugin.id).toBe("pinto");
  });

  it("should not register standalone http routes", () => {
    const { api } = createMockApi();
    plugin.register(api);
    expect(api.registerHttpRoute).not.toHaveBeenCalled();
  });
});
