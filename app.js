/* =========================================================================
   Tally — Pacific NW Grocery Price Check
   Pure client-side logic. No build step, no framework.

   IMPORTANT, READ THIS BEFORE WIRING UP A REAL SERPAPI KEY:
   Most browsers block reading the response of a direct cross-origin fetch()
   call from a static page (like this one on GitHub Pages) to serpapi.com,
   because SerpApi's API does not send back permissive CORS headers for
   browser-based requests. Critically: the request can still REACH SerpApi's
   server and consume your monthly quota even though your browser throws an
   error before this script can read the result. That's why the usage
   counter below increments at the moment a live call is *attempted*, not
   only when it succeeds — and why this app always has a working mock-data
   fallback. If you want reliable live data, put a tiny serverless proxy
   (Cloudflare Worker / Vercel function / similar) in front of SerpApi and
   point fetchLivePrice() at that instead. See README.md.
   ========================================================================= */

const STORES = [
  "Costco", "Safeway", "QFC", "Trader Joe's", "Fred Meyer",
  "PCC Community Markets", "Whole Foods", "Amazon Fresh", "Walmart", "Metropolitan Market"
];

const STORE_COLORS = [
  "#1F3D2B", "#C8462F", "#2E6F95", "#A8381F", "#5B7C4E",
  "#8E5BAE", "#C99A2E", "#3F8C8C", "#7A4B2E", "#D17AA0"
];

const QUOTA_LIMIT = 95;
const QUOTA_KEY = "tally_api_usage_v1";
const APIKEY_KEY = "tally_serpapi_key_v1";
const DEFAULT_ITEMS = ["Tomatoes", "Eggs", "Milk", "Bread", "Bananas", "Chicken Breast", "Bell Peppers", "Greek Yogurt"];

// These 5 tend to have the most consistent Google Shopping coverage, so
// they're on by default. Small local/premium chains (PCC, Metropolitan
// Market, Trader Joe's, QFC, Whole Foods) often don't syndicate a real-time
// product feed to Google at all, so they're opt-in via the Filter Stores
// panel rather than on by default.
const DEFAULT_VISIBLE_STORES = ["Costco", "Safeway", "Fred Meyer", "Walmart", "Amazon Fresh"];
const STORE_FILTER_KEY = "tally_store_filter_v1";

let groceryList = [...DEFAULT_ITEMS];
let mockToday = null;
let historyData = null;
let dataFilesFailedToLoad = false;
let historyChart = null;
let enabledStores = new Set(DEFAULT_VISIBLE_STORES);
let lastResults = null; // cached so toggling store filters doesn't re-trigger SerpApi calls

/* ---------------------------- data loading ---------------------------- */

async function loadDataFiles() {
  try {
    const [todayRes, historyRes] = await Promise.all([
      fetch("mock-today-prices.json"),
      fetch("history-price.json"),
    ]);
    mockToday = await todayRes.json();
    historyData = await historyRes.json();
  } catch (err) {
    dataFilesFailedToLoad = true;
    console.warn("Could not load local data files. If you're opening index.html " +
      "directly (file://), serve this folder over http instead — e.g. `npx serve` " +
      "or GitHub Pages — since browsers block fetch() of local JSON over file://.", err);
  }
}

/* ------------------------------ usage / quota -------------------------- */

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getUsage() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(QUOTA_KEY)); } catch { raw = null; }
  const thisMonth = monthKey();
  if (!raw || raw.month !== thisMonth) {
    raw = { month: thisMonth, count: 0 };
    localStorage.setItem(QUOTA_KEY, JSON.stringify(raw));
  }
  return raw;
}

function incrementUsage() {
  const usage = getUsage();
  usage.count += 1;
  localStorage.setItem(QUOTA_KEY, JSON.stringify(usage));
  return usage;
}

function resetUsage() {
  localStorage.setItem(QUOTA_KEY, JSON.stringify({ month: monthKey(), count: 0 }));
  updateQuotaUI();
}

function updateQuotaUI() {
  const usage = getUsage();
  const pct = Math.min(100, Math.round((usage.count / QUOTA_LIMIT) * 100));
  const usageCountText = document.getElementById("usageCountText");
  const usageBar = document.getElementById("usageBar");
  if (usageCountText) usageCountText.textContent = `${usage.count} / ${QUOTA_LIMIT}`;
  if (usageBar) {
    usageBar.style.width = pct + "%";
    usageBar.classList.toggle("bg-tomato", usage.count >= QUOTA_LIMIT);
    usageBar.classList.toggle("bg-evergreen", usage.count < QUOTA_LIMIT);
  }
  const quotaPill = document.getElementById("quotaPill");
  if (quotaPill) {
    const key = getApiKey();
    quotaPill.textContent = key
      ? `Live mode · ${usage.count}/${QUOTA_LIMIT} SerpApi calls this month`
      : "Demo mode · no SerpApi key set";
  }
}

/* ------------------------------ api key -------------------------------- */

function getApiKey() {
  return localStorage.getItem(APIKEY_KEY) || "";
}
function saveApiKey(key) {
  if (key) localStorage.setItem(APIKEY_KEY, key.trim());
}
function forgetApiKey() {
  localStorage.removeItem(APIKEY_KEY);
}

/* ------------------------------ store filter ---------------------------- */

function loadStoreFilter() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORE_FILTER_KEY)); } catch { saved = null; }
  const list = Array.isArray(saved) && saved.length ? saved.filter((s) => STORES.includes(s)) : DEFAULT_VISIBLE_STORES;
  enabledStores = new Set(list.length ? list : DEFAULT_VISIBLE_STORES);
}

function saveStoreFilter() {
  localStorage.setItem(STORE_FILTER_KEY, JSON.stringify(STORES.filter((s) => enabledStores.has(s))));
}

function storeHasDataInResults(store, results) {
  if (!results || Object.keys(results).length === 0) return true; // unknown until a compare has run
  return Object.values(results).some(
    (data) => data.stores && data.stores[store] && typeof data.stores[store].price === "number"
  );
}

// Visible = manually enabled AND (no results yet, OR has at least one real
// price in the current result set). This is what auto-hides a fully-N/A
// column without the user having to notice and uncheck it themselves.
function computeVisibleStores(results) {
  return STORES.filter((s) => enabledStores.has(s) && storeHasDataInResults(s, results));
}

function renderFilterPanel() {
  const list = document.getElementById("filterStoresChecklist");
  if (!list) return;
  list.innerHTML = "";
  STORES.forEach((store) => {
    const hasData = storeHasDataInResults(store, lastResults);
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 text-[13px] cursor-pointer select-none";
    label.innerHTML = `
      <input type="checkbox" data-store="${escapeHtml(store)}" ${enabledStores.has(store) ? "checked" : ""}
        class="rounded border-ink/30 text-evergreen focus:ring-evergreen" />
      <span class="${hasData ? "" : "text-ink/40"}">${escapeHtml(store)}${hasData ? "" : " <span class=\"font-mono text-[10px]\">(no data for current list)</span>"}</span>
    `;
    list.appendChild(label);
  });
  list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const store = e.target.getAttribute("data-store");
      if (e.target.checked) enabledStores.add(store);
      else enabledStores.delete(store);
      saveStoreFilter();
      renderComparisonTable(lastResults || {});
    });
  });
}

/* ------------------------------ chips / list ---------------------------- */

function renderChips() {
  const container = document.getElementById("chipContainer");
  container.innerHTML = "";
  groceryList.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "chip-in inline-flex items-center gap-2 bg-white border border-ink/15 rounded-full pl-3 pr-1.5 py-1.5 text-[13px]";
    chip.innerHTML = `<span>${escapeHtml(item)}</span>`;
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", `Remove ${item}`);
    btn.className = "w-5 h-5 flex items-center justify-center rounded-full hover:bg-tomato/10 text-ink/40 hover:text-tomato";
    btn.innerHTML = "&times;";
    btn.onclick = () => {
      groceryList = groceryList.filter((i) => i !== item);
      renderChips();
    };
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function addItemsFromInput() {
  const input = document.getElementById("listInput");
  const raw = input.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  raw.forEach((item) => {
    const exists = groceryList.some((i) => i.toLowerCase() === item.toLowerCase());
    if (!exists) groceryList.push(item);
  });
  input.value = "";
  renderChips();
}

/* ------------------------------ mock lookup ----------------------------- */

function findMockEntry(item) {
  if (!mockToday || !mockToday.items) return null;
  const key = Object.keys(mockToday.items).find(
    (k) => k.toLowerCase() === item.trim().toLowerCase()
  );
  return key ? { key, unit: mockToday.items[key].unit, stores: mockToday.items[key].stores } : null;
}

/* ------------------------------ live SerpApi call ------------------------ */

function matchStoreFromSource(source) {
  if (!source) return null;
  const norm = source.toLowerCase();
  return STORES.find((s) => norm.includes(s.toLowerCase().replace("'", "")) || norm.includes(s.toLowerCase())) || null;
}

async function fetchLivePrice(item, apiKey) {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(item)}&location=${encodeURIComponent("Seattle, Washington, United States")}&hl=en&gl=us&api_key=${encodeURIComponent(apiKey)}`;

  // Counted here because the request can reach SerpApi (and consume quota)
  // even if the browser later blocks reading the response via CORS.
  incrementUsage();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi responded with ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);

  const stores = {};
  STORES.forEach((s) => (stores[s] = null));
  (json.shopping_results || []).forEach((r) => {
    const matched = matchStoreFromSource(r.source);
    if (matched && stores[matched] === null) {
      stores[matched] = {
        price: r.extracted_price ?? null,
        on_sale: !!r.old_price,
        old_price: r.extracted_old_price ?? undefined,
      };
    }
  });
  return stores;
}

/* ------------------------------ comparison run -------------------------- */

async function runCompare() {
  if (groceryList.length === 0) return;
  if (!mockToday) await loadDataFiles();

  const apiKey = getApiKey();
  const usage = getUsage();
  const banner = document.getElementById("quotaBanner");
  const note = document.getElementById("dataSourceNote");
  banner.classList.add("hidden");

  const results = {}; // item -> { stores: {...}, source: 'live'|'mock'|'unavailable' }
  let usedLive = false;
  let usedMockFallback = false;

  for (const item of groceryList) {
    if (apiKey && usage.count < QUOTA_LIMIT) {
      try {
        const stores = await fetchLivePrice(item, apiKey);
        results[item] = { stores, source: "live" };
        usedLive = true;
        continue;
      } catch (err) {
        console.warn(`Live SerpApi request failed for "${item}", falling back to demo data.`, err);
      }
    }
    const mock = findMockEntry(item);
    if (mock) {
      results[item] = { stores: mock.stores, source: "mock", unit: mock.unit };
      usedMockFallback = true;
    } else {
      results[item] = { stores: null, source: "unavailable" };
    }
  }

  if (apiKey && usage.count >= QUOTA_LIMIT) {
    banner.classList.remove("hidden");
    banner.textContent = "Monthly SerpApi free tier limit approached. API requests paused to prevent overage.";
  }

  if (dataFilesFailedToLoad) {
    note.textContent = "Local data files (mock-today-prices.json / history-price.json) could not be loaded — serve this folder over http(s), not file://.";
  } else if (usedLive && usedMockFallback) {
    note.textContent = "Mixed results: some items used live SerpApi data, others fell back to demo data (no demo match, or live request blocked — likely a CORS restriction on this browser).";
  } else if (usedLive) {
    note.textContent = "Showing live SerpApi data.";
  } else if (apiKey) {
    note.textContent = "Showing demo data. Live SerpApi requests were not used (quota reached, or the request was blocked by CORS — see Settings).";
  } else {
    note.textContent = "Showing demo data. Add a SerpApi key in Settings to attempt live prices.";
  }

  document.getElementById("lastCheckedNote").textContent =
    `Checked ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  renderComparisonTable(results);
  renderFilterPanel();
  updateQuotaUI();
}

function renderComparisonTable(results) {
  lastResults = results;
  const visibleStores = computeVisibleStores(results);

  const headRow = document.getElementById("compareTableHead");
  const tbody = document.getElementById("compareTableBody");
  const tfoot = document.getElementById("compareTableFoot");

  // rebuild header, keeping the static first "ITEM" <th>
  while (headRow.children.length > 1) headRow.removeChild(headRow.lastChild);
  visibleStores.forEach((s) => {
    const th = document.createElement("th");
    th.className = "text-left font-mono font-medium px-4 py-3 whitespace-nowrap";
    th.textContent = s.toUpperCase();
    headRow.appendChild(th);
  });

  tbody.innerHTML = "";
  tfoot.innerHTML = "";

  if (visibleStores.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 99;
    td.className = "px-4 py-6 text-center text-ink/45";
    td.textContent = "No stores selected — open Filter Stores above to enable at least one.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const totals = {}; // store -> { sum, excluded, hasAny }
  visibleStores.forEach((s) => (totals[s] = { sum: 0, excluded: 0, hasAny: false }));

  Object.entries(results).forEach(([item, data]) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-paper2/60";
    const nameTd = document.createElement("td");
    nameTd.className = "px-4 py-3 text-left sticky left-0 bg-paper z-10 font-medium text-ink";
    nameTd.textContent = item;
    tr.appendChild(nameTd);

    const rowPrices = visibleStores.map((s) => data.stores && data.stores[s] ? data.stores[s].price : null);
    const minPrice = rowPrices.filter((p) => typeof p === "number").reduce((m, p) => (m === null || p < m ? p : m), null);

    visibleStores.forEach((s) => {
      const td = document.createElement("td");
      td.className = "px-4 py-3 whitespace-nowrap";
      const entry = data.stores ? data.stores[s] : null;
      if (!entry || typeof entry.price !== "number") {
        td.innerHTML = `<span class="text-ink/35">N/A</span>`;
        totals[s].excluded += 1;
      } else {
        totals[s].sum += entry.price;
        totals[s].hasAny = true;
        const isRowBest = entry.price === minPrice;
        const priceHtml = entry.on_sale && entry.old_price
          ? `<span class="text-tomato font-semibold">$${entry.price.toFixed(2)}</span> <span class="line-through text-ink/35 text-[11px]">$${entry.old_price.toFixed(2)}</span>`
          : `<span class="${isRowBest ? "font-semibold text-evergreen" : ""}">$${entry.price.toFixed(2)}</span>`;
        td.innerHTML = `<span class="price-tag ${isRowBest ? "best" : ""}">${priceHtml}</span>`;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // total row
  const totalTr = document.createElement("tr");
  totalTr.className = "bg-paper2 border-t-2 border-ink/15";
  const totalNameTd = document.createElement("td");
  totalNameTd.className = "px-4 py-3 text-left sticky left-0 bg-paper2 z-10 font-bold";
  totalNameTd.textContent = "TOTAL";
  totalTr.appendChild(totalNameTd);

  const grandMin = Object.values(totals).filter((t) => t.hasAny).reduce((m, t) => (m === null || t.sum < m ? t.sum : m), null);

  visibleStores.forEach((s) => {
    const td = document.createElement("td");
    td.className = "px-4 py-3 whitespace-nowrap font-bold";
    const t = totals[s];
    if (!t.hasAny) {
      td.innerHTML = `<span class="text-ink/35 font-normal">N/A</span>`;
    } else {
      const isBest = t.sum === grandMin;
      const excludeNote = t.excluded > 0
        ? `<span class="block text-[10px] font-normal text-ink/40">*Excludes ${t.excluded} item${t.excluded > 1 ? "s" : ""}</span>`
        : "";
      td.innerHTML = `<span class="price-tag ${isBest ? "best" : ""} ${isBest ? "text-evergreen" : ""}">$${t.sum.toFixed(2)}</span>${excludeNote}`;
    }
    totalTr.appendChild(td);
  });
  tfoot.appendChild(totalTr);
}

/* ------------------------------ history chart ---------------------------- */

function populateHistorySelect() {
  const select = document.getElementById("historyItemSelect");
  const errorBox = document.getElementById("historyLoadError");
  if (!historyData || !historyData.items) {
    select.innerHTML = '<option value="">No data available</option>';
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = dataFilesFailedToLoad
        ? "history-price.json couldn't be loaded. If you opened this file directly (file://), serve the folder over http instead — e.g. run `npx serve` in it, or view it through GitHub Pages — and reload."
        : "No history data found in history-price.json.";
    }
    return;
  }
  if (errorBox) errorBox.classList.add("hidden");
  select.innerHTML = "";
  Object.keys(historyData.items).forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  });
  const firstInList = groceryList.find((i) => historyData.items[i]);
  select.value = firstInList || Object.keys(historyData.items)[0];
  renderHistoryChart(select.value);
}

function renderHistoryChart(item) {
  if (!historyData || !historyData.items[item]) return;
  const entry = historyData.items[item];
  const datasets = STORES.map((store, i) => ({
    label: store,
    data: entry.stores[store] || [],
    borderColor: STORE_COLORS[i % STORE_COLORS.length],
    backgroundColor: STORE_COLORS[i % STORE_COLORS.length],
    spanGaps: true,
    tension: 0.25,
    pointRadius: 3,
    borderWidth: 2,
  }));

  const ctx = document.getElementById("historyChart");
  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: "line",
    data: { labels: historyData.months, datasets },
    options: {
      responsive: true,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { font: { family: "IBM Plex Mono", size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c) => c.dataset.label + ": " + (c.parsed.y == null ? "N/A" : "$" + c.parsed.y.toFixed(2)),
          },
        },
      },
      scales: {
        y: { ticks: { callback: (v) => "$" + v } },
      },
    },
  });
}

/* ------------------------------ settings modal ---------------------------- */

function openSettings() {
  document.getElementById("apiKeyInput").value = getApiKey();
  const modal = document.getElementById("settingsModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}
function closeSettings() {
  const modal = document.getElementById("settingsModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

/* ------------------------------ init ---------------------------- */

document.addEventListener("DOMContentLoaded", async () => {
  // 1) Wire up every button/listener FIRST, synchronously, before any
  // network call or chart rendering. That way, if something async below
  // throws (a CDN script failing to load, a bad data file, etc.), the
  // buttons on the page still work instead of the whole init silently
  // dying partway through.
  document.getElementById("addItemsBtn").addEventListener("click", addItemsFromInput);
  document.getElementById("listInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addItemsFromInput(); }
  });
  document.getElementById("clearListBtn").addEventListener("click", () => { groceryList = []; renderChips(); });
  document.getElementById("runCompareBtn").addEventListener("click", () => {
    runCompare().catch((err) => console.error("runCompare failed:", err));
  });
  document.getElementById("historyItemSelect").addEventListener("change", (e) => {
    try { renderHistoryChart(e.target.value); } catch (err) { console.error("renderHistoryChart failed:", err); }
  });

  document.getElementById("filterStoresBtn").addEventListener("click", () => {
    const panel = document.getElementById("filterStoresPanel");
    const btn = document.getElementById("filterStoresBtn");
    const nowHidden = panel.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!nowHidden));
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
  document.getElementById("settingsModal").addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeSettings();
  });
  document.getElementById("saveKeyBtn").addEventListener("click", () => {
    saveApiKey(document.getElementById("apiKeyInput").value);
    updateQuotaUI();
    closeSettings();
  });
  document.getElementById("forgetKeyBtn").addEventListener("click", () => {
    forgetApiKey();
    document.getElementById("apiKeyInput").value = "";
    updateQuotaUI();
  });
  document.getElementById("resetUsageBtn").addEventListener("click", resetUsage);

  // Feedback form — placeholder only, not wired to a backend yet.
  // Swap this handler out (mailto:, a hosted form service, or your own
  // endpoint) before relying on it to actually collect anything.
  document.getElementById("feedbackForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const message = document.getElementById("feedbackMessage").value.trim();
    if (!message) return;
    console.info("[placeholder] feedback submitted (not sent anywhere yet):", {
      name: document.getElementById("feedbackName").value.trim(),
      email: document.getElementById("feedbackEmail").value.trim(),
      message,
    });
    document.getElementById("feedbackForm").reset();
    const status = document.getElementById("feedbackStatus");
    status.classList.remove("hidden");
    setTimeout(() => status.classList.add("hidden"), 4000);
  });

  // 2) Now do the data-dependent setup. Each piece is isolated in its own
  // try/catch so a failure in one (e.g. the chart) can't take down another
  // (e.g. the comparison table).
  try {
    loadStoreFilter();
    renderChips();
    updateQuotaUI();
    renderComparisonTable({}); // immediate header render, before data/results exist
    renderFilterPanel();
  } catch (err) {
    console.error("Initial render failed:", err);
  }

  try {
    await loadDataFiles();
  } catch (err) {
    console.error("loadDataFiles failed:", err);
  }

  try {
    populateHistorySelect();
  } catch (err) {
    console.error("populateHistorySelect / chart render failed (often a Chart.js CDN load issue):", err);
  }

  try {
    await runCompare();
  } catch (err) {
    console.error("runCompare failed:", err);
  }
});
