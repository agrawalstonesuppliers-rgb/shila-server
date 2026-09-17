// Shila server — AI chat + visitor/lead capture for kotastone.co
// ---------------------------------------------------------------
// Two jobs:
//   1. POST /api/chat  -> Shila (Claude) answers visitor questions using the
//      site's real product knowledge (site-knowledge.txt).
//   2. POST /api/lead  -> saves visitor/lead data to Supabase, then emails
//      the owner and (optionally) sends a free WhatsApp alert via CallMeBot.
//
// See README.md for the one-time setup (API keys, Supabase, deploy).

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- CORS: only allow requests from your own site ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow no-origin requests (curl/health checks) and any listed origin
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error('Not allowed by CORS'));
    },
  })
);

// ---- Basic abuse protection ----
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 }); // 20 msgs/min/IP
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.use('/api/chat', chatLimiter);
app.use('/api/lead', leadLimiter);

// ---- Clients ----
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const mailTransport =
  process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })
    : null;

// ---- Site knowledge fed to Claude so answers are accurate ----
const SITE_KNOWLEDGE = fs.readFileSync(path.join(__dirname, 'site-knowledge.txt'), 'utf8');

const SYSTEM_PROMPT = `You are Shila, the friendly help-desk assistant for Agrawal Stone Suppliers
(kotastone.co), a Kota stone / sandstone / basalt supplier based in Ramganj Mandi, Kota, Rajasthan.

Business contact info (share when asked, or when a visitor wants a quote/sample):
- Phone: 92144-71749, 75973-03001, 8890120363
- Email: agrawalstonesuppliers@gmail.com
- Address: Khasra No. 1664/1247 & 1462, Industrial Area, Amarpura – Ramganj Mandi, Kota (Raj.)

Rules:
- Answer using ONLY the product/site knowledge below plus the contact info above. Do not invent
  prices, exact stock, or delivery timelines you don't have — instead offer to connect them with
  the team for an exact quote.
- Keep replies short (2-5 sentences), warm, and conversational — this is a chat widget, not an essay.
- Reply in the same language the visitor uses (Hindi, Hinglish, or English).
- Naturally try to learn the visitor's name, phone number (or WhatsApp), and what they need
  (stone type, quantity/area, city, timeline) over the course of the conversation, so the team can
  follow up. Don't interrogate — ask one question at a time, only when it fits naturally.
- If they share a phone number or clearly want a quote/sample/callback, tell them the team will
  reach out shortly.

SITE KNOWLEDGE:
${SITE_KNOWLEDGE}`;

// ---- POST /api/chat ----
// body: { message: string, history: [{role:'user'|'assistant', content:string}, ...] }
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }
    const trimmedHistory = Array.isArray(history) ? history.slice(-12) : [];
    const geminiHistory = trimmedHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const reply = result.response.text().trim();

    res.json({ reply });
  } catch (err) {
    console.error('chat error:', err.message);
    res.status(500).json({ error: 'Shila is having trouble right now. Please try again.' });
  }
});

// ---- POST /api/lead ----
// body: { name, phone, email, message, transcript: [...], page, source }
app.post('/api/lead', async (req, res) => {
  try {
    const { name, phone, email, message, transcript, page, source } = req.body || {};
    const hasTranscript = Array.isArray(transcript) && transcript.length > 0;
    if (!phone && !email && !message && !hasTranscript) {
      return res.status(400).json({ error: 'Provide at least a phone, email, message, or transcript.' });
    }

    const lead = {
      name: name || null,
      phone: phone || null,
      email: email || null,
      message: message || null,
      transcript: transcript || null,
      page: page || null,
      source: source || 'shila-widget',
      created_at: new Date().toISOString(),
    };

    if (supabase) {
      const { error } = await supabase.from('leads').insert(lead);
      if (error) console.error('supabase insert error:', error.message);
    } else {
      console.warn('Supabase not configured — lead not persisted:', lead);
    }

    // Only ping you instantly for leads that actually have a way to reach
    // them back — anonymous browsing chats are still saved above, just quietly.
    const isReachable = Boolean(phone || email);

    // Email notification
    if (isReachable && mailTransport && process.env.NOTIFY_EMAIL) {
      mailTransport
        .sendMail({
          from: process.env.GMAIL_USER,
          to: process.env.NOTIFY_EMAIL,
          subject: `New website lead${name ? ': ' + name : ''}`,
          text:
            `Name: ${name || '-'}\n` +
            `Phone: ${phone || '-'}\n` +
            `Email: ${email || '-'}\n` +
            `Message: ${message || '-'}\n` +
            `Page: ${page || '-'}\n\n` +
            `Transcript:\n${JSON.stringify(transcript || [], null, 2)}`,
        })
        .catch((e) => console.error('email send error:', e.message));
    }

    // Free WhatsApp alert via CallMeBot (see README for setup)
    if (isReachable && process.env.CALLMEBOT_PHONE && process.env.CALLMEBOT_APIKEY) {
      const text = encodeURIComponent(
        `New Shila lead: ${name || 'Unknown'} | ${phone || email || 'no contact'} | ${
          message || ''
        }`.slice(0, 300)
      );
      const url = `https://api.callmebot.com/whatsapp.php?phone=${process.env.CALLMEBOT_PHONE}&text=${text}&apikey=${process.env.CALLMEBOT_APIKEY}`;
      fetch(url).catch((e) => console.error('whatsapp alert error:', e.message));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('lead error:', err.message);
    res.status(500).json({ error: 'Could not save lead right now.' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Shila server listening on port ${PORT}`));
