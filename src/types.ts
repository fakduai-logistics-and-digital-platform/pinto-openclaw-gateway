/**
 * Pinto Request Payload (Inbound to OpenClaw)
 */
export interface PintoWebhookPayload {
  user_id: string;
  username?: string;
  message: string;
  image_url?: string;
  chat_id: string;
  bot_id: string;
  api_key?: string;
}

/**
 * Pinto Response Payload (Outbound to Pinto)
 */
export interface PintoWebhookReceiveRequest {
  bot_id: string;
  chat_id: string;
  reply_message: string;
  media_url?: string;
}

/**
 * Plugin Configuration
 */
export interface PintoPluginConfig {
  pintoApiUrl: string;
  pintoWebhookSecret?: string;
}
