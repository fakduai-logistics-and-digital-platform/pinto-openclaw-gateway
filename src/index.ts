import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { pintoPlugin, setPintoRuntime } from "./channel.js";
import { PintoWebhookPayload } from "./types.js";

const plugin = {
  id: "pinto",
  name: "Pinto Chat",
  description: "Plugin to connect Pinto Chat with OpenClaw AI Agents",

  register(api: OpenClawPluginApi) {
    const logger = api.runtime?.logger;

    setPintoRuntime(api.runtime);

    api.registerChannel({
      plugin: pintoPlugin,
    });

    (api as any).registerHttpRoute({
      path: "/pinto/webhook",
      auth: "plugin",
      match: "exact",
      handler: async (req: any, res: any) => {
        try {
          const payload = req.body as PintoWebhookPayload;

          if (!payload.bot_id || !payload.chat_id) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing required fields" }));
            return true;
          }

          await api.runtime.message.receive({
            channelId: "pinto",
            accountId: payload.bot_id,
            senderId: payload.user_id,
            targetId: payload.chat_id,
            content: {
              type: "text",
              text: payload.message,
            },
            attachments: payload.image_url
              ? [{ type: "image", url: payload.image_url }]
              : [],
            metadata: {
              pinto_username: payload.username,
              pinto_api_key: payload.api_key,
            },
          });

          res.statusCode = 200;
          res.end(JSON.stringify({ message: "Message forwarded to agent" }));
          return true;
        } catch (error: any) {
          logger?.error(`[PintoPlugin] Webhook error: ${error.message}`);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Internal Server Error" }));
          return true;
        }
      },
    });

    logger?.info("Pinto Chat Plugin Registered successfully");
  },
};

export default plugin;
