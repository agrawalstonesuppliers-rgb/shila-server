# Shila server — setup guide

This gives your website a real AI chatbot ("Shila") plus a real database that
stores every visitor lead, with instant email + WhatsApp alerts to you.

Total ongoing cost: **free**, using Gemini's free tier and Supabase/Render
free tiers. Only if your traffic gets very large would anything start
costing money, and Google warns you before that happens.

Everything below is done through free signup forms — no coding needed on your
side. Do the steps in order.

---

## 1. Get a Gemini API key (the AI brain — free)

1. Go to https://aistudio.google.com and sign in with any Google account.
2. Click **Get API key** → **Create API key**. No card, no payment needed —
   Gemini's Flash model has a genuine free tier (about 1,000-1,500 messages
   a day, more than enough for a business site).
3. Copy the key — it looks like `AIzaSy...`. You'll paste this into Render
   in step 5.

If your traffic ever outgrows the free daily quota, it starts billing at a
fraction of a cent per message — you'll get a warning from Google before
anything is charged.

## 2. Create a free database (Supabase)

1. Go to https://supabase.com → sign up → "New project".
2. Once it's created, go to **SQL Editor** → New query, paste in the contents
   of `supabase-setup.sql` from this folder, and click Run. This creates the
   `leads` table where every visitor's info will be stored.
3. Go to **Settings → API**. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not the "anon" key) → this is `SUPABASE_SERVICE_KEY`

You'll be able to see every lead any time by opening Supabase → Table Editor
→ `leads`.

## 3. Turn on email alerts (using your existing Gmail)

1. Go to https://myaccount.google.com/apppasswords (sign in with
   agrawalstonesuppliers@gmail.com — turn on 2-Step Verification first if it
   asks).
2. Create an app password named "Shila", copy the 16-character code.
3. That code is `GMAIL_APP_PASSWORD` — NOT your normal Gmail password.

## 4. (Optional but recommended) Turn on free WhatsApp alerts

1. On WhatsApp, save this number: **+34 644 66 43 30**.
2. Send it the message: `I allow callmebot to send me messages`
3. It replies with your personal API key. That's `CALLMEBOT_APIKEY`, and
   your WhatsApp number (with country code, no `+` or spaces, e.g.
   `919214471749`) is `CALLMEBOT_PHONE`.

This is a well-known free service for personal WhatsApp alerts (low volume).

## 5. Deploy the server (Render, free tier)

1. Put this `shila-server` folder in its own GitHub repo (or ask me and I'll
   prep it for upload).
2. Go to https://render.com → sign up → **New → Web Service** → connect the
   repo.
3. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
4. Under **Environment**, add every variable from `.env.example` with the
   real values you collected above.
5. Click **Deploy**. Once it's live, Render gives you a URL like
   `https://shila-server.onrender.com` — copy it, you'll need it next.

Note: Render's free tier "sleeps" after 15 minutes of no traffic, so the
first message after a quiet period may take ~20-30 seconds to wake up. Say
the word if you'd rather pay ~$7/month for an always-on instance — no sleep
delay.

## 6. Point the website at your new server

Send me the Render URL from step 5 and I'll update the Shila widget on your
site to use it, so it goes live on kotastone.co.

---

### Files in this folder
- `server.js` — the backend (chat + lead saving + alerts)
- `site-knowledge.txt` — everything Shila knows about your products, built
  from your site's own content
- `supabase-setup.sql` — run once to create the database table
- `.env.example` — list of settings Render needs (step 5)
