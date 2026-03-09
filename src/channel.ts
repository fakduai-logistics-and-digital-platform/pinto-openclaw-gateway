import type { IncomingMessage } from "node:http";
import type { ChannelPlugin, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  registerPluginHttpRoute,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { PintoWebhookPayload, PintoWebhookReceiveRequest } from "./types.js";

let runtime: RuntimeEnv;

export const setPintoRuntime = (r: RuntimeEnv) => {
  runtime = r;
};

const PintoChannelConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    apiUrl: z.string().trim().min(1).default("https://api-dev.pinto-app.com/"),
    botId: z.string().trim().min(1).optional(),
    webhookSecret: z.string().trim().optional(),
  })
  .strict();

const getPintoChannelConfig = (cfg: any, accountId?: string | null) => {
  const resolvedAccountId = accountId ?? "default";
  const channelConfig = cfg?.channels?.pinto ?? {};
  const accountConfig = channelConfig.accounts?.[resolvedAccountId];
  return {
    enabled: true,
    ...(accountConfig ?? channelConfig),
  };
};

async function sendPintoText(params: {
  cfg: any;
  accountId?: string | null;
  to: string;
  text: string;
}) {
  const account = getPintoChannelConfig(params.cfg, params.accountId);
  const apiUrl = account?.apiUrl ?? "https://api-dev.pinto-app.com/";
  const botId = account?.botId?.trim();
  if (!botId) {
    throw new Error("Pinto botId is not configured");
  }

  const payload: PintoWebhookReceiveRequest = {
    bot_id: botId,
    chat_id: params.to,
    reply_message: params.text,
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
}

const waitUntilAbort = (
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<void> =>
  new Promise((resolve) => {
    const complete = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) return;
    if (signal.aborted) {
      complete();
      return;
    }
    signal.addEventListener("abort", complete, { once: true });
  });

async function readJsonBody(
  req: IncomingMessage,
): Promise<PintoWebhookPayload> {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  return JSON.parse(raw || "{}") as PintoWebhookPayload;
}

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
      if (!bot || !bot.apiUrl || !bot.botId) {
        return { configured_unavailable: true };
      }
      return {
        tokenSource: "config",
        tokenStatus: "available",
      };
    },
    isConfigured: (account: any) => {
      return Boolean(
        account.config?.apiUrl?.trim() && account.config?.botId?.trim(),
      );
    },
    describeAccount: (account: any) => ({
      accountId: account.id,
      name: "Pinto Default Bot",
      enabled: account.enabled,
      configured: Boolean(
        account.config?.apiUrl?.trim() && account.config?.botId?.trim(),
      ),
    }),
  } as any,

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, cfg }) =>
      sendPintoText({ cfg, accountId, to, text }),

    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const account = getPintoChannelConfig(cfg, accountId);
      const apiUrl = account?.apiUrl ?? "https://api-dev.pinto-app.com/";
      const botId = account?.botId?.trim();

      if (!botId) {
        throw new Error("Pinto botId is not configured");
      }

      const payload: PintoWebhookReceiveRequest = {
        bot_id: botId,
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

  gateway: {
    startAccount: async (ctx: any) => {
      const account = getPintoChannelConfig(ctx.cfg, ctx.accountId);
      if (
        account?.enabled === false ||
        !account?.apiUrl?.trim() ||
        !account?.botId?.trim()
      ) {
        return waitUntilAbort(ctx.abortSignal);
      }
      if (!ctx.channelRuntime) {
        ctx.log?.warn?.(
          "Pinto channelRuntime unavailable; webhook route not started",
        );
        return waitUntilAbort(ctx.abortSignal);
      }

      const unregister = registerPluginHttpRoute({
        path: "/plugins/pinto/webhook",
        auth: "plugin",
        replaceExisting: true,
        pluginId: "pinto",
        accountId: ctx.accountId,
        handler: async (req, res) => {
          try {
            const payload = await readJsonBody(req);
            if (!payload.bot_id || !payload.chat_id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing required fields" }));
              return true;
            }

            const route = ctx.channelRuntime.routing.resolveAgentRoute({
              cfg: ctx.cfg,
              channel: "pinto",
              accountId: ctx.accountId,
              peer: { kind: "direct", id: payload.chat_id },
            });

            const msgCtx = ctx.channelRuntime.reply.finalizeInboundContext({
              Body: payload.message ?? "",
              RawBody: payload.message ?? "",
              CommandBody: payload.message ?? "",
              From: `pinto:${payload.user_id ?? payload.chat_id}`,
              To: `pinto:${payload.chat_id}`,
              SessionKey: route.sessionKey,
              AccountId: route.accountId,
              OriginatingChannel: "pinto",
              OriginatingTo: `pinto:${payload.chat_id}`,
              ChatType: "direct",
              SenderName:
                payload.username ?? payload.user_id ?? payload.chat_id,
              SenderId: payload.user_id ?? payload.chat_id,
              Provider: "pinto",
              Surface: "pinto",
              ConversationLabel: payload.username ?? payload.chat_id,
              Timestamp: Date.now(),
              CommandAuthorized: true,
            });

            await ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher(
              {
                ctx: msgCtx,
                cfg: ctx.cfg,
                dispatcherOptions: {
                  deliver: async (replyPayload: {
                    text?: string;
                    body?: string;
                  }) => {
                    const text = replyPayload?.text ?? replyPayload?.body;
                    if (!text) return;
                    await sendPintoText({
                      cfg: ctx.cfg,
                      accountId: ctx.accountId,
                      to: payload.chat_id,
                      text,
                    });
                  },
                },
              },
            );

            res.statusCode = 200;
            res.end(JSON.stringify({ message: "Message forwarded to agent" }));
            return true;
          } catch (error: any) {
            ctx.log?.error?.(
              `[PintoPlugin] Webhook error: ${error?.message ?? String(error)}`,
            );
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: "Internal Server Error",
                detail: error?.message ?? String(error),
              }),
            );
            return true;
          }
        },
      });

      return waitUntilAbort(ctx.abortSignal, () => unregister());
    },
  },
};
