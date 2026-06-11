import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ChannelPlugin,
  PluginRuntime as RuntimeEnv,
} from "openclaw/plugin-sdk/core";
import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";
import { applySetupAccountConfigPatch } from "openclaw/plugin-sdk/setup";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
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

const PintoChannelConfigSchema = z.preprocess(
  (raw) => {
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
    accounts: z
      .record(z.string(), PintoAccountConfigSchema.optional())
      .optional(),
    defaultAccount: z.string().trim().min(1).optional(),
  }),
);

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
  webhookSecret: "",
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
    (channelConfig.botId !== undefined ||
      channelConfig.agentId !== undefined ||
      channelConfig.observerAgentIds !== undefined ||
      channelConfig.webhookSecret !== undefined ||
      channelConfig.webhookHeaderValue !== undefined ||
      channelConfig.apiUrl !== undefined ||
      channelConfig.webhookPath !== undefined ||
      channelConfig.enabled !== undefined),
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

const findPintoAccountByBotId = (cfg: any, botId: string) => {
  const targetBotId = botId.trim();
  if (!targetBotId) return null;
  for (const accountId of listPintoAccountIds(cfg)) {
    const account = getPintoChannelConfig(cfg, accountId);
    if (account?.enabled === false) continue;
    if (account?.botId?.trim() === targetBotId) {
      return { accountId, account };
    }
  }
  return null;
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

const normalizePintoImageUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

type PintoResolvedImageUrl = {
  url: string;
  source: string;
};

const PINTO_DIRECT_IMAGE_URL_KEYS = [
  "image_url",
  "imageUrl",
  "media_url",
  "mediaUrl",
  "MediaUrl",
  "url",
] as const;

const PINTO_NESTED_IMAGE_URL_KEYS = [
  ...PINTO_DIRECT_IMAGE_URL_KEYS,
  "file_url",
  "fileUrl",
  "download_url",
  "downloadUrl",
  "href",
  "src",
] as const;

const PINTO_MEDIA_CONTAINER_KEYS = [
  "attachment",
  "attachments",
  "file",
  "files",
  "image",
  "images",
  "media",
  "medias",
] as const;

const PINTO_SENSITIVE_LOG_KEY_PATTERN =
  /(authorization|credential|password|secret|signature|token|webhook_secret|api[-_]?key)/i;
const PINTO_URL_LOG_KEY_PATTERN = /(href|src|uri|url)$/i;

const sanitizePintoLogString = (value: string, key?: string): string => {
  const trimmed = value.length > 500 ? `${value.slice(0, 500)}...` : value;

  if (!key || !PINTO_URL_LOG_KEY_PATTERN.test(key)) {
    return trimmed;
  }

  try {
    const parsed = new URL(value);
    const query = parsed.search ? "?[redacted-query]" : "";
    const hash = parsed.hash ? "#[redacted-fragment]" : "";
    return `${parsed.origin}${parsed.pathname}${query}${hash}`;
  } catch {
    return trimmed;
  }
};

const resolvePintoImageUrlFromValue = (
  value: unknown,
  source: string,
  depth = 0,
): PintoResolvedImageUrl | undefined => {
  if (depth > 5) {
    return undefined;
  }

  const stringUrl = normalizePintoImageUrl(value);
  if (stringUrl) {
    return { url: stringUrl, source };
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const resolved = resolvePintoImageUrlFromValue(
        item,
        `${source}[${index}]`,
        depth + 1,
      );
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of PINTO_NESTED_IMAGE_URL_KEYS) {
    const resolved = resolvePintoImageUrlFromValue(
      record[key],
      `${source}.${key}`,
      depth + 1,
    );
    if (resolved) {
      return resolved;
    }
  }

  for (const key of PINTO_MEDIA_CONTAINER_KEYS) {
    const resolved = resolvePintoImageUrlFromValue(
      record[key],
      `${source}.${key}`,
      depth + 1,
    );
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const resolvePintoInboundImageUrl = (
  payload: PintoWebhookPayload,
): PintoResolvedImageUrl | undefined => {
  const record = payload as unknown as Record<string, unknown>;
  for (const key of PINTO_DIRECT_IMAGE_URL_KEYS) {
    const resolved = resolvePintoImageUrlFromValue(record[key], key);
    if (resolved) {
      return resolved;
    }
  }

  for (const key of PINTO_MEDIA_CONTAINER_KEYS) {
    const resolved = resolvePintoImageUrlFromValue(record[key], key);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const sanitizePintoWebhookPayloadForLog = (
  value: unknown,
  depth = 0,
  key?: string,
): unknown => {
  if (depth > 5) {
    return "[max-depth]";
  }

  if (typeof value === "string") {
    return sanitizePintoLogString(value, key);
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, 20)
      .map((item) => sanitizePintoWebhookPayloadForLog(item, depth + 1, key));
    return value.length > 20
      ? [...sanitized, `[${value.length - 20} more items]`]
      : sanitized;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = PINTO_SENSITIVE_LOG_KEY_PATTERN.test(key)
      ? "[redacted]"
      : sanitizePintoWebhookPayloadForLog(item, depth + 1, key);
  }
  return sanitized;
};

const logPintoWebhookPayload = (
  log: any,
  payload: PintoWebhookPayload,
  imageUrl?: PintoResolvedImageUrl,
) => {
  const record = payload as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const isImageEvent =
    payload.message === "chat.sentImage" ||
    payload.image_url !== undefined ||
    payload.imageUrl !== undefined ||
    payload.media_url !== undefined ||
    payload.mediaUrl !== undefined ||
    payload.attachment !== undefined ||
    payload.attachments !== undefined ||
    payload.file !== undefined ||
    payload.files !== undefined ||
    payload.image !== undefined ||
    payload.images !== undefined ||
    payload.media !== undefined ||
    payload.medias !== undefined;

  log?.debug?.(
    `[PintoPlugin] Webhook payload keys: ${keys.join(", ") || "(none)"}`,
  );

  if (!isImageEvent) {
    return;
  }

  const sanitizedPayload = JSON.stringify(
    sanitizePintoWebhookPayloadForLog(payload),
  );

  if (imageUrl) {
    log?.info?.(
      `[PintoPlugin] Inbound image URL resolved from ${imageUrl.source}. Payload: ${sanitizedPayload}`,
    );
    return;
  }

  log?.warn?.(
    `[PintoPlugin] Inbound image payload has no supported media URL. Payload keys: ${keys.join(", ") || "(none)"}. Payload: ${sanitizedPayload}`,
  );
};

const inferPintoImageMimeType = (imageUrl: string): string | undefined => {
  let pathname = imageUrl;
  try {
    pathname = new URL(imageUrl).pathname;
  } catch {
    pathname = imageUrl.split(/[?#]/, 1)[0] ?? imageUrl;
  }

  const extension = pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "bmp":
      return "image/bmp";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return undefined;
  }
};

const buildPintoImageMediaContext = (imageUrlValue: unknown) => {
  const imageUrl = normalizePintoImageUrl(imageUrlValue);
  if (!imageUrl) {
    return {};
  }
  const mediaType = inferPintoImageMimeType(imageUrl) ?? "image/*";
  return {
    MediaUrl: imageUrl,
    MediaUrls: [imageUrl],
    MediaType: mediaType,
    MediaTypes: [mediaType],
  };
};

const stripPintoPrefix = (id: string) => id.replace(/^pinto:/, "");

const buildPintoApiError = async (res: Response) => {
  const detail = await res
    .text()
    .then((body) => body.trim())
    .catch(() => "");
  const detailSuffix = detail ? `: ${detail}` : "";
  return `Pinto API error: ${res.status} ${res.statusText}${detailSuffix}`;
};

type PintoReplyPayload = {
  text?: unknown;
  body?: unknown;
  mediaUrl?: unknown;
  mediaUrls?: unknown;
};

const resolvePintoReplyText = (payload: PintoReplyPayload) => {
  const text =
    typeof payload.text === "string"
      ? payload.text
      : typeof payload.body === "string"
        ? payload.body
        : "";
  const trimmed = text.trim();
  return trimmed || undefined;
};

const resolvePintoReplyMediaUrls = (payload: PintoReplyPayload) => {
  const mediaUrls = Array.isArray(payload.mediaUrls)
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];
  return mediaUrls
    .map((mediaUrl) => (typeof mediaUrl === "string" ? mediaUrl.trim() : ""))
    .filter(Boolean);
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
    chat_id: stripPintoPrefix(params.to),
    reply_message: params.text,
  };

  const res = await fetch(`${apiUrl}/v1/bots/webhook/receive`, {
    method: "POST",
    headers: buildPintoHeaders(webhookSecret),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await buildPintoApiError(res));
  }

  return { channel: "pinto", messageId: Date.now().toString() };
}

async function sendPintoMedia(params: {
  cfg: any;
  accountId?: string | null;
  to: string;
  text?: string;
  mediaUrl: string;
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
    chat_id: stripPintoPrefix(params.to),
    reply_message: params.text ?? "",
    media_url: params.mediaUrl,
  };

  const res = await fetch(`${apiUrl}/v1/bots/webhook/receive`, {
    method: "POST",
    headers: buildPintoHeaders(webhookSecret),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await buildPintoApiError(res));
  }

  return { channel: "pinto", messageId: Date.now().toString() };
}

async function deliverPintoReplyPayload(params: {
  cfg: any;
  accountId?: string | null;
  to: string;
  payload: PintoReplyPayload;
}) {
  const text = resolvePintoReplyText(params.payload);
  const mediaUrls = resolvePintoReplyMediaUrls(params.payload);

  if (mediaUrls.length > 0) {
    for (const [index, mediaUrl] of mediaUrls.entries()) {
      await sendPintoMedia({
        cfg: params.cfg,
        accountId: params.accountId,
        to: params.to,
        text: index === 0 ? text : undefined,
        mediaUrl,
      });
    }
    return;
  }

  if (!text) {
    return;
  }

  await sendPintoText({
    cfg: params.cfg,
    accountId: params.accountId,
    to: params.to,
    text,
  });
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
          "Pinto botId is not configured. Set channels.pinto.botId to the real Pinto bot id.",
        );
      }
      if (!normalizeWebhookSecret(account?.config?.webhookSecret)) {
        warnings.push(
          "Pinto webhookSecret is empty. Set channels.pinto.webhookSecret if you want webhook secret validation.",
        );
      }
      if (
        webhookPath !== (account?.config?.webhookPath?.trim() || webhookPath)
      ) {
        warnings.push(
          `Pinto webhookPath should start with '/'. Use ${webhookPath} as channels.pinto.webhookPath.`,
        );
      }
      return warnings;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) =>
      accountId?.trim() || DEFAULT_ACCOUNT_ID,
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
            "",
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

  agentPrompt: {
    messageToolHints: () => [
      "",
      "### Pinto Reply Behavior",
      "- For an inbound Pinto chat, reply with normal assistant text. The Pinto plugin automatically sends your final reply back to the current Pinto chat.",
      "- Do not call the Pinto API, include `bot_id`/`chat_id` JSON, or explain webhook delivery unless the user asks about integration details.",
      "- Keep Pinto replies concise and conversational. If you include media, use a public `mediaUrl`/`mediaUrls` payload when the channel tooling supports it.",
    ],
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
      if (!mediaUrl) {
        throw new Error("Pinto mediaUrl is not configured");
      }
      return sendPintoMedia({ cfg, accountId, to, text, mediaUrl });
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
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          try {
            if (req.method === "GET") {
              res.statusCode = 200;
              res.setHeader?.("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, channel: "pinto" }));
              return true;
            }

            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader?.("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method Not Allowed" }));
              return true;
            }

            const payload = await readJsonBody(req);
            if (!payload.bot_id || !payload.chat_id) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing required fields" }));
              return true;
            }

            const matched = findPintoAccountByBotId(ctx.cfg, payload.bot_id);
            if (!matched) {
              res.statusCode = 403;
              res.end(
                JSON.stringify({
                  error: "Invalid bot_id for configured Pinto accounts",
                }),
              );
              return true;
            }

            const targetAccountId = matched.accountId;
            const targetAccount = matched.account;
            const targetBotId = targetAccount?.botId?.trim();
            const targetAgentId = targetAccount?.agentId?.trim();
            const targetObserverAgentIds =
              normalizeObserverAgentIds(
                targetAccount?.observerAgentIds,
              )?.filter((agentId) => agentId !== targetAgentId) || [];

            const configuredSecret = normalizeWebhookSecret(
              targetAccount?.webhookSecret,
            );
            const inboundSecret = getRequestHeader(req, PINTO_SECRET_HEADER);
            if (configuredSecret && inboundSecret !== configuredSecret) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "Invalid webhook secret" }));
              return true;
            }

            ctx.setStatus?.({
              accountId: targetAccountId,
              configuredBotId: targetBotId,
              configuredAgentId: targetAgentId || null,
              configuredObserverAgentIds: targetObserverAgentIds,
              webhookPath,
              lastInboundAt: Date.now(),
            });

            const inboundImageUrl = resolvePintoInboundImageUrl(payload);
            logPintoWebhookPayload(ctx.log, payload, inboundImageUrl);

            const peer = { kind: "direct", id: payload.chat_id };
            const route = targetAgentId
              ? {
                  accountId: targetAccountId,
                  sessionKey: ctx.channelRuntime.routing.buildAgentSessionKey({
                    agentId: targetAgentId,
                    channel: "pinto",
                    accountId: targetAccountId,
                    peer,
                  }),
                }
              : ctx.channelRuntime.routing.resolveAgentRoute({
                  cfg: ctx.cfg,
                  channel: "pinto",
                  accountId: targetAccountId,
                  peer,
                });

            const buildMsgCtx = (sessionKey: string, accountId: string) =>
              ctx.channelRuntime.reply.finalizeInboundContext({
                Body: payload.message ?? "",
                BodyForAgent: payload.message ?? "",
                RawBody: payload.message ?? "",
                CommandBody: payload.message ?? "",
                BodyForCommands: payload.message ?? "",
                ...buildPintoImageMediaContext(inboundImageUrl?.url),
                From: `pinto:${payload.user_id ?? payload.chat_id}`,
                To: `pinto:${payload.chat_id}`,
                SessionKey: sessionKey,
                AccountId: accountId,
                OriginatingChannel: "pinto",
                OriginatingTo: `pinto:${payload.chat_id}`,
                ExplicitDeliverRoute: true,
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

            for (const observerAgentId of targetObserverAgentIds) {
              const observerSessionKey =
                ctx.channelRuntime.routing.buildAgentSessionKey({
                  agentId: observerAgentId,
                  channel: "pinto",
                  accountId: targetAccountId,
                  peer,
                });
              const observerCtx = buildMsgCtx(
                observerSessionKey,
                targetAccountId,
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
                  deliver: async (replyPayload: PintoReplyPayload) => {
                    await deliverPintoReplyPayload({
                      cfg: ctx.cfg,
                      accountId: targetAccountId,
                      to: payload.chat_id,
                      payload: replyPayload,
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
