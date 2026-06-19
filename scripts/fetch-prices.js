/**
 * scripts/fetch-prices.js
 *
 * Runs server-side inside a GitHub Actions runner (Node.js), NOT in a
 * browser — so the CORS restrictions that affect the front-end's optional
 * "live mode" do not apply here. This is the reliable data path for the app.
 *
 * For each of the 20 preset core grocery items, queries SerpApi's
 * google_shopping engine once, matches results against the 10 target
 * stores by name, and appends (or overwrites, if re-run in the same month)
 * one data point per store into history-price.json.
 *
 * Requires the SERPAPI_KEY environment variable (see monthly-tracker.yml).
 */

const fs = require("fs");
const path = require("path");

const HISTORY_PATH = path.join(__dirname, "..", "history-price.json");

const STORES = [
  "Costco", "Safeway", "QFC", "Trader Joe's", "Fred Meyer",
  "PCC Community Markets", "Whole Foods", "Amazon Fresh", "Walmart", "Metropolitan Market",
];

// 20 preset core grocery items tracked automatically every month.
const CORE_ITEMS = {
  "Tomatoes": "lb", "Eggs": "doz", "Milk": "gal", "Bread": "loaf",
  "Bananas": "lb", "Chicken Breast": "lb", "Bell Peppers": "lb", "Greek Yogurt": "32oz",
  "Butter": "lb", "Cheddar Cheese": "8oz", "Apples": "lb", "Potatoes": "5lb bag",
  "Onions": "lb", "Ground Beef": "lb", "Salmon Fillet": "lb", "Spinach": "5oz bag",
  "Avocados": "each", "Orange Juice": "64oz", "Rice": "2lb bag", "Pasta": "16oz box",
};

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const LOCATION = "Seattle, Washington, United States";
const REQUEST_DELAY_MS = 1200; // be polite to the API between sequential calls

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function matchStoreFromSource(source) {
  if (!source) return null;
  const norm = source.toLowerCase();
  return STORES.find(
    (s) => norm.includes(s.toLowerCase()) || norm.includes(s.toLowerCase().replace("'", ""))
  ) || null;
}

async function fetchStorePricesForItem(item) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(item)}&location=${encodeURIComponent(LOCATION)}&hl=en&gl=us&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status} for "${item}"`);
  const json = await res.json();
  if (json.error) throw new Error(`SerpApi error for "${item}": ${json.error}`);

  const prices = {};
  STORES.forEach((s) => (prices[s] = null));
  (json.shopping_results || []).forEach((r) => {
    const matched = matchStoreFromSource(r.source);
    if (matched && prices[matched] === null && typeof r.extracted_price === "number") {
      prices[matched] = r.extracted_price;
    }
  });
  return prices;
}

function loadExistingHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return { _disclaimer: "Populated automatically by .github/workflows/monthly-tracker.yml via SerpApi.", months: [], items: {} };
  }
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
}

function ensureMonthSlot(history, month) {
  let monthIndex = history.months.indexOf(month);
  if (monthIndex === -1) {
    history.months.push(month);
    monthIndex = history.months.length - 1;
    // pad every existing store series with a null for the new month
    Object.values(history.items).forEach((entry) => {
      Object.keys(entry.stores).forEach((store) => {
        while (entry.stores[store].length < history.months.length - 1) entry.stores[store].push(null);
        entry.stores[store].push(null);
      });
    });
  }
  return monthIndex;
}

function ensureItemSlot(history, item, unit) {
  if (!history.items[item]) {
    history.items[item] = { unit, stores: {} };
  }
  STORES.forEach((store) => {
    if (!history.items[item].stores[store]) {
      history.items[item].stores[store] = new Array(history.months.length).fill(null);
    }
    while (history.items[item].stores[store].length < history.months.length) {
      history.items[item].stores[store].push(null);
    }
  });
}

async function main() {
  if (!SERPAPI_KEY) {
    console.error("Missing SERPAPI_KEY environment variable / repository secret. Aborting.");
    process.exit(1);
  }

  const history = loadExistingHistory();
  const month = monthKey();
  const monthIndex = ensureMonthSlot(history, month);

  for (const [item, unit] of Object.entries(CORE_ITEMS)) {
    ensureItemSlot(history, item, unit);
    try {
      console.log(`Fetching "${item}"...`);
      const prices = await fetchStorePricesForItem(item);
      STORES.forEach((store) => {
        history.items[item].stores[store][monthIndex] = prices[store];
      });
    } catch (err) {
      console.error(`Failed to fetch "${item}": ${err.message}`);
      // leave this item's slot for the month as null rather than guessing
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`Wrote history-price.json for month ${month}.`);
}

main();
