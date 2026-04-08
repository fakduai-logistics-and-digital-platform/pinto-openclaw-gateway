import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type {
  ChannelPlugin,
  RuntimeEnv,
} from "openclaw/plugin-sdk/mattermost";
import {
  DEFAULT_ACCOUNT_ID,
  applySetupAccountConfigPatch,
  buildChannelConfigSchema,
  registerPluginHttpRoute,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/mattermost";
import { z } from "zod";
import { PintoWebhookPayload, PintoWebhookReceiveRequest } from "./types.js";

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");
const PINTO_SECRET_HEADER = "x-pinto-secret";
const DEFAULT_PINTO_API_URL = "https://api.pinto-app.com";
const DEFAULT_PINTO_WEBHOOK_PATH = "/plugins/pinto/webhook";

let runtime: RuntimeEnv;

export const setPintoRuntime = (r: RuntimeEnv) => {
  runtime = r;
};

const PintoSecretInputSchema = z
  .union([
    z.string(),
    z.object({
      source: z.string().optional(),
      provider: z.string().optional(),
      id: z.string().optional(),
      value: z.string().optional(),
    }),
  ])
  .optional();

const PintoAccountConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    apiUrl: z.string().trim().min(1).default(DEFAULT_PINTO_API_URL),
    botId: z.string().trim().optional(),
    agentId: z.string().trim().optional(),
    observerAgentIds: z.array(z.string().trim().min(1)).optional(),
    webhookSecret: PintoSecretInputSchema,
    webhookPath: z.string().trim().min(1).default(DEFAULT_PINTO_WEBHOOK_PATH),
  })
  .strict();

const PintoChannelConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const value = { ...(raw as Record<string, unknown>) };
  if (
    value.webhookSecret === undefined &&
    value.webhookHeaderValue !== undefined
  ) {
    value.webhookSecret = value.webhookHeaderValue;
  }
  delete value.webhookHeaderValue;
  return value;
},
PintoAccountConfigSchema.extend({
  accounts: z.record(z.string(), PintoAccountConfigSchema.optional()).optional(),
  defaultAccount: z.string().trim().min(1).optional(),
}));

const generatePintoWebhookSecret = () =>
  `pinto-oc-${randomBytes(12).toString("hex")}`;

const normalizeWebhookSecret = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === "object") {
    const raw = (value as { value?: unknown }).value;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed || undefined;
    }
  }
  return undefined;
};

export const buildDefaultPintoChannelConfig = () => ({
  enabled: true,
  apiUrl: DEFAULT_PINTO_API_URL,
  botId: "",
  agentId: "",
  webhookSecret: generatePintoWebhookSecret(),
  webhookPath: DEFAULT_PINTO_WEBHOOK_PATH,
});

type PintoSetupInput = {
  name?: string;
  apiUrl?: string;
  botId?: string;
  agentId?: string;
  observerAgentIds?: string[];
  webhookSecret?: unknown;
  webhookPath?: string;
};

const getRawPintoChannelConfig = (cfg: any) => cfg?.channels?.pinto ?? {};

const hasTopLevelPintoConfig = (cfg: any) => {
  const channelConfig = getRawPintoChannelConfig(cfg);
  return Boolean(
    channelConfig &&
      typeof channelConfig === "object" &&
      !Array.isArray(channelConfig) &&
      (
        channelConfig.botId !== undefined ||
        channelConfig.agentId !== undefined ||
        channelConfig.observerAgentIds !== undefined ||
        channelConfig.webhookSecret !== undefined ||
        channelConfig.webhookHeaderValue !== undefined ||
        channelConfig.apiUrl !== undefined ||
        channelConfig.webhookPath !== undefined ||
        channelConfig.enabled !== undefined
      ),
  );
};

const listPintoAccountIds = (cfg: any): string[] => {
  const channelConfig = getRawPintoChannelConfig(cfg);
  const accountIds = Object.keys(channelConfig?.accounts ?? {});
  if (hasTopLevelPintoConfig(cfg) || accountIds.length === 0) {
    return Array.from(new Set([DEFAULT_ACCOUNT_ID, ...accountIds]));
  }
  return accountIds;
};

const resolveDefaultPintoAccountId = (cfg: any): string => {
  const channelConfig = getRawPintoChannelConfig(cfg);
  const configuredDefault = channelConfig?.defaultAccount?.trim();
  if (
    configuredDefault &&
    listPintoAccountIds(cfg).includes(configuredDefault)
  ) {
    return configuredDefault;
  }
  return DEFAULT_ACCOUNT_ID;
};

const getPintoChannelConfig = (cfg: any, accountId?: string | null) => {
  const resolvedAccountId = accountId ?? resolveDefaultPintoAccountId(cfg);
  const channelConfig = getRawPintoChannelConfig(cfg);
  const accountConfig = channelConfig.accounts?.[resolvedAccountId];
  const merged = {
    enabled: true,
    apiUrl: DEFAULT_PINTO_API_URL,
    webhookPath: DEFAULT_PINTO_WEBHOOK_PATH,
    ...(accountConfig ?? channelConfig),
  };

  if (
    merged.webhookSecret === undefined &&
    merged.webhookHeaderValue !== undefined
  ) {
    merged.webhookSecret = merged.webhookHeaderValue;
  }

  return {
    ...merged,
  };
};

const buildPintoHeaders = (webhookSecret?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = normalizeWebhookSecret(webhookSecret);
  if (secret) {
    headers["X-Pinto-Secret"] = secret;
  }
  return headers;
};

const getRequestHeader = (
  req: IncomingMessage,
  headerName: string,
): string | undefined => {
  const value = req.headers[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
};

const normalizeWebhookPath = (value: unknown): string => {
  const trimmed =
    typeof value === "string" ? value.trim() : DEFAULT_PINTO_WEBHOOK_PATH;
  if (!trimmed) {
    return DEFAULT_PINTO_WEBHOOK_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const normalizeObserverAgentIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : undefined;
};

async function sendPintoText(params: {
  cfg: any;
  accountId?: string | null;
  to: string;
  text: string;
}) {
  const account = getPintoChannelConfig(params.cfg, params.accountId);
  const apiUrl = stripTrailingSlash(
    account?.apiUrl ?? "https://api-dev.pinto-app.com",
  );
  const botId = account?.botId?.trim();
  const webhookSecret = normalizeWebhookSecret(account?.webhookSecret);
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
    headers: buildPintoHeaders(webhookSecret),
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
  reload: { configPrefixes: ["channels.pinto"] },
  configSchema: buildChannelConfigSchema(PintoChannelConfigSchema),
  security: {
    collectWarnings: ({ account }: { account: any }) => {
      const warnings: string[] = [];
      const webhookPath = normalizeWebhookPath(account?.config?.webhookPath);
      if (!account?.config?.botId?.trim()) {
        warnings.push(
          "Pinto botId is not configured. Set channels.pinto.botId to your real Pinto bot UUID.",
        );
      }
      if (!normalizeWebhookSecret(account?.config?.webhookSecret)) {
        warnings.push(
          "Pinto webhookSecret is empty. Set channels.pinto.webhookSecret or let setup generate one.",
        );
      }
      if (webhookPath !== (account?.config?.webhookPath?.trim() || webhookPath)) {
        warnings.push(
          `Pinto webhookPath should start with '/'. Use ${webhookPath} as channels.pinto.webhookPath.`,
        );
      }
      return warnings;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim() || DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({
      cfg,
      accountId,
      input,
    }: {
      cfg: any;
      accountId: string;
      input: PintoSetupInput;
    }) => {
      const resolved = getPintoChannelConfig(cfg, accountId);
      const inputWebhookSecret = normalizeWebhookSecret(input.webhookSecret);
      const resolvedWebhookSecret = normalizeWebhookSecret(
        resolved.webhookSecret,
      );
      const nextBotId =
        input.botId !== undefined
          ? input.botId.trim() || undefined
          : resolved.botId?.trim() || undefined;
      const nextAgentId =
        input.agentId !== undefined
          ? input.agentId.trim() || undefined
          : resolved.agentId?.trim() || undefined;
      const nextObserverAgentIds =
        input.observerAgentIds !== undefined
          ? normalizeObserverAgentIds(input.observerAgentIds)
          : normalizeObserverAgentIds(resolved.observerAgentIds);
      const nextWebhookPath =
        input.webhookPath !== undefined
          ? normalizeWebhookPath(input.webhookPath)
          : normalizeWebhookPath(resolved.webhookPath);
      return applySetupAccountConfigPatch({
        cfg,
        channelKey: "pinto",
        accountId,
        patch: {
          enabled: true,
          apiUrl:
            input.apiUrl?.trim() || resolved.apiUrl || DEFAULT_PINTO_API_URL,
          ...(nextBotId ? { botId: nextBotId } : {}),
          ...(nextAgentId ? { agentId: nextAgentId } : {}),
          ...(nextObserverAgentIds
            ? { observerAgentIds: nextObserverAgentIds }
            : {}),
          webhookSecret:
            (inputWebhookSecret ? input.webhookSecret : undefined) ||
            (resolvedWebhookSecret ? resolved.webhookSecret : undefined) ||
            generatePintoWebhookSecret(),
          webhookPath: nextWebhookPath,
        },
      });
    },
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    nativeCommands: false,
    reactions: false,
    threads: false,
  },

  config: {
    listAccountIds: (cfg: any) => listPintoAccountIds(cfg),
    defaultAccountId: (cfg: any) => resolveDefaultPintoAccountId(cfg),
    setAccountEnabled: ({
      cfg,
      accountId,
      enabled,
    }: {
      cfg: any;
      accountId: string;
      enabled: boolean;
    }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "pinto",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
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
      name: account.config?.botId?.trim() || "Pinto Default Bot",
      enabled: account.enabled,
      configured: Boolean(
        account.config?.apiUrl?.trim() && account.config?.botId?.trim(),
      ),
      botId: account.config?.botId?.trim() || null,
      agentId: account.config?.agentId?.trim() || null,
      observerAgentIds:
        normalizeObserverAgentIds(account.config?.observerAgentIds) || [],
      webhookPath:
        account.config?.webhookPath?.trim() || DEFAULT_PINTO_WEBHOOK_PATH,
    }),
  } as any,

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, cfg }) =>
      sendPintoText({ cfg, accountId, to, text }),

    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const account = getPintoChannelConfig(cfg, accountId);
      const apiUrl = stripTrailingSlash(
        account?.apiUrl ?? "https://api-dev.pinto-app.com",
      );
      const botId = account?.botId?.trim();
      const webhookSecret = normalizeWebhookSecret(account?.webhookSecret);

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
        headers: buildPintoHeaders(webhookSecret),
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
      const configuredBotId = account?.botId?.trim();
      const configuredAgentId = account?.agentId?.trim();
      const observerAgentIds =
        normalizeObserverAgentIds(account?.observerAgentIds)?.filter(
          (agentId) => agentId !== configuredAgentId,
        ) || [];
      const webhookPath = normalizeWebhookPath(account?.webhookPath);
      if (
        account?.enabled === false ||
        !account?.apiUrl?.trim() ||
        !configuredBotId
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
        path: webhookPath,
        auth: "plugin",
        replaceExisting: true,
        pluginId: "pinto",
        accountId: ctx.accountId,
        handler: async (req, res) => {
          try {
            if (req.method === "GET") {
              res.statusCode = 200;
              res.setHeader?.("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, channel: "pinto" }));
              return true;
            }

            const configuredSecret = normalizeWebhookSecret(
              account?.webhookSecret,
            );
            const inboundSecret = getRequestHeader(req, PINTO_SECRET_HEADER);
            if (configuredSecret && inboundSecret !== configuredSecret) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "Invalid webhook secret" }));
              return true;
            }

            const payload = await readJsonBody(req);
            if (!payload.bot_id || !payload.chat_id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing required fields" }));
              return true;
            }
            if (payload.bot_id !== configuredBotId) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: "Invalid bot_id for this account" }));
              return true;
            }

            ctx.setStatus?.({
              accountId: ctx.accountId,
              configuredBotId,
              configuredAgentId: configuredAgentId || null,
              configuredObserverAgentIds: observerAgentIds,
              webhookPath,
              lastInboundAt: Date.now(),
            });

            const peer = { kind: "direct", id: payload.chat_id };
            const route = configuredAgentId
              ? {
                  accountId: ctx.accountId,
                  sessionKey: ctx.channelRuntime.routing.buildAgentSessionKey({
                    agentId: configuredAgentId,
                    channel: "pinto",
                    accountId: ctx.accountId,
                    peer,
                  }),
                }
              : ctx.channelRuntime.routing.resolveAgentRoute({
                  cfg: ctx.cfg,
                  channel: "pinto",
                  accountId: ctx.accountId,
                  peer,
                });

            const buildMsgCtx = (sessionKey: string, accountId: string) =>
              ctx.channelRuntime.reply.finalizeInboundContext({
              Body: payload.message ?? "",
              RawBody: payload.message ?? "",
              CommandBody: payload.message ?? "",
              From: `pinto:${payload.user_id ?? payload.chat_id}`,
              To: `pinto:${payload.chat_id}`,
              SessionKey: sessionKey,
              AccountId: accountId,
              OriginatingChannel: "pinto",
              OriginatingTo: `pinto:${payload.chat_id}`,
              ChatType: "direct",
              SenderName:
                payload.username ?? payload.user_id ?? payload.chat_id,
              SenderId: payload.user_id ?? payload.chat_id,
              Provider: "pinto",
              Surface: "pinto",
              ConversationLabel: `Pinto: ${payload.chat_id}`,
              Timestamp: Date.now(),
              CommandAuthorized: true,
            });

            const msgCtx = buildMsgCtx(route.sessionKey, route.accountId);

            for (const observerAgentId of observerAgentIds) {
              const observerSessionKey =
                ctx.channelRuntime.routing.buildAgentSessionKey({
                  agentId: observerAgentId,
                  channel: "pinto",
                  accountId: ctx.accountId,
                  peer,
                });
              const observerCtx = buildMsgCtx(
                observerSessionKey,
                ctx.accountId,
              );

              // Observer agents share the inbound context but never reply back to Pinto.
              void ctx.channelRuntime.reply
                .dispatchReplyWithBufferedBlockDispatcher({
                  ctx: observerCtx,
                  cfg: ctx.cfg,
                  dispatcherOptions: {
                    deliver: async () => undefined,
                  },
                })
                .catch((error: any) => {
                  ctx.log?.warn?.(
                    `[PintoPlugin] Observer agent ${observerAgentId} failed: ${
                      error?.message ?? String(error)
                    }`,
                  );
                });
            }

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
