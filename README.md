# FX Tracker — Forex Trade P/L Tracker

A React app to track forex trade profit/loss in real time. Prices are fetched from [frankfurter.app](https://frankfurter.app) (European Central Bank data) — **no API key required**.

## Features

- Enter currency pair, direction (buy/sell), entry, SL, TP, and lot size
- Fetch live FX prices with the Refresh button
- Visual price bar showing current price relative to SL/TP/Entry
- P/L calculated in pips and USD
- Risk:Reward ratio display
- Close trade with final summary

## Supported Pairs

EUR/USD · GBP/USD · USD/JPY · USD/CHF · AUD/USD · NZD/USD · USD/CAD · EUR/GBP · EUR/JPY · GBP/JPY · EUR/CHF · GBP/CHF · AUD/JPY · CAD/JPY · EUR/AUD · EUR/CAD · GBP/AUD · GBP/CAD · AUD/CAD · AUD/CHF · NZD/JPY · USD/SGD · USD/MXN · USD/HKD · USD/CNH

> **Note:** The free frankfurter.app API is backed by ECB data and updates once daily on weekdays. Rates are mid-market and may differ from your broker's live bid/ask spread.

---

## Getting Started

### 1. Clone or download this repo

```bash
git clone https://github.com/YOUR_USERNAME/forex-tracker.git
cd forex-tracker
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run locally

```bash
npm start
```

The app opens at `http://localhost:3000`.

---

## Deploy to GitHub Pages

### Step 1: Create a GitHub repository

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `forex-tracker` (or anything you like)
3. Leave it public, don't add README yet
4. Click **Create repository**

### Step 2: Set the homepage in package.json

Open `package.json` and update the `"homepage"` field to match your GitHub Pages URL:

```json
"homepage": "https://YOUR_USERNAME.github.io/forex-tracker"
```

Replace `YOUR_USERNAME` with your GitHub username and `forex-tracker` with your repo name.

### Step 3: Push your code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/forex-tracker.git
git push -u origin main
```

### Step 4: Deploy

```bash
npm run deploy
```

This runs `npm run build` then pushes the build to the `gh-pages` branch automatically.

### Step 5: Enable GitHub Pages

1. Go to your repo on GitHub → **Settings** → **Pages**
2. Under **Source**, select branch: `gh-pages`, folder: `/ (root)`
3. Click **Save**

Your app will be live at:
```
https://YOUR_USERNAME.github.io/forex-tracker
```

*(It may take 1–2 minutes for the first deployment to go live.)*

### Updating the app

Whenever you make changes:

```bash
npm run deploy
```

That's it — it rebuilds and redeploys automatically.

---

## Project Structure

```
forex-tracker/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── TradeForm.js      # Trade entry form
│   │   ├── TradeForm.css
│   │   ├── LiveTrade.js      # Live P/L dashboard
│   │   ├── LiveTrade.css
│   │   ├── ClosedTrade.js    # Trade summary after closing
│   │   └── ClosedTrade.css
│   ├── priceService.js       # API calls + P/L calculations
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   └── index.css
└── package.json
```

## Price API

Primary: [frankfurter.app](https://frankfurter.app) — free, no key, ECB-backed  
Fallback: [open.er-api.com](https://open.er-api.com) — free, no key

## Disclaimer

This tool is for informational and educational purposes only. It is not financial advice. Always verify prices with your broker before making trading decisions.
