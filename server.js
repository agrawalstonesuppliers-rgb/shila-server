/* ==========================================================================
   Shila server — chat backend for kotastone.co
   Agrawal Stone Suppliers

   What this does:
   - POST /api/chat  -> answers a visitor's question using OpenAI, grounded
     in site-knowledge.txt (the site's own product/rate/policy info)
   - POST /api/lead  -> saves a visitor's contact details + transcript to
     Supabase, and sends an email alert (and WhatsApp alert, if configured)
     to the owner
   - GET  /          -> simple health check, so you can tell at a glance
     whether the server is alive by visiting the URL directly
   - GET  /health    -> same, as JSON

   NOTE on provider: this uses OpenAI instead of Gemini. Google's Gemini API
   is currently issuing a new "AQ." key format that is being rejected by
   Google's own generativelanguage.googleapis.com endpoint with a
   401 ACCESS_TOKEN_TYPE_UNSUPPORTED error, for many developer accounts
   including this one — confirmed even with a brand-new Google Cloud
   project. This is a known, currently-unresolved issue on Google's side,
   not something fixable from this codebase. OpenAI's API keys (sk-...) do
   not have this problem.
   ========================================================================== */

'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// ---------------------------------------------------------------------------
// Environment variables (set these in Render → your service → Environment)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const GMAIL_USER = process.env.GMAIL_USER || 'agrawalstonesuppliers@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || GMAIL_USER;

const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY;   // optional — WhatsApp alerts
const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;     // optional — e.g. 918890120363

// Comma-separated list, e.g. "https://kotastone.co,https://www.kotastone.co"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://kotastone.co,https://www.kotastone.co')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is not set. /api/chat will not work until it is.');
}

// ---------------------------------------------------------------------------
// Site knowledge — everything Shila knows about the business
// ---------------------------------------------------------------------------
let SITE_KNOWLEDGE = '';
try {
  SITE_KNOWLEDGE = fs.readFileSync(path.join(__dirname, 'site-knowledge.txt'), 'utf8');
} catch (e) {
  console.error('WARNING: could not read site-knowledge.txt — Shila will have no product knowledge.', e.message);
}

const SYSTEM_PROMPT =
  'You are Shila, the friendly help-desk assistant for Agrawal Stone Suppliers ' +
  '(kotastone.co), a Kota stone and sandstone supplier based in Ramganjmandi, Kota, Rajasthan. ' +
  'Answer visitor questions about rates, sizes, grades, finishes, delivery, and anything else ' +
  'using ONLY the information below. If you genuinely do not know something from this ' +
  'information, say so honestly and suggest the visitor ask on WhatsApp or the contact page — ' +
  'never invent a rate, size, or fact that is not in this information. ' +
  'Keep answers short, warm, and conversational — a few sentences, not an essay. ' +
  'If the visitor writes in Hindi, reply in Hindi.\n\n' +
  '--- SITE INFORMATION ---\n' + SITE_KNOWLEDGE;

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

async function askAI(message, history) {
  if (!openai) { throw new Error('OpenAI is not configured (missing OPENAI_API_KEY)'); }

  // Client sends history as [{role: 'user'|'assistant', content: '...'}, ...],
  // which is already exactly the shape OpenAI's chat API wants.
  var messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  (history || []).forEach(function (m) {
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    });
  });
  messages.push({ role: 'user', content: message });

  var completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: messages
  });

  var text = completion && completion.choices && completion.choices[0] &&
    completion.choices[0].message && completion.choices[0].message.content;
  if (!text) { throw new Error('Empty response from OpenAI'); }
  return text;
}

// ---------------------------------------------------------------------------
// Supabase (lead storage) — optional; lead saving is skipped if not configured
// ---------------------------------------------------------------------------
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  var { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
  console.error('WARNING: SUPABASE_URL / SUPABASE_SERVICE_KEY not set — leads will not be saved.');
}

async function saveLead(lead) {
  if (!supabase) { return; }
  var { error } = await supabase.from('leads').insert([{
    page: lead.page || null,
    name: lead.name || null,
    phone: lead.phone || null,
    email: lead.email || null,
    transcript: lead.transcript || null,
    source: lead.source || 'shila-widget',
    created_at: new Date().toISOString()
  }]);
  if (error) { console.error('Supabase insert error:', error.message); }
}

// ---------------------------------------------------------------------------
// Email alert (Gmail) — optional; skipped if not configured
// ---------------------------------------------------------------------------
let mailTransport = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  var nodemailer = require('nodemailer');
  mailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
} else {
  console.error('WARNING: GMAIL_USER / GMAIL_APP_PASSWORD not set — email alerts are off.');
}

async function emailAlert(lead) {
  if (!mailTransport) { return; }
  var lines = (lead.transcript || [])
    .map(function (m) { return (m.role === 'user' ? 'Visitor: ' : 'Shila: ') + m.content; })
    .join('\n');
  try {
    await mailTransport.sendMail({
      from: GMAIL_USER,
      to: NOTIFY_EMAIL,
      subject: 'New Shila lead' + (lead.name ? ' — ' + lead.name : ''),
      text:
        'Page: ' + (lead.page || '-') + '\n' +
        'Name: ' + (lead.name || '-') + '\n' +
        'Phone: ' + (lead.phone || '-') + '\n' +
        'Email: ' + (lead.email || '-') + '\n\n' +
        'Transcript:\n' + lines
    });
  } catch (e) {
    console.error('Email alert failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// WhatsApp alert (CallMeBot) — optional; skipped if not configured
// ---------------------------------------------------------------------------
async function whatsappAlert(lead) {
  if (!CALLMEBOT_APIKEY || !CALLMEBOT_PHONE) { return; }
  var text = 'New Shila lead: ' + (lead.name || 'unnamed') +
    (lead.phone ? ' / ' + lead.phone : '') +
    (lead.email ? ' / ' + lead.email : '') +
    ' — page: ' + (lead.page || '-');
  var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(CALLMEBOT_PHONE) +
    '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
  try {
    await fetch(url);
  } catch (e) {
    console.error('WhatsApp alert failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: function (origin, callback) {
    // allow no-origin requests (curl, server-to-server health checks)
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) { return callback(null, true); }
    return callback(new Error('Not allowed by CORS: ' + origin));
  }
}));

app.get('/', function (req, res) {
  res.json({ ok: true, service: 'shila-server', time: new Date().toISOString() });
});

app.get('/health', function (req, res) {
  res.json({
    ok: true,
    openai: !!openai,
    supabase: !!supabase,
    email: !!mailTransport,
    whatsapp: !!(CALLMEBOT_APIKEY && CALLMEBOT_PHONE)
  });
});

app.post('/api/chat', async function (req, res) {
  try {
    var message = (req.body && req.body.message || '').toString().trim();
    var history = (req.body && req.body.history) || [];
    if (!message) { return res.status(400).json({ error: 'message is required' }); }

    var reply = await askAI(message, history);
    res.json({ reply: reply });
  } catch (e) {
    console.error('chat error:', e.message);
    res.status(500).json({ error: 'chat failed' });
  }
});

app.post('/api/lead', async function (req, res) {
  try {
    var lead = req.body || {};
    await saveLead(lead);
    await Promise.all([emailAlert(lead), whatsappAlert(lead)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('lead error:', e.message);
    // Still respond OK — a failed alert shouldn't break the visitor's chat.
    res.json({ ok: true });
  }
});

// Catch-all error handler — never leak stack traces to the browser
// (e.g. a CORS rejection from a stray origin should look like a clean 403,
// not an internal error page).
app.use(function (err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('unhandled error:', err && err.message);
  if (err && /CORS/.test(err.message || '')) {
    return res.status(403).json({ error: 'origin not allowed' });
  }
  res.status(500).json({ error: 'server error' });
});

app.listen(PORT, function () {
  console.log('Shila server listening on port ' + PORT);
  console.log('OpenAI configured:', !!openai, '| Supabase configured:', !!supabase,
    '| Email configured:', !!mailTransport,
    '| WhatsApp configured:', !!(CALLMEBOT_APIKEY && CALLMEBOT_PHONE));
});
