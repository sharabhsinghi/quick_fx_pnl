# FX Tracker

A personal forex trade journal and P/L calculator. No sign-up, no server — everything runs in your browser.

**Live app:** [https://sharabhsinghi.github.io/quick_fx_pnl/](https://sharabhsinghi.github.io/quick_fx_pnl/)

---

## What you can do

### Positions
Log open trades by entering the currency pair, direction (buy/sell), entry price, stop loss, take profit, lot size, and open date. Each trade card shows:
- Live P/L in pips and your account currency
- Visual price bar showing where the current price sits between SL, entry, and TP
- Risk:Reward ratio
- Auto-refresh (30s / 1m / 5m) or manual refresh

When you close a trade, enter the close price and notes — the trade moves to History with its final P/L recorded.

### Calculators
Two tools available under the **Calculators** tab:
- **Pip Calculator** — enter a pair, lot size, and pip count to see the value in your account currency. Includes a scenario table across common pip ranges.
- **P/L Calculator** — enter entry, exit, side, and lot size to calculate P/L in pips and your account currency without opening a trade.

### History
All closed trades are stored in the **History** tab. You can delete individual entries or clear the full history.

### Analytics
The **Analytics** tab shows reports on your closed trades:
- Win rate and total P/L
- Average win vs average loss
- P/L over time chart
- Per-pair breakdown

---

## Settings

Click the **⚙** icon in the top-right to open account settings:

| Setting | Description |
|---|---|
| Account Currency | All P/L values are converted to this currency (USD, EUR, GBP, JPY, and more) |
| Account Size | Used to show P/L as a percentage of your account |
| Twelve Data API Key | Optional. Enter your [TwelveData](https://twelvedata.com) key to fetch real-time prices. Leave blank to use free ECB rates (updates once daily). |

The API key is stored **only in your browser** (IndexedDB) — it is never sent to any server other than Twelve Data directly.

---

## Supported Pairs

EUR/USD · GBP/USD · USD/JPY · USD/CHF · AUD/USD · NZD/USD · USD/CAD · EUR/GBP · EUR/JPY · GBP/JPY · EUR/CHF · GBP/CHF · AUD/JPY · CAD/JPY · EUR/AUD · EUR/CAD · GBP/AUD · GBP/CAD · AUD/CAD · AUD/CHF · NZD/JPY · USD/SGD · USD/MXN · USD/HKD

---

## Price sources

- **[Twelve Data](https://twelvedata.com)** — real-time prices. Requires a free API key entered in Settings.
- **[frankfurter.app](https://frankfurter.app)** — free fallback, no key needed, backed by ECB data (updates once per weekday).

If a Twelve Data key is set and the request succeeds, it is used. Otherwise the app falls back to frankfurter.app silently.

> Rates are mid-market. Always verify with your broker before making trading decisions.

---

## Data storage

All trade data (open positions, history, settings) is stored in your browser's **IndexedDB**. Nothing is sent to any server. Data persists across page reloads and browser restarts but is local to the browser and device you use.

---

## Running locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploying to GitHub Pages

```bash
npm run deploy
```

This builds the static export and pushes it to the `gh-pages` branch automatically.

---

## Disclaimer

This tool is for informational and journaling purposes only. It is not financial advice.
