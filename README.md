# Tally — Pacific NW Grocery Price Check

A static, no-build SPA that compares a grocery list across ten Pacific
Northwest supermarkets (Costco, Safeway, QFC, Trader Joe's, Fred Meyer, PCC
Community Markets, Whole Foods, Amazon Fresh, Walmart, Metropolitan Market).

## Files

```
index.html                       Markup + Tailwind CDN + Chart.js CDN
app.js                            All front-end logic (list, table, chart, quota)
mock-today-prices.json           Seeded demo data for the comparison table
history-price.json                Seeded demo data for the 6-month trend chart
robots.txt / sitemap.xml          SEO basics for Google Search Console
.github/workflows/monthly-tracker.yml   Scheduled job that refreshes history-price.json
scripts/fetch-prices.js          Node script the workflow runs (server-side, calls SerpApi)
```

## 1. Deploy

1. Create a new GitHub repository (e.g. `grocery-compare`) and push these files to the
   `main` branch root.
2. Repo Settings → **Pages** → Source: *Deploy from a branch* → `main` / `/ (root)`.
3. Your site will be live at `https://YOUR-USERNAME.github.io/grocery-compare/`.
4. Open `robots.txt` and `sitemap.xml` and replace `YOUR-USERNAME` with your actual
   GitHub username before submitting the site to Google Search Console.

## 2. The SerpApi key, and an important limitation

The Settings panel (gear icon, top right) lets a visitor paste their own SerpApi key,
stored only in their browser's `localStorage`. No key is ever committed to the repo.

**Read this before relying on "live mode":** SerpApi's own documentation and support
content confirm that calling `serpapi.com` directly from browser JavaScript on a
different domain generally runs into CORS — the browser will block this script from
reading the response unless SerpApi's server explicitly allows your origin (it
recommends a small backend proxy for exactly this reason). Two consequences:

- For most visitors, "live mode" will silently fail and the app will fall back to the
  bundled demo data automatically — that fallback (and the explanatory note under the
  list) is intentional and built in, not a bug.
- Because the HTTP request can still reach SerpApi's server even when the *browser*
  can't read the response, a failed live attempt can still consume one unit of that
  visitor's monthly SerpApi quota. `app.js` accounts for this by incrementing the usage
  counter at the moment a call is attempted, not only on success.

If you want dependable live, per-visitor pricing, put a minimal serverless proxy
(Cloudflare Worker, Vercel/Netlify function, etc.) in front of SerpApi and point
`fetchLivePrice()` in `app.js` at that instead of `serpapi.com` directly. Without a
proxy, this project's realistic source of non-demo data is the monthly history file
below, which runs server-side and isn't affected by CORS at all.

## 3. Monthly automated price history

`.github/workflows/monthly-tracker.yml` runs on the 1st of each month (and can be
triggered manually from the Actions tab). It calls `scripts/fetch-prices.js`, which:

- Queries SerpApi's `google_shopping` engine once per item for 20 preset core grocery
  items (defined in `CORE_ITEMS` in that file — edit the list to taste).
- Matches results against the 10 target store names.
- Appends one price per store per item into `history-price.json` for the current month
  (re-running in the same month overwrites that month rather than duplicating it).

To enable it:

1. Repo Settings → **Secrets and variables → Actions** → New repository secret named
   `SERPAPI_KEY` with your key.
2. Repo Settings → **Actions → General → Workflow permissions** → select *Read and
   write permissions* (required so the workflow can commit `history-price.json` back to
   the repo).
3. Optionally trigger it once manually from the **Actions** tab to confirm it works
   before waiting for the schedule.

This path runs inside GitHub's Actions runner (Node.js), not a browser, so it isn't
subject to the CORS limitation described above — it's the most reliable real-data path
in this project.

## 4. Demo data, clearly labeled

`mock-today-prices.json` and `history-price.json` ship pre-seeded with **illustrative,
made-up numbers** (each file's `_disclaimer` field says so) so the comparison table and
chart look complete out of the box, before you've configured a key or let the monthly
job run a few times. They are not real prices — don't treat them as such, and the UI
says so as well.

## 5. Customizing

- `STORES` in `app.js` and `scripts/fetch-prices.js` must stay in sync if you add or
  remove a store — they're independent arrays, not shared, since this is a no-build
  static project.
- `DEFAULT_ITEMS` in `app.js` controls which items are pre-filled on first load.
- `QUOTA_LIMIT` in `app.js` (default 95) is the safety margin under SerpApi's 100
  free monthly searches.
