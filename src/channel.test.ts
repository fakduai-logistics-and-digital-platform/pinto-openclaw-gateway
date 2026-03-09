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
                pintoApiUrl: "https://api.pinto-app.com",
                pintoWebhookSecret: "secret123",
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
          config: { pintoApiUrl: "https://api.pinto-app.com" },
        } as any),
      ).rejects.toThrow();
    });

    it("should return messageId on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await pintoPlugin.outbound.sendText({
        to: "chat1",
        text: "hello",
        accountId: "bot1",
        config: { pintoApiUrl: "https://api.pinto-app.com" },
      } as any);

      expect(result).toHaveProperty("channel", "pinto");
      expect(result).toHaveProperty("messageId");
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
          config: { pintoApiUrl: "https://api.pinto-app.com" },
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
        config: { pintoApiUrl: "https://api.pinto-app.com" },
      } as any);

      expect(result).toHaveProperty("channel", "pinto");
      expect(result).toHaveProperty("messageId");
    });
  });
});
