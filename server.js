const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'whatsapp123';

let client = null;
let qrBase64 = null;
let status = 'desconectado';
let ultimoErro = null;

function criarCliente() {
    if (client) { client.destroy().catch(() => {}); }
    qrBase64 = null;
    status = 'conectando';
    ultimoErro = null;

    const puppeteerOpts = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process']
    };
    // Find Chrome
    const chromePaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/opt/render/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium'
    ];
    for (const p of chromePaths) {
        if (p && fs.existsSync(p)) { puppeteerOpts.executablePath = p; break; }
    }
    // Check node_modules puppeteer
    if (!puppeteerOpts.executablePath) {
        try {
            const pp = require('puppeteer');
            const ep = pp.executablePath();
            if (fs.existsSync(ep)) puppeteerOpts.executablePath = ep;
        } catch(e) {}
    }

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: puppeteerOpts
    });

    client.on('qr', async qr => {
        try { qrBase64 = await qrcode.toDataURL(qr); } catch(e) { qrBase64 = null; }
        status = 'aguardando_qr';
    });

    client.on('ready', () => {
        status = 'conectado';
        qrBase64 = null;
        ultimoErro = null;
        console.log('WhatsApp conectado!');
    });

    client.on('disconnected', motivo => {
        status = 'desconectado';
        qrBase64 = null;
        ultimoErro = motivo;
        console.log('WhatsApp desconectado:', motivo);
        setTimeout(criarCliente, 5000);
    });

    client.on('auth_failure', msg => {
        status = 'erro';
        ultimoErro = msg;
        console.log('Falha na autenticação:', msg);
    });

    client.initialize().catch(e => { console.log('Erro ao iniciar:', e); });
}

function auth(req, res, next) {
    const key = req.headers['x-api-key'];
    if (key !== API_KEY) return res.status(401).json({ erro: 'API key inválida' });
    next();
}

app.get('/health', (req, res) => res.json({ ok: true, status }));

app.get('/qr', (req, res) => {
    res.json({ status, qr: qrBase64, erro: ultimoErro });
});

app.get('/status', (req, res) => {
    res.json({ status, conectado: client ? client.info ? { numero: client.info.wid.user, nome: client.info.pushname } : null : null, erro: ultimoErro });
});

app.post('/send', auth, async (req, res) => {
    const { telefone, mensagem } = req.body;
    if (!telefone || !mensagem) return res.status(400).json({ erro: 'telefone e mensagem obrigatórios' });
    if (!client || status !== 'conectado') return res.status(400).json({ erro: 'WhatsApp não conectado' });
    try {
        const numero = telefone.replace(/\D/g, '');
        const chatId = numero.includes('@c.us') ? numero : `${numero}@c.us`;
        await client.sendMessage(chatId, mensagem);
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ erro: e.message });
    }
});

app.post('/connect', auth, (req, res) => {
    criarCliente();
    res.json({ ok: true, status: 'conectando' });
});

app.post('/disconnect', auth, (req, res) => {
    if (client) { client.destroy().catch(() => {}); client = null; }
    status = 'desconectado';
    qrBase64 = null;
    res.json({ ok: true });
});

criarCliente();

app.listen(PORT, () => console.log(`WhatsApp service rodando na porta ${PORT}`));
