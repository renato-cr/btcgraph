# BTC Graph

Interactive bitcoin charts with live data. It's a static site with no build step and no framework: plain HTML, CSS and SVG.

## Pages

| Page | What it shows | Data |
|---|---|---|
| `index.html` | Dashboard: live price chart, six market signals, key numbers, chart gallery | Coinbase (live), daily + monthly history, mempool.space |
| `cycles.html` | Halving cycles overlaid, plus price history by cycle | Monthly history + live current month |
| `power-law.html` | Log–log power-law corridor with ±1σ/2σ bands | Monthly history + live |
| `valuation.html` | Price against its 200-day and 200-week averages, the multiple's zones, what happened a year later, time spent at each price | Daily history + live |
| `heatmap.html` | Monthly returns heatmap with seasonality summary | Monthly history + live |
| `holding.html` | Share of every possible hold (1 day to 5 years) that ended in profit, a per-start-day explorer, cost of missing the best days | Daily history |
| `dca.html` | Dollar-cost-averaging simulator: amount, frequency, start date; average cost; starting at each cycle top | Daily history + live |
| `drawdown.html` | Drawdown from the all-time high on daily closes, price vs. running high, every fall deeper than 30% | Daily history + live |
| `volatility.html` | Typical daily swing over time and by year, spread of daily moves, biggest days | Daily history |
| `network.html` | Halving countdown, latest blocks, supply, subsidy, hashrate | mempool.space (live) |

The top menu groups these (Cycles & trend, Returns, Risk) and every page ends with previous/next links. Both come from the `NAV` list in `assets/core.js`.

## How data flows

- **Monthly history:** stored in `data/btc-data.js`. Completed months are frozen. `scripts/update_data.py` rewrites only the newest month, plus any new months, from Coinbase daily candles. It runs daily through `.github/workflows/update-data.yml`.
- **Daily history:** stored in `data/btc-daily.js`. It holds every completed UTC daily close since the first halving, Nov 28, 2012 (append-only), plus a rolling 35 days of 6-hour closes. Closes from July 20, 2015 on are Coinbase; earlier ones are Bitstamp, written once with `python3 scripts/update_data.py --backfill`. The daily job, at 00:15 UTC after the daily close, appends new days. If the file is behind (for example right after midnight UTC, or when the job hasn't run), pages fetch just the missing closes once through `BTC.daily()`.
- **Dashboard chart:** reads 1M from the 6-hour series and 3M–5Y from the daily series, with no network call. 1D and 1W fetch Coinbase candles live, because they're mostly today's data.
- **Live price:** the browser opens a Coinbase WebSocket (`assets/core.js`) and falls back to REST polling if that fails. Pages treat today (and the in-progress month) as the live price.
- **Network data:** the browser fetches it from the public mempool.space API, which allows cross-origin requests. No API keys are needed anywhere.

## Run locally

```bash
python3 -m http.server 8420
```

Then open http://localhost:8420. Opening `index.html` directly from disk also works.

## Deploy

Push to GitHub and turn on **GitHub Pages**: Settings → Pages → deploy from the `main` branch, `/` root. The daily workflow commits fresh data and Pages redeploys on its own. Netlify or Cloudflare Pages also work with zero config.

## Adding a chart

1. Copy a page such as `volatility.html`. Keep the `<head>` block, which loads `assets/site.css`, the data files, `assets/core.js` and `assets/charts.js`.
2. Get data with `BTC.daily(fn)` (daily closes, topped up if stale), `BTC.withLive(series)`, `BTC.monthlyLive()`, `BTC.onPrice(fn)` or `BTC.mempool(path)`.
3. Draw time series with `BTC.chart(element, config)` from `assets/charts.js`. It handles sizing to the card, linear and log axes, halving markers, zones, right-edge labels that don't overlap, point labels that avoid each other, and the hover tooltip. The config options are listed at the top of that file.
4. Reuse the shared pieces in `site.css`: `.insight` (the one-sentence takeaway), `.tiles`, `.seg` (segmented buttons), `.hbars` (bar rows), `.meter`.
5. Add the page to `NAV` in `core.js` (menu and previous/next links) and to `CARDS` in `index.html` (the gallery).
