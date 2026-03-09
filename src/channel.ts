import type { ChannelPlugin, RuntimeEnv } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";
import { PintoPluginConfig, PintoWebhookReceiveRequest } from "./types.js";

let runtime: RuntimeEnv;

export const setPintoRuntime = (r: RuntimeEnv) => {
  runtime = r;
};

const PintoChannelConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    apiUrl: z.string().trim().min(1).default("https://api-dev.pinto-app.com/"),
    webhookSecret: z.string().trim().optional(),
  })
  .strict();

const getPintoChannelConfig = (cfg: any, accountId?: string | null) => {
  const resolvedAccountId = accountId ?? "default";
  const channelConfig = cfg?.channels?.pinto ?? {};
  const accountConfig = channelConfig.accounts?.[resolvedAccountId];
  return accountConfig ?? channelConfig;
};

export const pintoPlugin: ChannelPlugin<any, any> & { configSchema?: any } = {
  id: "pinto",
  meta: {
    id: "pinto",
    name: "Pinto",
    label: "Pinto Chat",
    selectionLabel: "Pinto (Chat Bot)",
    blurb: "Pinto App Thailand",
    aliases: ["pinto"],
    detailLabel: "Pinto Chat via API",
    description: "Adapter for Pinto Chat platform",
  } as any,
  configSchema: buildChannelConfigSchema(PintoChannelConfigSchema),
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    nativeCommands: false,
    reactions: false,
    threads: false,
  },

  config: {
    listAccountIds: (cfg: any) => {
      return ["default"];
    },
    resolveAccount: (cfg: any, accountId: string) => {
      const bot = getPintoChannelConfig(cfg, accountId);
      return {
        id: accountId || "default",
        config: bot,
        enabled: bot?.enabled ?? true,
      };
    },
    inspectAccount: (cfg: any, accountId: string) => {
      const bot = getPintoChannelConfig(cfg, accountId);
      if (!bot || !bot.apiUrl) {
        return { configured_unavailable: true };
      }
      return {
        tokenSource: "config",
        tokenStatus: "available",
      };
    },
    isConfigured: (account: any) => {
      return Boolean(account.config?.apiUrl?.trim());
    },
    describeAccount: (account: any) => ({
      accountId: account.id,
      name: "Pinto Default Bot",
      enabled: account.enabled,
      configured: Boolean(account.config?.apiUrl?.trim()),
    }),
  } as any,

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, cfg }) => {
      const apiUrl =
        getPintoChannelConfig(cfg, accountId)?.apiUrl ?? "https://api-dev.pinto-app.com/";

      const payload: PintoWebhookReceiveRequest = {
        bot_id: "default",
        chat_id: to,
        reply_message: text,
      };

      const res = await fetch(`${apiUrl}/v1/bots/webhook/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Pinto API error: ${res.status} ${res.statusText}`);
      }

      return { channel: "pinto", messageId: Date.now().toString() };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const apiUrl =
        getPintoChannelConfig(cfg, accountId)?.apiUrl ?? "https://api-dev.pinto-app.com/";

      const payload: PintoWebhookReceiveRequest = {
        bot_id: "default",
        chat_id: to,
        reply_message: text,
        media_url: mediaUrl,
      };

      const res = await fetch(`${apiUrl}/v1/bots/webhook/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Pinto API error: ${res.status} ${res.statusText}`);
      }

      return { channel: "pinto", messageId: Date.now().toString() };
    },
  },
};
