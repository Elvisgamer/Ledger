# Ledger — Family Spending Tracker

A self-hosted spending tracker: personal + shared family expenses, planned vs.
actual amounts, and recurring monthly bills that generate automatically but
need a manual confirm (with the real amount, if it differs from what you
expected).

Runs as a single Node.js server with a local SQLite file for storage — no
cloud, no accounts beyond a shared family code.

## 1. Install

Requires [Node.js](https://nodejs.org) **22.5 or newer** (uses Node's built-in
SQLite support, so there's nothing to compile — just `npm install express`
under the hood). Check your version with `node -v`; if it's older, grab the
latest LTS from nodejs.org.

```bash
cd spending-tracker
npm install
```

## 2. Run

**Windows shortcut:** just double-click `start.bat`. It checks for Node, runs
`npm install` automatically the first time only, starts the server, and
opens `http://localhost:4477` in your browser. Leave that black window open
while you use the app — closing it stops the server.

**Manual / Mac / Linux:**

```bash
npm start
```

You'll see:

```
Spending tracker running:
  Local:   http://localhost:4477
  Network: check your PC's LAN IP, e.g. http://<your-ip>:4477
```

Open `http://localhost:4477` on the PC itself.

## 3. Access from phones / other laptops on your WiFi

1. Find your PC's LAN IP:
   - **Windows**: `ipconfig` → look for "IPv4 Address" (e.g. `192.168.1.42`)
   - **Mac**: `ipconfig getifaddr en0`
   - **Linux**: `hostname -I`
2. On your phone/laptop (same WiFi), go to `http://<that-ip>:4477`
3. If it doesn't load, your PC's firewall is probably blocking the port —
   allow inbound connections on port 4477 (Windows: "Allow an app through
   firewall" → Node.js, or allow port 4477 for private networks).

The server keeps running as long as the terminal window / process is open.
To stop it, press `Ctrl+C`. To keep it running in the background, look into
`pm2` or your OS's service manager once you're happy with it.

## 4. Using it

- **First screen**: enter a **family code** (anything you like — it's created
  the first time it's used) and your **name**. Everyone in the family uses
  the same code with their own name.
- **Personal vs. Family**: every entry you add is tagged Personal (only
  counts toward your own totals) or Family (pools into the shared family
  total that everyone sees).
- **Add**: log income or an expense, either as something already paid or
  just planned for a future date, with an expected amount.
- **Recurring**: set up monthly templates (rent, subscriptions, salary...).
  Each month the app creates a pending entry automatically — it sits in
  "Awaiting confirmation" until someone taps **Confirm** and enters what was
  actually paid, so you always know if a bill came in more or less than
  expected.
- **Dashboard**: shows spent/earned/upcoming for today, this week, this
  month, and this year, plus how far actual spending has drifted from what
  was expected.
- **History**: full list of everything, filterable by Personal/Family.

## 5. Data

Everything lives in `data.sqlite` in this folder. Back it up by copying that
one file. Delete it (server stopped) to wipe all data and start over.

## Project structure

```
spending-tracker/
  server.js      Express API + static file server
  db.js          SQLite schema
  public/        Frontend (vanilla HTML/CSS/JS, no build step)
  data.sqlite    Your data (created on first run)
```
