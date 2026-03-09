import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { pintoPlugin, setPintoRuntime } from "./channel.js";
import { PintoWebhookPayload } from "./types.js";

/**
 * Pinto OpenClaw Plugin Entry Point
 */
const plugin = {
  id: "pinto",
  name: "Pinto Chat",
  description: "Plugin to connect Pinto Chat with OpenClaw AI Agents",

  register(api: OpenClawPluginApi) {
    // Shared runtime for utilities
    setPintoRuntime(api.runtime);

    // 1. Register the Pinto Channel
    api.registerChannel({
      plugin: pintoPlugin,
    });

    // 2. Register Webhook Listener
    // This endpoint receives messages FROM Pinto and forwards them to OpenClaw Agents
    api.registerHttpHandler?.({
      path: "/pinto/webhook",
      method: "POST",
      handler: async (req, res) => {
        try {
          const payload = req.body as PintoWebhookPayload;

          if (!payload.bot_id || !payload.chat_id) {
            return res.status(400).send({ error: "Missing required fields" });
          }

          // Forward to OpenClaw's internal processing pipeline
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
              ? [
                  {
                    type: "image",
                    url: payload.image_url,
                  },
                ]
              : [],
            metadata: {
              pinto_username: payload.username,
              pinto_api_key: payload.api_key,
            },
          });

          // Pinto expects a 200 OK (body can be empty for async)
          res.status(200).send({ message: "Message forwarded to agent" });
        } catch (error: any) {
          api.runtime.logger.error(
            `[PintoPlugin] Webhook error: ${error.message}`,
          );
          res.status(500).send({ error: "Internal Server Error" });
        }
      },
    });

    api.runtime.logger.info("Pinto Chat Plugin Registered successfully");
  },
};

export default plugin;
