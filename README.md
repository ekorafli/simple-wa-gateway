# 🚀 WhatsApp API Gateway

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![Docker Support](https://img.shields.io/badge/docker-supported-blue)](https://www.docker.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A high-performance, lightweight WhatsApp API Gateway built with **Express.js** and the **Baileys** library. Secure, containerized, and ready for production.

---

## 📖 Table of Contents
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Docker Deployment](#-docker-deployment)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Security](#-security)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features
- 🖼️ **QR Code Image API**: Retrieve connection QR codes directly via API.
- 📱 **Device Intelligence**: Get real-time status, device name, and phone number.
- 💬 **Messaging Engine**: High-reliability text message delivery.
- 📷 **Media Support**: Send images from remote URLs with custom captions.
- 🛡️ **Bearer Security**: Token-based authentication for all endpoints.
- 🐳 **Dockerized**: Fully containerized with persistent session management.

---

## ⚡ Quick Start

### Local Installation
1. **Clone & Install**:
   ```bash
   npm install
   ```
2. **Generate Security Token**:
   ```bash
   openssl rand -hex 32
   ```
3. **Configure Environment**:
   Create a `.env` file (see [Environment Variables](#-environment-variables)).
4. **Launch**:
   ```bash
   node index.js
   ```

---

## 🐳 Docker Deployment

Run the gateway in a stable, isolated environment using Docker Compose.

### Spin up a container
```bash
docker compose up -d
```

### Management Commands
| Action | Command |
| :--- | :--- |
| **View Logs** | `docker compose logs -f` |
| **Stop Service** | `docker compose down` |
| **Update/Rebuild** | `docker compose build --no-cache` |

> [!TIP]
> Your WhatsApp login persists across restarts because the `auth_session` directory is mapped to your host machine.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the server listens on | `3000` |
| `API_GATEWAY_TOKEN` | Secure hex token for authentication | *Required* |

---

## 📡 API Reference

> [!IMPORTANT]
> All endpoints expect `content-type: application/x-www-form-urlencoded`.

### 1. Get QR Code Image
**`POST /api/qrcode_image`**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `token` | `string` | Your security token |

**Example**:
```bash
curl -d "token=YOUR_TOKEN" -X POST http://localhost:3000/api/qrcode_image --output qrcode.png
```

### 2. Get Device Details
**`POST /api/device`**

**Response**:
```json
{
  "phoneNumber": "628123456789",
  "name": "Primary Device"
}
```

### 3. Send Message
**`POST /api/send_message`**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `token` | `string` | Security token |
| `number` | `string` | Recipient (e.g., `62812...`) |
| `message` | `string` | Content to send |

### 4. Send Image
**`POST /api/send_image`**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `token` | `string` | Security token |
| `file` | `string` | Public image URL |
| `caption` | `string` | (Optional) Image caption |

---

## 🔐 Security
- Access is restricted via the `API_GATEWAY_TOKEN`.
- It is highly recommended to use a complex 64-character hex string.
- When deploying to production, ensure this token is kept out of source control.

---

## 🛠️ Troubleshooting
- **Connection Issues**: If the device becomes unstable, delete the `auth_session` folder and restart the service to force a new QR generation.
- **Docker Logs**: Use `docker compose logs -f` to monitor connection events in real-time.

---
© 2026 WhatsApp API Gateway - Built for Speed & Reliability.
