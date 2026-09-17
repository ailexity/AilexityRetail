# Ailexity Retail

Frontend and Node backend for Ailexity Retail: a superadmin platform workspace plus a per-store workspace for billing, stock, orders, WhatsApp invoices and reports. One process, no build step, JSON files as the datastore.

## Run locally

1. Copy `.env.example` to `.env` and configure SMTP. For Gmail, enable 2-Step Verification and create a Google App Password under Google Account security. Put the 16-character App Password in `SMTP_PASSWORD` without spaces. Do not use the normal Gmail password or the `your-app-password` placeholder.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

The server listens on `0.0.0.0`, so it is also reachable from another device using the host machine's IP address, for example `http://192.168.1.25:3000`. Allow Node.js through the Windows firewall when prompted.

When SMTP is not configured, OTP, activation key and temporary password values are printed by the server for local development only. Never use that fallback in production. Emails are branded HTML with a plain-text version (`mail.js`): verification code, welcome (sign-in email, temporary password, activation key, next steps, plan) and password reset. Set `APP_URL` in `.env` to the address retailers use (for example `http://192.168.1.25:3000`) to include an "Open Ailexity Retail" button in them.

## Superadmin account

- Email: `ailexity.info@gmail.com`
- Password: `Ariesfab@15`

Change these through environment variables before deployment. The password can also be changed from **Settings → Security** in the app; that password is stored hashed in `data/settings.json` and takes precedence over the environment value.

## Deployment

The app is a single Node.js process (`server.js`) that serves the frontend and the API and stores its data in JSON files under `data/`. There is no build step and the only dependency is `nodemailer`. Pick the option that matches where the store phones will connect from.

### Requirements

- Node.js **20.12 or newer** (22 LTS recommended) — the server uses `process.loadEnvFile`.
- One machine that stays on while the store is open (a shop PC, a small server, or a cloud VM).
- Outbound SMTP access for emails (Gmail App Password or any SMTP provider).
- **HTTPS for anything beyond a private network.** Besides security, browsers only allow the *Copy* buttons (activation key, invoice text) on `https://` or `localhost` — over plain `http://` on a LAN they show "Copy failed" — and Android Chrome only installs the full-screen app over HTTPS (iPhone Safari's *Add to Home Screen* works on plain HTTP too).

### Configuration (`.env`)

Copy `.env.example` to `.env` next to `server.js`. Values set in the real environment take precedence over the file.

| Variable | Purpose | Default |
|---|---|---|
| `PORT`, `HOST` | Port and interface to listen on (`0.0.0.0` = all interfaces, `127.0.0.1` = only behind a reverse proxy) | `3000`, `0.0.0.0` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Superadmin sign-in. **Change the password before going live** (or change it in the app under Settings → Security, which stores a hash in `data/settings.json` and overrides this value) | see above |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Outgoing mail for OTPs, welcome emails and password resets. Without them the secrets are printed to the server log — fine for development, never for production | — |
| `SESSION_TTL_HOURS` | Fallback session length (Settings → Retailer defaults overrides it) | `12` |
| `OTP_TTL_MINUTES` | How long a verification code stays valid | `10` |
| `APP_URL` | Public address of the app, used for the "Open Ailexity Retail" button in emails | — |

Everything the app writes lives in `data/` (`store-users.json`, `items.json`, `bills.json`, `notes.json`, `settings.json`, `messages.json`, `feedback.json`). That folder holds password hashes and the settings, so keep it out of version control (it already is in `.gitignore`), restrict its permissions, and back it up — it *is* your database.

### Option A — a PC on the store's Wi‑Fi (no internet needed)

Good for a single shop or a few stores on one network. Phones connect to the PC's address.

1. Install Node.js on the PC, copy the project folder there (without `node_modules`), then in that folder run `npm ci --omit=dev` (or `npm install`).
2. Create `.env`; keep `HOST=0.0.0.0`. Set `APP_URL=http://<pc-ip>:3000`.
3. Give the PC a **static IP / DHCP reservation** on the router so the address never changes.
4. Start it: `npm start`. Allow Node.js through the firewall (Windows asks on first start; otherwise *Windows Defender Firewall → Allow an app*). Test from a phone: `http://<pc-ip>:3000`.
5. Keep it running after reboots / sign-in:
   - **Windows**: Task Scheduler → *Create Task* → trigger *At log on* (or *At startup* with "Run whether user is logged on or not") → action `"C:\Program Files\nodejs\node.exe"` with argument `server.js` and *Start in* set to the project folder. Alternatively `npm i -g pm2` and follow Option B's pm2 steps plus `npm i -g pm2-windows-startup && pm2-startup install`.
   - **macOS / Linux**: use pm2 as in Option B.

On a LAN there is no HTTPS, so expect the limitations above (no clipboard buttons; full-screen install on iPhone only). Everything else — billing, WhatsApp invoices, PDF reports — works fully offline; only emails need internet.

### Option B — a Linux server or cloud VM with HTTPS (recommended for several stores)

Ubuntu 22.04/24.04 with a domain (for example `pos.example.com`) pointing at the server.

```bash
# 1. Node.js 22 + pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pm2

# 2. App (as a non-root user, e.g. "pos")
sudo adduser --disabled-password --gecos "" pos
sudo -u pos -H bash -c 'git clone <your-repo-url> ~/ailexity-pos'   # or scp the folder
cd /home/pos/ailexity-pos
sudo -u pos npm ci --omit=dev
sudo -u pos cp .env.example .env && sudo -u pos nano .env           # HOST=127.0.0.1, APP_URL=https://pos.example.com, SMTP + admin password
sudo -u pos mkdir -p data && sudo -u pos chmod 700 data              # the JSON database lives here

# 3. Run under pm2 and survive reboots
sudo -u pos pm2 start server.js --name ailexity-pos
sudo -u pos pm2 save
sudo env PATH=$PATH pm2 startup systemd -u pos --hp /home/pos      # prints one command to run – run it
```

Reverse proxy (`/etc/nginx/sites-available/ailexity-pos`, then `ln -s` it into `sites-enabled` and `sudo nginx -t && sudo systemctl reload nginx`):

```nginx
server {
  listen 80;
  server_name pos.example.com;
  client_max_body_size 2m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

HTTPS with Let's Encrypt (also rewrites the config above to redirect HTTP → HTTPS):

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pos.example.com
```

Firewall: `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable` — port 3000 stays closed because the app listens on `127.0.0.1` only.

Retailers then open `https://pos.example.com`, and *Add to Home Screen* gives them the full-screen app.

### Option C — Docker

Create a `Dockerfile` in the project folder, plus a `.dockerignore` containing `node_modules`, `.env` and `data` so secrets and the database never end up inside the image:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run, keeping the database on the host and passing the configuration as environment variables (`HOST` must stay `0.0.0.0` inside the container — Docker publishes the port):

```bash
docker build -t ailexity-pos .
docker run -d --name ailexity-pos --restart unless-stopped \
  -p 3000:3000 --env-file .env -v "$(pwd)/data:/app/data" ailexity-pos
```

Put nginx/Caddy/Traefik with HTTPS in front of it exactly as in Option B. Run **one** container per data folder — the JSON store is not safe to share between two running instances.

### After deploying — checklist

1. Sign in as superadmin and change the password (**Settings → Security**); set the platform name, support contact, currency and WhatsApp country code (**Settings → Platform profile**).
2. Send yourself a test retailer: add a store with your own email and confirm the verification and welcome emails arrive and look right.
3. Set `APP_URL` so the "Open" button in emails points at the real address.
4. Back up `data/` (a nightly copy is enough — it is a few small files). Restoring is copying the files back and restarting.
5. Add the app to the home screen on the store phones.

### Updating

Copy the new files over (or `git pull`), run `npm ci --omit=dev` if `package.json` changed, then **restart the process** — Node does not reload changed code, so `pm2 restart ailexity-pos` / `docker restart ailexity-pos` / restart the scheduled task. Restarting signs everyone out (sessions live in memory), so do it outside store hours. During development use `npm run dev`, which restarts automatically on file changes.

### Troubleshooting

- **"API route not found" for a feature that exists in the code** — the running process predates the code; restart it.
- **`Port 3000 is already in use`** — another instance is running; stop it or set a different `PORT`.
- **Phones can't open the address** — same Wi‑Fi as the PC? PC firewall allowing Node? Use the PC's IPv4 address from `ipconfig` / `ip addr`, not `localhost`.
- **Emails don't arrive** — check the server log: `[SMTP not configured]` means the `.env` SMTP values are missing or still placeholders; Gmail needs an App Password (16 characters, no spaces), not the account password.
- **"Copy failed" / no full-screen install on Android** — the page is served over plain HTTP; both need HTTPS (Option B/C).
- **Superadmin dashboard "today" looks off** — it uses the server's clock; set the server's time zone (`sudo timedatectl set-timezone Asia/Kolkata`). Retailer screens and PDF reports use the phone's local time.

### Limits to know before scaling

The JSON files and in-memory sessions are designed for a small deployment (one server, a handful of stores, thousands of bills). There is no rate limiting on sign-in, and a restart clears sessions. Before opening the app to many stores or the public internet, move the data to a managed database and sessions to a persistent store, and add rate limiting at the proxy.

## Install on a phone

Open the app in the phone browser and use **Add to Home Screen** (Safari share menu on iPhone; Chrome menu on Android). It then opens full screen with its own icon: the status bar overlays the app, the header stays pinned, only the page content scrolls, and pinch/double-tap zoom is disabled. `manifest.webmanifest` and `icon-192.png` / `icon-512.png` provide the install metadata.

## Sign in (one page for every role)

Superadmins and store owners use the same sign-in form. The backend authenticates the credentials, verifies the role, and the app opens the matching workspace: the platform dashboard for a superadmin, the store dashboard for a retailer.

## Superadmin workflow

- **Dashboard**: user activity, retailer statistics (total / pending / suspended / archived), order statistics, revenue statistics, alerts and notifications, recent registrations, recent activity.
- **Retailers**: filter by All / Pending / Active / Suspended / Archived. Adding a retailer walks through Store information, Owner information, Contact information, Business information and Subscription plan, then:
  1. Create account: the backend sends a time-limited six-digit OTP to the retailer by SMTP.
  2. Verify: the superadmin enters the OTP and the backend generates a one-time **activation key** and a **temporary password**, emails both in the welcome message, and shows them to the superadmin (with a copy button) in case email is not configured.
  3. Ready: the retailer can now sign in.
- **Messages to stores** (top of the Retailers page, saved in `data/messages.json`): write a title and message, pick a type (Information / Important / Urgent), how long it stays visible (1 day to 30 days or a custom number of days, up to 90) and the recipients (all stores or a picked list of active stores). Stores see it as a popup on their dashboard; the sent list shows each message with its status (active / ended / expired) and how many recipients have read it, and a message can be ended early or deleted.
- **Automatic plan-expiry reminders**: every hour the server checks every active store; when a plan ends within 5 days the store gets one reminder per day — a popup message on its dashboard (Important, or Urgent within 2 days; it replaces the previous day's) and an email — until the superadmin extends the plan (the open reminder is withdrawn at once) or the plan ends. These appear in the sent-messages list marked *Automatic*. `POST /api/admin/plan-reminders/run` runs the check on demand.
- Retailer details let the superadmin edit the store profile, change the plan, suspend, archive (soft delete, signs the retailer out everywhere) and restore an account. Archived retailers can be deleted permanently.
- **Inbox** (own tab, with a new-message count; saved in `data/feedback.json`): every message stores send from their Profile page, with the store, owner, category (feedback / problem / request / other), subject and text. Filter Open / New / Seen / Resolved / All; mark a message seen, resolve it, reopen or delete it. The dashboard alerts list links to new messages. This is one-way — there are no replies in the app; answer the store by phone, email or a message to stores.
- **Settings** (saved in `data/settings.json`):
  - *Platform profile*: platform name, support email and phone (shown to retailers under Subscription), currency (ISO code, formats every amount for everyone) and the WhatsApp country code added to 10-digit mobile numbers.
  - *Retailer defaults*: default plan pre-selected when adding a retailer, how many days before expiry a plan counts as "expiring soon", and session length for new sign-ins.
  - *Alerts & notifications*: which alert types appear on the dashboard.
  - *Security*: change the superadmin password (other superadmin sessions are signed out).

## Retailer workflow

1. On first login the retailer enters their email and the temporary password; the form then asks for the activation key from the welcome email. The backend checks both, consumes the key and activates the account; the app then asks the retailer to set their own password under Profile → Security. Later logins need only email and password.
2. **Dashboard**: messages from the superadmin pop up here (Got it marks them read, Later keeps them quiet until the next sign-in); active ones stay listed in a Messages card with an unread dot on the Dashboard tab, and the app checks for new messages every minute. Then sales today, orders today, total items, monthly sale, average order value, pending payments; sales analytics by day / week / month; order analytics (completed / pending / cancelled); inventory (available / low / out of stock).
3. **Notes** (notepad button in the header, on every store page; the badge counts reminders due today or overdue): a private notebook for the store, saved in `data/notes.json` and never shown to the superadmin. **+ Note** opens an editor like a phone's notes app: just write, with bold / italic / underline / strikethrough, bullet lists and tickable checklists; the note saves itself as you type (also when switching tabs or leaving the app), the first line is its title, tap a note in the list to open and edit it, and an emptied note is deleted. **Reminder** opens the same editor with a date and time row (the bell button adds or removes one on any note); the note then sits under *Reminders* until it is ticked, pops up on any store page when its time comes while the app is open (*Mark done* / *Later*), and is flagged *Overdue* afterwards. Checklist items show as checkboxes in the lists too, and can be ticked there. The bottom of the **Dashboard** has a *Notes & reminders* card with the next three reminders and the three latest notes (tickable as well) and a *See all* button. Content is stored as HTML reduced to that formatting only; dates and times are the phone's local time.
4. **Items**: catalog with categories, a per-item low-stock alert level (default 5) and All / Low stock / Out of stock filters. Item lifecycle: created → available → stock updated → used in an order → stock reduced → low stock → out of stock.
5. **Billing**: pick items into the cart, add an optional discount (amount) and tax rate (%, pre-filled from Profile → Billing & invoices), optionally capture the customer name and WhatsApp number, then choose Cash / Card / UPI or *Pay later*. Paid bills confirm payment and generate an invoice (`INV-0001`, …) immediately; pay-later bills are saved as pending orders and get their invoice when marked paid.
6. **WhatsApp invoice**: order completed → invoice generated → customer mobile number (captured at billing or typed in later on the order) → **Send invoice on WhatsApp** opens a text invoice in WhatsApp → the order is marked *WhatsApp sent*. **Copy invoice** copies the same text.
7. **Orders**: filter by All / Today / Pending / Completed / Cancelled / Refunded. Each order expands to its detail: date & time, customer, items, subtotal, discount, tax, total, payment method, payment status, invoice, WhatsApp status and the order timeline (order created → bill generated → payment confirmed → invoice generated → WhatsApp sent). Pending orders can be marked paid or cancelled; completed orders can be refunded. Cancelling or refunding returns the items to stock and removes the sale from revenue.
   - **Performance report** (top of the Orders page): pick Today / Yesterday / This week / Last 7 days / This month / Last month or custom From–To dates (up to a year) and see sales, orders, average order value, items sold, pending payments, cancelled/refunded counts, best day, payment-method split and top items for that period. **Download PDF report** produces an A4 PDF with those figures plus a day-by-day table; tick *Include every order* to append the full order history for the period. PDFs are generated on the server without external libraries (`pdf.js`, `report.js`); amounts use the platform currency (`Rs.` for INR).
8. **Profile & settings** (saved on the retailer record):
   - *Store profile*: store name, owner name, phone, business type and address (the sign-in email stays with the superadmin).
   - *Billing & invoices*: default tax rate and label (e.g. GST) pre-filled on every bill, an invoice note, and whether the store phone and address appear on invoices.
   - *Inventory*: default low-stock alert level for new items and whether stock warnings pop up.
   - *Subscription*: plan, expiry and the platform support contact.
   - *Security*: change password (other devices are signed out). After a superadmin password reset the retailer is prompted to set a new one.
   - *Message Ailexity Retail*: send feedback, a problem or a request to the superadmin (category, subject, message; up to 20 a day). The history underneath shows every message sent with its status: Sent → Seen by the platform → Resolved. Not a chat — the superadmin replies outside the app.
   - Sign out.

The activation API `POST /api/auth/activate` remains available for non-UI onboarding clients.

See **Deployment → Limits to know before scaling** for what to change before running this for many stores.
