const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const API_GATEWAY_TOKEN = process.env.API_GATEWAY_TOKEN;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let sock;
let qrCodeString = '';
let connectionStatus = 'DISCONNECTED';
let deviceName = '';
let deviceNumber = '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeString = qr;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401 && statusCode !== 405;
            
            console.log(`Connection closed: ${lastDisconnect.error}. Reconnecting: ${shouldReconnect}`);
            
            connectionStatus = 'DISCONNECTED';
            qrCodeString = '';

            if (!shouldReconnect) {
                console.log('⚠️ Authentication failure or manual logout detected. Clearing session...');
                
                // Use a self-invoking async function or timeout to handle the async cleanup
                setTimeout(() => {
                    try {
                        if (fs.existsSync('auth_session')) {
                            const files = fs.readdirSync('auth_session');
                            for (const file of files) {
                                fs.rmSync(path.join('auth_session', file), { recursive: true, force: true });
                            }
                        }
                        console.log('✅ Session cleared. Restarting...');
                    } catch (err) {
                        console.error('⚠️ Session clear had some issues (EBUSY), but continuing:', err.message);
                    }
                    connectToWhatsApp();
                }, 1000); // 1 second delay to release file locks
            } else {
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
        const qrImage = await QRCode.toBuffer(qrCodeString);
        res.type('image/png').send(qrImage);
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR Code image' });
    }
});

app.post('/api/device', validateToken, (req, res) => {
    if (connectionStatus !== 'CONNECTED') {
        return res.status(400).json({ error: 'Device not connected' });
    }
    res.json({
        phoneNumber: deviceNumber,
        name: deviceName
    });
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
