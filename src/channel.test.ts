import { describe, it, expect, vi, beforeEach } from "vitest";
import { pintoPlugin, setPintoRuntime } from "./channel.js";

describe("pintoPlugin", () => {
  describe("meta fields", () => {
    it("should have required meta fields per OpenClaw docs", () => {
      const meta = pintoPlugin.meta;
      expect(meta.id).toBe("pinto");
      expect(meta.label).toBe("Pinto Chat");
      expect(meta.selectionLabel).toBeTypeOf("string");
      expect(meta.blurb).toBeTypeOf("string");
      expect(meta.aliases).toContain("pinto");
      expect(meta.detailLabel).toBeTypeOf("string");
    });
  });

  describe("config.inspectAccount", () => {
    it("should return token status for a configured account", () => {
      const cfg = {
        channels: {
          pinto: {
            accounts: {
              bot1: {
                apiUrl: "https://api.pinto-app.com",
                botId: "bot-123",
                webhookSecret: "secret123",
              },
            },
          },
        },
      };
      const result = pintoPlugin.config.inspectAccount!(cfg, "bot1");
      expect(result).toHaveProperty("tokenStatus", "available");
    });

    it("should return unavailable for missing account", () => {
      const cfg = { channels: {} };
      const result = pintoPlugin.config.inspectAccount!(cfg, "missing");
      expect(result).toHaveProperty("configured_unavailable", true);
    });
  });

  describe("config account accessors", () => {
    it("should expose defaultAccountId as default", () => {
      expect(pintoPlugin.config.defaultAccountId!({} as any)).toBe("default");
    });

    it("should set account enabled state in config", () => {
      const next = pintoPlugin.config.setAccountEnabled!({
        cfg: {
          channels: {
            pinto: {
              enabled: true,
              apiUrl: "https://api.pinto-app.com",
              botId: "bot-123",
            },
          },
        },
        accountId: "default",
        enabled: false,
      } as any);

      expect(next.channels.pinto.enabled).toBe(false);
    });
  });

  describe("security.collectWarnings", () => {
    it("should warn when botId and webhookSecret are missing", () => {
      const warnings = pintoPlugin.security!.collectWarnings!({
        account: {
          config: {
            apiUrl: "https://api.pinto-app.com",
            webhookPath: "plugins/pinto/webhook",
          },
        },
      } as any);

      expect(warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("botId is not configured"),
          expect.stringContaining("webhookSecret is empty"),
          expect.stringContaining("webhookPath should start"),
        ]),
      );
    });
  });

  describe("config.describeAccount", () => {
    it("should use botId as the account name when configured", () => {
      const account = pintoPlugin.config.resolveAccount!(
        {
          channels: {
            pinto: {
              accounts: {
                bot1: {
                  apiUrl: "https://api.pinto-app.com",
                  botId: "bot-123",
                },
              },
            },
          },
        },
        "bot1",
      );

      const result = pintoPlugin.config.describeAccount!(account);
      expect(result).toMatchObject({
        accountId: "bot1",
        name: "bot-123",
        enabled: true,
        configured: true,
        botId: "bot-123",
        webhookPath: "/plugins/pinto/webhook",
      });
    });

    it("should migrate legacy webhookHeaderValue into webhookSecret", () => {
      const account = pintoPlugin.config.resolveAccount!(
        {
          channels: {
            pinto: {
              apiUrl: "https://api.pinto-app.com",
              botId: "bot-legacy",
              webhookHeaderValue: "legacy-secret",
            },
          },
        },
        "default",
      );

      expect(account.config.webhookSecret).toBe("legacy-secret");
    });
  });

  describe("setup.applyAccountConfig", () => {
    it("should apply default Pinto config and generate a webhook secret", () => {
      const next = pintoPlugin.setup!.applyAccountConfig({
        cfg: { channels: {} },
        accountId: "default",
        input: {},
      } as any);

      expect(next.channels.pinto.enabled).toBe(true);
      expect(next.channels.pinto.apiUrl).toBe("https://api.pinto-app.com");
      expect(next.channels.pinto.webhookSecret).toMatch(
        /^pinto-oc-[a-f0-9]{24}$/,
      );
      expect(next.channels.pinto.webhookPath).toBe("/plugins/pinto/webhook");
    });

    it("should keep an existing webhook secret when setup runs again", () => {
      const next = pintoPlugin.setup!.applyAccountConfig({
        cfg: {
          channels: {
            pinto: {
              enabled: true,
              apiUrl: "https://api.pinto-app.com",
              webhookSecret: "pinto-oc-existingsecret123",
            },
          },
        },
        accountId: "default",
        input: {},
      } as any);

      expect(next.channels.pinto.webhookSecret).toBe(
        "pinto-oc-existingsecret123",
      );
    });

    it("should update botId, webhookSecret, and webhookPath from setup input", () => {
      const next = pintoPlugin.setup!.applyAccountConfig({
        cfg: {
          channels: {
            pinto: {
              enabled: true,
              apiUrl: "https://api.pinto-app.com",
              botId: "bot-old",
              webhookSecret: "secret-old",
              webhookPath: "/plugins/pinto/webhook",
            },
          },
        },
        accountId: "default",
        input: {
          botId: "bot-new",
          webhookSecret: "secret-new",
          webhookPath: "/plugins/pinto/custom-webhook",
        },
      } as any);

      expect(next.channels.pinto.botId).toBe("bot-new");
      expect(next.channels.pinto.webhookSecret).toBe("secret-new");
      expect(next.channels.pinto.webhookPath).toBe(
        "/plugins/pinto/custom-webhook",
      );
    });
  });

  describe("outbound.sendText", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should throw on non-ok response from Pinto API", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      });

      await expect(
        pintoPlugin.outbound.sendText({
          to: "chat1",
          text: "hello",
          accountId: "bot1",
          cfg: {
            channels: {
              pinto: {
                accounts: {
                  bot1: {
                    apiUrl: "https://api.pinto-app.com",
                    botId: "bot-123",
                  },
                },
              },
            },
          },
        } as any),
      ).rejects.toThrow();
    });

    it("should return messageId on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await pintoPlugin.outbound.sendText({
        to: "chat1",
        text: "hello",
        accountId: "bot1",
        cfg: {
          channels: {
            pinto: {
              accounts: {
                bot1: {
                  apiUrl: "https://api.pinto-app.com",
                  botId: "bot-123",
                  webhookSecret: "secret123",
                },
              },
            },
          },
        },
      } as any);

      expect(result).toHaveProperty("channel", "pinto");
      expect(result).toHaveProperty("messageId");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.pinto-app.com/v1/bots/webhook/receive",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Pinto-Secret": "secret123",
          }),
        }),
      );
    });
  });

  describe("outbound.sendMedia", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should throw on non-ok response from Pinto API", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        pintoPlugin.outbound.sendMedia!({
          to: "chat1",
          text: "check this",
          mediaUrl: "https://img.example.com/a.png",
          accountId: "bot1",
          cfg: {
            channels: {
              pinto: {
                accounts: {
                  bot1: {
                    apiUrl: "https://api.pinto-app.com",
                    botId: "bot-123",
                  },
                },
              },
            },
          },
        } as any),
      ).rejects.toThrow();
    });

    it("should return messageId on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await pintoPlugin.outbound.sendMedia!({
        to: "chat1",
        text: "check this",
        mediaUrl: "https://img.example.com/a.png",
        accountId: "bot1",
        cfg: {
          channels: {
            pinto: {
              accounts: {
                bot1: {
                  apiUrl: "https://api.pinto-app.com",
                  botId: "bot-123",
                  webhookSecret: "secret123",
                },
              },
            },
          },
        },
      } as any);

      expect(result).toHaveProperty("channel", "pinto");
      expect(result).toHaveProperty("messageId");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.pinto-app.com/v1/bots/webhook/receive",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Pinto-Secret": "secret123",
          }),
        }),
      );
    });
  });

});
