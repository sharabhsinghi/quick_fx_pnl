# FX Tracker — Forex Trade P/L Tracker

A Next.js app to track forex trade profit/loss in real time. Live prices are fetched server-side so your API key is never exposed in the browser.

## Features

- Enter currency pair, direction (buy/sell), entry, SL, TP, and lot size
- Fetch live FX prices with the Refresh button or set auto-refresh (30s / 1m / 5m)
- Visual price bar showing current price relative to SL / Entry / TP
- P/L calculated in pips and USD
- Risk:Reward ratio display
- Trade journal with win rate, total P/L, and per-trade history
- Pip calculator with scenario table
- Close trade with final P/L summary

## Supported Pairs

EUR/USD · GBP/USD · USD/JPY · USD/CHF · AUD/USD · NZD/USD · USD/CAD · EUR/GBP · EUR/JPY · GBP/JPY · EUR/CHF · GBP/CHF · AUD/JPY · CAD/JPY · EUR/AUD · EUR/CAD · GBP/AUD · GBP/CAD · AUD/CAD · AUD/CHF · NZD/JPY · USD/SGD · USD/MXN · USD/HKD

> **Note:** The frankfurter.app fallback is backed by ECB data and updates once daily on weekdays. Rates are mid-market and may differ from your broker's live bid/ask spread.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up your API key**
   ```bash
   cp .env.local.example .env.local
   # then edit .env.local and set TWELVE_API_KEY=your_key
   ```

3. **Run the development server**
   ```bash
   npm run dev
   # open http://localhost:3000
   ```

4. **Build for production**
   ```bash
   npm run build
   npm start
   ```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TWELVE_API_KEY` | No | [TwelveData](https://twelvedata.com) API key. If omitted, prices fall back to frankfurter.app (ECB). |

Variables are read **server-side only** and are never sent to the browser.

## Project Structure

```
forex-tracker/
├── public/
│   └── index.html
├── src/
│   ├── pages/
│   │   ├── _app.js           # Global CSS + Head metadata
│   │   ├── index.js          # Main page (renders App)
│   │   └── api/
│   │       └── price.js      # Server-side price API route (keeps API key secret)
│   ├── components/
│   │   ├── Dashboard.js/css  # Open positions grid
│   │   ├── TradeCard.js/css  # Live trade card with P/L + auto-refresh
│   │   ├── TradeForm.js/css  # New trade entry form
│   │   ├── TradeHistory.js/css # Closed trade journal
│   │   └── PipCalculator.js/css
│   ├── priceService.js       # Client helpers: P/L calc, pair metadata, fetch (via /api/price)
│   ├── App.js / App.css      # Root component and layout
│   ├── index.js / index.css  # (legacy entry points, unused by Next.js)
└── package.json
```

## Price API

- **Primary:** [TwelveData](https://twelvedata.com) — requires `TWELVE_API_KEY` in `.env.local`
- **Fallback:** [frankfurter.app](https://frankfurter.app) — free, no key required, ECB-backed

All API calls are made from the Next.js API route (`/api/price`), so credentials stay on the server and are never visible in the browser's network tab.

## Disclaimer

This tool is for informational and educational purposes only. It is not financial advice. Always verify prices with your broker before making trading decisions.
