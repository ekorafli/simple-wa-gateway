const { default: makeWASocket, DisconnectReason, delay, fetchLatestWaWebVersion } = require('@whiskeysockets/baileys');
const { usePostgresAuthState } = require('./db');
const pino = require('pino');
const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const API_GATEWAY_TOKEN = process.env.API_GATEWAY_TOKEN;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: connectionStatus, uptime: process.uptime() });
});

// Reject non-POST requests on /api/* routes with 405 Method Not Allowed
app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    next();
});

let sock;
let qrCodeString = '';
let connectionStatus = 'DISCONNECTED';
let deviceName = '';
let deviceNumber = '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await usePostgresAuthState();

    let version;
    try {
        const result = await fetchLatestWaWebVersion();
        version = result.version;
        console.log(`[WA] Using WhatsApp Web version: ${version.join('.')}`);
    } catch (err) {
        // Fallback to a known working version if fetch fails
        version = [2, 3000, 1036404385];
        console.log(`[WA] Failed to fetch latest version, using fallback: ${version.join('.')}`);
    }

    sock = makeWASocket({
        version,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeString = qr;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            connectionStatus = 'DISCONNECTED';
            qrCodeString = '';

            // Clear stale session on auth failures (401/405) and reconnect fresh
            if (statusCode === 401 || statusCode === 405) {
                console.log('[SESSION] Auth rejected by WhatsApp. Clearing stale session...');
                try {
                    const { usePostgresAuthState } = require('./db');
                    const auth = await usePostgresAuthState();
                    await auth.clearSession();
                    console.log('[SESSION] Session cleared successfully. Will reconnect for fresh QR...');
                } catch (err) {
                    console.error('[SESSION] Failed to clear session:', err.message);
                }
                // Wait before reconnecting to avoid rate-limiting and ensure DB is flushed
                console.log('[SESSION] Waiting 10s before reconnecting for fresh QR...');
                await delay(10000);
                connectToWhatsApp();
            } else if (shouldReconnect) {
                // Add a short delay before reconnecting to avoid hammering WhatsApp
                const reconnectDelay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;
                console.log(`[RECONNECT] Reconnecting in ${reconnectDelay / 1000}s...`);
                await delay(reconnectDelay);
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            connectionStatus = 'CONNECTED';
            qrCodeString = '';
            deviceName = sock.user.name || 'WhatsApp Device';
            deviceNumber = sock.user.id.split(':')[0];
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Middleware for token validation
const validateToken = (req, res, next) => {
    const { token } = req.body;

    if (!token) {
        console.log(`[AUTH] Unauthorized: No token provided in request body.`);
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    if (token !== process.env.API_GATEWAY_TOKEN) {
        const maskedReceived = token.substring(0, 4) + '...' + token.substring(token.length - 4);
        const expected = process.env.API_GATEWAY_TOKEN || '';
        const maskedExpected = expected.substring(0, 4) + '...' + expected.substring(expected.length - 4);
        console.log(`[AUTH] Unauthorized: Invalid token. Received: ${maskedReceived}, Expected: ${maskedExpected}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    next();
};

// Endpoints
app.post('/api/qrcode_image', validateToken, async (req, res) => {
    if (connectionStatus === 'CONNECTED') {
        return res.status(200).send('Device is already connected');
    }
    if (!qrCodeString) {
        return res.status(503).json({ error: 'QR Code not available yet, please wait or refresh' });
    }
    try {
        const qrDataURL = await QRCode.toDataURL(qrCodeString);
        res.type('text/html').send(`<img src="${qrDataURL}" alt="QR Code" />`);
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR Code image' });
    }
});

app.post('/api/device', validateToken, (req, res) => {
    if (connectionStatus !== 'CONNECTED') {
        const errorMsg = JSON.stringify({ result: 'false', message: 'Device not connected' }, null, 2);
        return res.status(400).type('text/html').send(errorMsg);
    }
    const response = JSON.stringify({
        result: 'true',
        phoneNumber: deviceNumber,
        name: deviceName
    }, null, 2);
    res.type('text/html').send(response);
});

app.post('/api/send_message', validateToken, async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) {
        return res.status(400).json({ error: 'Number and message are required' });
    }
    try {
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message', details: err.message });
    }
});

app.post('/api/send_image', validateToken, async (req, res) => {
    const { number, file } = req.body;
    if (!number || !file) {
        return res.status(400).json({ error: 'Number and file URL are required' });
    }
    try {
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, {
            image: { url: file },
            caption: req.body.caption || ''
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send image', details: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

connectToWhatsApp();
