# pinto-app-openclaw

[ภาษาไทย](#ภาษาไทย) | [English](#english)

OpenClaw channel plugin for Pinto Chat. It receives webhook events from Pinto, forwards them to an OpenClaw agent, and sends the final reply back to Pinto.

## ภาษาไทย

### ภาพรวม

`pinto-app-openclaw` คือ OpenClaw channel plugin สำหรับเชื่อมต่อ Pinto Chat กับ OpenClaw agent

flow การทำงาน:

1. ผู้ใช้ส่งข้อความใน Pinto
2. Pinto API เรียก webhook ของ OpenClaw ที่ `/plugins/pinto/webhook`
3. ปลั๊กอินส่งข้อความเข้า agent ใน OpenClaw
4. เมื่อ agent ตอบกลับ ปลั๊กอินจะส่งข้อความกลับไปที่ Pinto ผ่าน `POST /v1/bots/webhook/receive`

ความสามารถหลัก:

- รองรับ direct chat
- รองรับข้อความตอบกลับพร้อม `media_url`
- รองรับ `Webhook Secret` ผ่าน header `X-Pinto-Secret`
- ตั้งค่าได้ผ่านหน้า `Channels > Pinto Chat` ใน OpenClaw

### สิ่งที่ต้องมี

- OpenClaw ที่รันได้แล้ว
- Node.js 20+ และ npm
- Pinto bot ที่สร้างไว้แล้ว
- Bot UUID จริงของ Pinto
- Pinto API base URL ที่ถูกต้อง เช่น `https://api.pinto-app.com`
- URL ที่ Pinto เข้าถึง OpenClaw ได้จริง เช่น domain, reverse proxy, Tailscale, tunnel

### การติดตั้ง

#### ติดตั้งผ่าน OpenClaw package name

วิธีที่แนะนำ:

```bash
openclaw plugins install pinto-app-openclaw
```

#### ติดตั้งจาก source ในเครื่อง

```bash
git clone https://github.com/fakduai-logistics-and-digital-platform/pinto-openclaw-gateway.git
cd pinto-openclaw-gateway
npm install
npm run build
openclaw plugins install .
```

#### ติดตั้งแบบคัดลอกไฟล์เอง

ถ้าคุณ deploy แบบ manual ให้คัดลอกไฟล์เหล่านี้ไปยัง OpenClaw extensions directory:

- `dist/`
- `openclaw.plugin.json`
- `package.json`
- `README.md`

ตัวอย่างปลายทาง:

```bash
~/.openclaw/extensions/pinto-app-openclaw
```

### การตั้งค่าใน OpenClaw

สามารถตั้งค่าได้สองแบบ:

- ผ่าน OpenClaw UI ที่ `Channels > Pinto Chat`
- ผ่าน config file ของ OpenClaw

ค่าที่ต้องกรอก:

- `Api Url`
  - Pinto API base URL
  - ใส่ได้ทั้งแบบมี `/` ท้ายหรือไม่มี `/` ท้าย
  - ตัวอย่าง `https://api.pinto-app.com`
- `Bot Id`
  - ต้องเป็น Bot UUID จริงของ Pinto
  - ไม่ใช่ `bot_id` แบบ slug
- `Enabled`
  - เปิดหรือปิด channel
- `Webhook Secret`
  - secret ที่ใช้ร่วมกับ header `X-Pinto-Secret`
  - ถ้าไม่ได้ตั้งค่าไว้ ระบบจะไม่บังคับตรวจ secret ขาเข้า
- `Webhook Path`
  - path ของ webhook endpoint บน OpenClaw
  - ค่าเริ่มต้นคือ `/plugins/pinto/webhook`
  - ใช้ path นี้ไปประกอบกับ public base URL ของ OpenClaw เพื่อเอาไปตั้งใน Pinto

หลังติดตั้งและเปิด setup ของ channel:

- ระบบจะเติมค่าเริ่มต้น `enabled: true`
- ระบบจะเติม `apiUrl` เป็น `https://api.pinto-app.com`
- ระบบจะ generate `webhookHeaderValue` ให้ 1 ค่าอัตโนมัติ
- ระบบจะเติม `webhookPath` เป็น `/plugins/pinto/webhook`
- ผู้ใช้ยังต้องกรอก `botId` เองจาก Pinto bot จริง

ตัวอย่าง config:

```json
{
  "channels": {
    "pinto": {
      "enabled": true,
      "apiUrl": "https://api.pinto-app.com",
      "botId": "20387880-7934-40c3-b7d4-9fa6557697cf",
      "webhookHeaderValue": "pinto-oc-9f3a1b7c5d2e8k4m",
      "webhookPath": "/plugins/pinto/webhook"
    }
  }
}
```

หมายเหตุ:

- channel id ของปลั๊กอินคือ `pinto`
- package name คือ `pinto-app-openclaw`

### การตั้งค่าฝั่ง Pinto

Pinto bot ต้องมีข้อมูลต่อไปนี้:

- `webhook_url`
  - URL ที่ Pinto จะยิงเข้ามา
  - ตัวอย่าง:
  - `https://your-host.example.com/plugins/pinto/webhook`
- วิธีประกอบค่า:
  - `webhook_url = <public-openclaw-base-url> + <Webhook Path>`
  - ตัวอย่างเช่น ถ้า OpenClaw เปิดผ่าน `https://bot.example.com` และ `Webhook Path` เป็น `/plugins/pinto/custom-webhook`
  - ให้ใส่ `https://bot.example.com/plugins/pinto/custom-webhook`
- Bot UUID
  - ใช้ค่า `_id` ของ bot เป็นค่า `Bot Id` ใน OpenClaw
- ถ้ามีการเปิดใช้ secret
  - Pinto ต้องส่ง header `X-Pinto-Secret` เข้ามา
  - ค่า secret ต้องตรงกับ `Webhook Secret` ใน OpenClaw

### Webhook Secret

ปลั๊กอินรองรับ `Webhook Secret` ทั้ง inbound และ outbound

#### Inbound: Pinto -> OpenClaw

ถ้ามีการตั้ง `Webhook Secret` ใน OpenClaw:

- Pinto ต้องส่ง header:

```http
X-Pinto-Secret: <your-secret>
```

- ถ้าค่าไม่ตรง ปลั๊กอินจะตอบ `401 Unauthorized`

ถ้าไม่ได้ตั้ง `Webhook Secret`:

- ปลั๊กอินจะไม่บังคับตรวจ secret ขาเข้า

#### Outbound: OpenClaw -> Pinto

เมื่อปลั๊กอินส่งข้อความกลับไป Pinto ที่:

```http
POST <apiUrl>/v1/bots/webhook/receive
```

ปลั๊กอินจะส่ง header นี้ให้อัตโนมัติ ถ้ามีการตั้ง `Webhook Secret`:

```http
X-Pinto-Secret: <your-secret>
```

### Endpoint ที่เกี่ยวข้อง

#### Inbound webhook

Pinto จะเรียก:

```http
POST /plugins/pinto/webhook
```

ตัวอย่าง request body:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "message": "hello",
  "user_id": "a7c3fe36-cf41-42b5-a290-ca98e6129fac",
  "username": "demo-user"
}
```

#### Outbound reply

ปลั๊กอินจะส่ง:

```http
POST <apiUrl>/v1/bots/webhook/receive
```

ตัวอย่าง body:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "reply_message": "สวัสดีจาก OpenClaw"
}
```

ตัวอย่างเมื่อมี media:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "reply_message": "ดูรูปนี้",
  "media_url": "https://example.com/image.png"
}
```

### วิธีเชื่อมต่อแบบแนะนำ

1. ติดตั้งปลั๊กอินด้วย:

```bash
openclaw plugins install pinto-app-openclaw
```

2. รีสตาร์ต OpenClaw หรือ reload plugins
3. เปิดหน้า `Channels > Pinto Chat`
4. กรอก `Api Url`, `Bot Id`, `Webhook Secret`
5. กด `Save`
6. ตั้งค่า `webhook_url` ของ Pinto bot ให้ชี้มาที่ `/plugins/pinto/webhook`
7. ทดสอบ webhook ก่อนด้วย `curl`
8. ส่งข้อความจริงจาก Pinto
9. ตรวจว่า OpenClaw ตอบกลับเข้า Pinto ได้

### การทดสอบ

#### ทดสอบ inbound แบบ local

```bash
curl -i -X POST http://127.0.0.1:18789/plugins/pinto/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "message":"hello",
    "user_id":"a7c3fe36-cf41-42b5-a290-ca98e6129fac"
  }'
```

response ที่คาดหวัง:

```json
{"message":"Message forwarded to agent"}
```

#### ทดสอบ inbound แบบ public URL

```bash
curl -i -X POST https://your-host.example.com/plugins/pinto/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "message":"hello",
    "user_id":"a7c3fe36-cf41-42b5-a290-ca98e6129fac"
  }'
```

#### ทดสอบ outbound ตรงไปที่ Pinto API

```bash
curl -i -X POST https://api.pinto-app.com/v1/bots/webhook/receive \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "reply_message":"OpenClaw outbound test"
  }'
```

### Troubleshooting

#### 404 Not Found

สาเหตุที่พบบ่อย:

- เปิด URL ผ่าน browser ด้วย `GET` แทน `POST`
- reverse proxy หรือ tunnel ไม่ได้ forward มาที่ OpenClaw gateway
- path ไม่ถูก ต้องใช้ `/plugins/pinto/webhook`

#### 401 Unauthorized

สาเหตุที่พบบ่อย:

- ค่า `X-Pinto-Secret` ไม่ตรงกัน
- Pinto ส่ง secret มาไม่ตรงกับ `Webhook Secret` ใน OpenClaw
- OpenClaw ส่ง secret กลับไป Pinto ไม่ตรงกับค่าที่ Pinto คาดไว้

#### 400 Invalid request body

สาเหตุที่พบบ่อย:

- `Bot Id` ไม่ใช่ UUID จริง
- `chat_id` อยู่คนละ environment
- payload ที่ส่งไป `POST /v1/bots/webhook/receive` ไม่ตรงกับ backend Pinto

#### ไม่เห็นข้อความตอบกลับใน Pinto

ตรวจตามนี้:

- `Api Url` ถูก environment หรือไม่
- `Bot Id` ถูกต้องหรือไม่
- `chat_id` เป็นห้องจริงหรือไม่
- Pinto API รับ `POST /v1/bots/webhook/receive` สำเร็จหรือไม่
- `X-Pinto-Secret` ตรงกันทั้งสองฝั่งหรือไม่

### การพัฒนา

```bash
npm install
npm run build
npm test
```

## English

### Overview

`pinto-app-openclaw` is an OpenClaw channel plugin for Pinto Chat.

Flow:

1. A user sends a message in Pinto
2. Pinto calls the OpenClaw webhook at `/plugins/pinto/webhook`
3. The plugin forwards the message to an OpenClaw agent
4. The plugin sends the final reply back to Pinto through `POST /v1/bots/webhook/receive`

Main features:

- Direct chat support
- Optional `media_url` in replies
- `Webhook Secret` support via `X-Pinto-Secret`
- OpenClaw UI configuration in `Channels > Pinto Chat`

### Requirements

- A working OpenClaw instance
- Node.js 20+ and npm
- An existing Pinto bot
- The real Pinto bot UUID
- A valid Pinto API base URL such as `https://api.pinto-app.com`
- A public or reachable URL that Pinto can call

### Installation

#### Install by package name

Recommended:

```bash
openclaw plugins install pinto-app-openclaw
```

#### Install from local source

```bash
git clone https://github.com/fakduai-logistics-and-digital-platform/pinto-openclaw-gateway.git
cd pinto-openclaw-gateway
npm install
npm run build
openclaw plugins install .
```

#### Manual deployment

If you deploy by copying files manually, copy these files into the OpenClaw extensions directory:

- `dist/`
- `openclaw.plugin.json`
- `package.json`
- `README.md`

Example destination:

```bash
~/.openclaw/extensions/pinto-app-openclaw
```

### OpenClaw Configuration

You can configure the plugin either:

- In the OpenClaw UI at `Channels > Pinto Chat`
- In the OpenClaw config file

Fields:

- `Api Url`
  - Pinto API base URL
  - With or without a trailing slash is supported
- `Bot Id`
  - Must be the real Pinto bot UUID
  - Do not use the human-readable bot slug
- `Enabled`
  - Enables or disables the channel
- `Webhook Secret`
  - Shared secret used with `X-Pinto-Secret`
  - If empty, inbound secret validation is not enforced

Example config:

```json
{
  "channels": {
    "pinto": {
      "enabled": true,
      "apiUrl": "https://api.pinto-app.com",
      "botId": "20387880-7934-40c3-b7d4-9fa6557697cf",
      "webhookHeaderValue": "pinto-oc-9f3a1b7c5d2e8k4m"
    }
  }
}
```

Notes:

- The channel id is `pinto`
- The package name is `pinto-app-openclaw`

### Pinto Configuration

Your Pinto bot must have:

- `webhook_url`
  - The URL Pinto calls
  - Example:
  - `https://your-host.example.com/plugins/pinto/webhook`
- Bot UUID
  - Use the bot `_id` as `Bot Id` in OpenClaw
- If webhook security is enabled
  - Pinto must send `X-Pinto-Secret`
  - The value must match the OpenClaw `Webhook Secret`

### Webhook Secret

The plugin supports `Webhook Secret` for both inbound and outbound requests.

#### Inbound: Pinto -> OpenClaw

If `Webhook Secret` is configured in OpenClaw:

- Pinto must send:

```http
X-Pinto-Secret: <your-secret>
```

- If the value does not match, the plugin returns `401 Unauthorized`

If no `Webhook Secret` is configured:

- The plugin does not enforce inbound secret validation

#### Outbound: OpenClaw -> Pinto

When the plugin sends replies back to Pinto through:

```http
POST <apiUrl>/v1/bots/webhook/receive
```

it automatically includes:

```http
X-Pinto-Secret: <your-secret>
```

when `Webhook Secret` is configured.

### Relevant Endpoints

#### Inbound webhook

Pinto calls:

```http
POST /plugins/pinto/webhook
```

Example request body:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "message": "hello",
  "user_id": "a7c3fe36-cf41-42b5-a290-ca98e6129fac",
  "username": "demo-user"
}
```

#### Outbound reply

The plugin sends:

```http
POST <apiUrl>/v1/bots/webhook/receive
```

Example body:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "reply_message": "Hello from OpenClaw"
}
```

Media example:

```json
{
  "bot_id": "20387880-7934-40c3-b7d4-9fa6557697cf",
  "chat_id": "5f315d4e-cf22-4054-bbb0-2fe074bd3892",
  "reply_message": "See this image",
  "media_url": "https://example.com/image.png"
}
```

### Recommended Setup Flow

1. Install the plugin with:

```bash
openclaw plugins install pinto-app-openclaw
```

2. Restart OpenClaw or reload plugins
3. Open `Channels > Pinto Chat`
4. Fill in `Api Url`, `Bot Id`, and `Webhook Secret`
5. Save the channel config
6. Set the Pinto bot `webhook_url` to `/plugins/pinto/webhook`
7. Test the webhook with `curl`
8. Send a real message from Pinto
9. Confirm that OpenClaw replies back into Pinto

### Testing

#### Local inbound test

```bash
curl -i -X POST http://127.0.0.1:18789/plugins/pinto/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "message":"hello",
    "user_id":"a7c3fe36-cf41-42b5-a290-ca98e6129fac"
  }'
```

Expected response:

```json
{"message":"Message forwarded to agent"}
```

#### Public inbound test

```bash
curl -i -X POST https://your-host.example.com/plugins/pinto/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "message":"hello",
    "user_id":"a7c3fe36-cf41-42b5-a290-ca98e6129fac"
  }'
```

#### Direct outbound test to Pinto API

```bash
curl -i -X POST https://api.pinto-app.com/v1/bots/webhook/receive \
  -H 'Content-Type: application/json' \
  -H 'X-Pinto-Secret: pinto-oc-9f3a1b7c5d2e8k4m' \
  -d '{
    "bot_id":"20387880-7934-40c3-b7d4-9fa6557697cf",
    "chat_id":"5f315d4e-cf22-4054-bbb0-2fe074bd3892",
    "reply_message":"OpenClaw outbound test"
  }'
```

### Troubleshooting

#### 404 Not Found

Common causes:

- Opening the webhook URL in a browser with `GET` instead of `POST`
- Your reverse proxy or tunnel is not forwarding to OpenClaw
- The path is wrong. Use `/plugins/pinto/webhook`

#### 401 Unauthorized

Common causes:

- `X-Pinto-Secret` does not match
- Pinto sends the wrong secret to OpenClaw
- OpenClaw sends the wrong secret back to Pinto

#### 400 Invalid request body

Common causes:

- `Bot Id` is not a real UUID
- `chat_id` belongs to a different environment
- The payload sent to `POST /v1/bots/webhook/receive` does not match Pinto backend expectations

#### No reply appears in Pinto

Check:

- `Api Url` points to the correct environment
- `Bot Id` is correct
- `chat_id` is a real chat
- Pinto API accepts `POST /v1/bots/webhook/receive`
- `X-Pinto-Secret` matches on both sides

### Development

```bash
npm install
npm run build
npm test
```
