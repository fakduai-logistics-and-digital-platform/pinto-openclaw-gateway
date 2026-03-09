# Pinto OpenClaw Gateway Plugin

This is a **Channel Plugin** for [OpenClaw](https://openclaw.ai) that enables seamless integration with the Pinto Chat platform.

## Installation

### Via OpenClaw CLI (Recommended)

```bash
openclaw plugins install pinto-openclaw-gateway
```

### Via npm

```bash
npm install pinto-openclaw-gateway
```

### Manual Installation (Development)

1. Clone the repository:
    ```bash
    git clone https://github.com/fakduai-logistics-and-digital-platform/pinto-openclaw-gateway.git
    cd pinto-openclaw-gateway
    ```

2. Install dependencies and build:
    ```bash
    npm install
    npm run build
    ```

3. Install to OpenClaw:
    ```bash
    openclaw plugins install .
    ```

## Configuration

In your `openclaw.config.json` (or via the UI), enable the `pinto` extension and provide the `pintoApiUrl`:

```json
{
  "channels": {
    "pinto": {
      "enabled": true,
      "accounts": {
        "default": {
          "pintoApiUrl": "https://api.pinto-app.com",
          "pintoWebhookSecret": "your-secret-key"
        }
      }
    }
  }
}
```

## Setup Bot in Pinto

Set the Bot's Webhook URL to:
```
http://<your-openclaw-ip>:3000/plugins/pinto/webhook
```

## Features

- **Asynchronous Communication:** Supports long-running AI tasks without timing out.
- **Typing Indicators:** Automatically shows "Bot is typing..." in Pinto while OpenClaw is processing.
- **Media Support:** Seamlessly handle images/media between both platforms.
- **Multi-Instance Support:** Each Bot in Pinto can point to a different OpenClaw instance with its own API Key.

## Tech Stack

- TypeScript
- OpenClaw Plugin SDK
- Node.js Fetch API

## License

MIT
