import type { ChannelPlugin, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  PintoPluginConfig,
  PintoWebhookReceiveRequest,
  PintoWebhookPayload,
} from "./types.js";

let runtime: RuntimeEnv;

export const setPintoRuntime = (r: RuntimeEnv) => {
  runtime = r;
};

export const pintoPlugin: ChannelPlugin<any, any> = {
  id: "pinto",
  meta: {
    name: "Pinto Chat",
    description: "Adapter for Pinto Chat platform",
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    nativeCommands: false,
    reactions: false,
    threads: false,
  },

  // Configuration management
  config: {
    listAccountIds: (cfg: any) => {
      // Return list of pinto bot IDs configured in OpenClaw
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
  },

  // Outbound: Sending messages back to Pinto API
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, config }) => {
      const { pintoApiUrl } = config as PintoPluginConfig;

      const payload: PintoWebhookReceiveRequest = {
        bot_id: accountId!,
        chat_id: to,
        reply_message: text,
      };

      await fetch(`${pintoApiUrl}/v1/bots/webhook/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

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

      await fetch(`${pintoApiUrl}/v1/bots/webhook/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return { channel: "pinto", messageId: Date.now().toString() };
    },
  },
};
