import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

const createMockApi = () => {
  const registered: Record<string, any> = {};
  const loadConfig = vi.fn(() => ({}));
  const writeConfigFile = vi.fn(async () => undefined);
  return {
    api: {
      runtime: {
        logger: { info: vi.fn(), error: vi.fn() },
        config: {
          loadConfig,
          writeConfigFile,
        },
      },
      registerChannel: vi.fn((opts) => {
        registered.channel = opts;
      }),
      registerHttpRoute: vi.fn(),
    } as any,
    registered,
    loadConfig,
    writeConfigFile,
  };
};

describe("plugin registration", () => {
  it("should have correct id and name", () => {
    expect(plugin.id).toBe("pinto-app-openclaw");
    expect(plugin.name).toBe("Pinto Chat");
  });

  it("should register the pinto channel plugin", () => {
    const { api, registered } = createMockApi();
    plugin.register(api);
    expect(api.registerChannel).toHaveBeenCalledTimes(1);
    expect(registered.channel.plugin.id).toBe("pinto");
  });

  it("should initialize default channels.pinto config when missing", () => {
    const { api, writeConfigFile } = createMockApi();
    plugin.register(api);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          pinto: expect.objectContaining({
            enabled: true,
            apiUrl: "https://api.pinto-app.com",
            botId: "",
            webhookPath: "/plugins/pinto/webhook",
          }),
        }),
      }),
    );
  });

  it("should not overwrite existing channels.pinto config", () => {
    const { api, writeConfigFile, loadConfig } = createMockApi();
    loadConfig.mockReturnValue({
      channels: {
        pinto: {
          enabled: true,
          apiUrl: "https://api.pinto-app.com",
          botId: "bot-existing",
        },
      },
    });

    plugin.register(api);
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("should not register standalone http routes", () => {
    const { api } = createMockApi();
    plugin.register(api);
    expect(api.registerHttpRoute).not.toHaveBeenCalled();
  });
});
