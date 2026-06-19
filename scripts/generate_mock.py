import json, random

random.seed(42)

STORES = ["Costco","Safeway","QFC","Trader Joe's","Fred Meyer","PCC Community Markets",
          "Whole Foods","Amazon Fresh","Walmart","Metropolitan Market"]

# rough relative price multipliers vs. a baseline (illustrative/mock only, not real market data)
STORE_MULT = {
    "Costco": 0.82, "Safeway": 1.12, "QFC": 1.08, "Trader Joe's": 0.90,
    "Fred Meyer": 1.00, "PCC Community Markets": 1.32, "Whole Foods": 1.28,
    "Amazon Fresh": 1.06, "Walmart": 0.78, "Metropolitan Market": 1.36
}

ITEMS = {
    "Tomatoes":        {"unit": "lb",   "base": 2.49},
    "Eggs":            {"unit": "doz",  "base": 4.29},
    "Milk":            {"unit": "gal",  "base": 3.99},
    "Bread":           {"unit": "loaf", "base": 3.79},
    "Bananas":         {"unit": "lb",   "base": 0.69},
    "Chicken Breast":  {"unit": "lb",   "base": 4.49},
    "Bell Peppers":    {"unit": "lb",   "base": 2.19},
    "Greek Yogurt":    {"unit": "32oz", "base": 5.49},
}

# explicit "doesn't carry this item in this format" cases for realism
HARD_NA = {
    ("Costco", "Bread"), ("Costco", "Greek Yogurt"),
    ("Trader Joe's", "Bell Peppers"),
}

MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]

def jitter_price(base, mult, spread=0.12):
    val = base * mult * (1 + random.uniform(-spread, spread))
    return round(val, 2)

# ---------- today's mock prices (for main comparison table / fallback) ----------
today = {}
for item, meta in ITEMS.items():
    today[item] = {"unit": meta["unit"], "stores": {}}
    for store in STORES:
        if (store, item) in HARD_NA or random.random() < 0.08:
            today[item]["stores"][store] = None
            continue
        price = jitter_price(meta["base"], STORE_MULT[store])
        on_sale = random.random() < 0.22
        entry = {"price": price, "on_sale": on_sale}
        if on_sale:
            old = round(price * random.uniform(1.10, 1.28), 2)
            entry["old_price"] = old
        today[item]["stores"][store] = entry

with open("mock-today-prices.json", "w") as f:
    json.dump({
        "_disclaimer": "MOCK / DEMO DATA ONLY. Not real, live, or historical retail prices. Used as a fallback when no SerpApi key is configured or the free monthly quota has been reached.",
        "generated_for_demo": True,
        "items": today
    }, f, indent=2)

# ---------- 6-month mock history (for the trend chart) ----------
history = {"_disclaimer": "MOCK / DEMO DATA ONLY. Replace by letting the monthly-tracker.yml GitHub Action populate this file with real SerpApi results over time.",
           "months": MONTHS, "items": {}}

for item, meta in ITEMS.items():
    history["items"][item] = {"unit": meta["unit"], "stores": {}}
    for store in STORES:
        if (store, item) in HARD_NA:
            history["items"][item]["stores"][store] = [None] * len(MONTHS)
            continue
        series = []
        running = meta["base"] * STORE_MULT[store] * (1 + random.uniform(-0.08, 0.08))
        for m in MONTHS:
            if random.random() < 0.07:
                series.append(None)
                continue
            running *= (1 + random.uniform(-0.05, 0.06))
            series.append(round(running, 2))
        history["items"][item]["stores"][store] = series

with open("history-price.json", "w") as f:
    json.dump(history, f, indent=2)

print("done")
