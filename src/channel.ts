import type { ChannelPlugin, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  PintoPluginConfig,
  PintoWebhookReceiveRequest,
} from "./types.js";

let runtime: RuntimeEnv;

export const setPintoRuntime = (r: RuntimeEnv) => {
  runtime = r;
};

export const pintoPlugin: ChannelPlugin<any, any> & { configSchema?: any } = {
  id: "pinto",
  meta: {
    id: "pinto",
    name: "Pinto Chat",
    label: "Pinto Chat",
    selectionLabel: "Pinto Chat (API)",
    blurb: "Pinto Chat messaging channel.",
    aliases: ["pinto"],
    detailLabel: "Pinto Chat via API",
    description: "Adapter for Pinto Chat platform",
  } as any,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pintoApiUrl: {
        type: "string",
        title: "Pinto API URL",
        description: "The base URL of the Pinto API",
        default: "http://localhost:1323",
      },
      pintoWebhookSecret: {
        type: "string",
        title: "Webhook Secret",
        description: "Secret key for authenticating requests from Pinto",
      },
    },
    required: [],
  } as any,
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    nativeCommands: false,
    reactions: false,
    threads: false,
  },

  config: {
    listAccountIds: (cfg: any) => {
      return Object.keys(cfg.channels?.pinto?.accounts || {});
    },
    resolveAccount: (cfg: any, accountId: string) => {
      const account = cfg.channels?.pinto?.accounts?.[accountId];
      return {
        id: accountId,
        config: account,
        enabled: account?.enabled ?? true,
      };
    },
    inspectAccount: (cfg: any, accountId: string) => {
      const account = cfg.channels?.pinto?.accounts?.[accountId];
      if (!account || !account.pintoApiUrl) {
        return { configured_unavailable: true };
      }
      return {
        tokenSource: "config",
        tokenStatus: "available",
      };
    },
  } as any,

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, config }) => {
      const { pintoApiUrl } = config as PintoPluginConfig;

      const payload: PintoWebhookReceiveRequest = {
        bot_id: accountId!,
        chat_id: to,
        reply_message: text,
      };

      const res = await fetch(`${pintoApiUrl}/v1/bots/webhook/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Pinto API error: ${res.status} ${res.statusText}`);
      }

      return { channel: "pinto", messageId: Date.now().toString() };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId, config }) => {
      const { pintoApiUrl } = config as PintoPluginConfig;

      const payload: PintoWebhookReceiveRequest = {
        bot_id: accountId!,
        chat_id: to,
        reply_message: text,
        media_url: mediaUrl,
      };

      const res = await fetch(`${pintoApiUrl}/v1/bots/webhook/receive`, {
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
