const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const {
  CSFLOAT_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  MIN_MARKUP_PCT = '0',
  MAX_MARKUP_PCT = '8',
  MIN_STEAM_PRICE = '5',
  MAX_ITEMS_PER_RUN = '25',
} = process.env;

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { seen: [] };
  }
}

function saveState(state) {
  const trimmed = state.seen.slice(-3000);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ seen: trimmed }, null, 2));
}

async function tgSend(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Telegram env eksik, mesaj atlanıyor.');
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('Telegram HATA:', res.status, body);
    } else {
      console.log('Telegram mesajı GÖNDERİLDİ.');
    }
  } catch (e) {
    console.error('Telegram gönderim hatası (network):', e.message);
  }
}

async function fetchCsfloatListings() {
  const url = `https://csfloat.com/api/v1/listings?sort_by=lowest_price&limit=50`;
  const res = await fetch(url, {
    headers: { Authorization: CSFLOAT_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`CSFloat API hata: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSteamPrice(marketHashName, retry = true) {
  const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${encodeURIComponent(
    marketHashName
  )}`;
  const res = await fetch(url);
  if (res.status === 429) {
    if (retry) {
      console.warn('Rate limit, 8sn bekleyip tekrar deneniyor:', marketHashName);
      await sleep(8000);
      return fetchSteamPrice(marketHashName, false);
    }
    console.warn('Steam rate limit — bu item atlanıyor:', marketHashName);
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.success || !data.lowest_price) return null;
  const num = parseFloat(data.lowest_price.replace(/[^0-9.,]/g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

async function scanOnce() {
  console.log(`[${new Date().toISOString()}] Tarama başlıyor...`);
  await tgSend('✅ Bot çalışıyor, tarama başladı.');

  const state = loadState();
  const seenSet = new Set(state.seen);

  const minMarkup = parseFloat(MIN_MARKUP_PCT);
  const maxMarkup = parseFloat(MAX_MARKUP_PCT);
  const minSteamPrice = parseFloat(MIN_STEAM_PRICE);
  const maxItems = parseInt(MAX_ITEMS_PER_RUN, 10);

  const listings = await fetchCsfloatListings();
  console.log(`${listings.length} CSFloat listing çekildi.`);

  let checked = 0;
  let hits = 0;

  for (const listing of listings) {
    if (checked >= maxItems) break;

    const name = listing.item?.market_hash_name;
    if (!name) continue;

    const key = `${name}-${listing.id}`;
    if (seenSet.has(key)) continue;

    const steamPrice = await fetchSteamPrice(name);
    checked++;
    await sleep(3000);

    if (!steamPrice || steamPrice < minSteamPrice) continue;

    const csfloatPrice = listing.price / 100;
    const markupPct = ((csfloatPrice - steamPrice) / steamPrice) * 100;

    if (markupPct >= minMarkup && markupPct <= maxMarkup) {
      hits++;
      seenSet.add(key);

      const msg =
        `🎯 <b>Fırsat bulundu</b>\n` +
        `<b>${name}</b>\n` +
        `CSFloat: $${csfloatPrice.toFixed(2)} (markup: ${markupPct.toFixed(1)}%)\n` +
        `Steam: $${steamPrice.toFixed(2)}\n` +
        `Link: https://csfloat.com/item/${listing.id}`;

      await tgSend(msg);
    }
  }

  state.seen = Array.from(seenSet);
  saveState(state);

  console.log(`Tarama bitti. ${checked} item kontrol edildi, ${hits} yeni fırsat bulundu.`);
}

scanOnce().catch(async (e) => {
  console.error('Tarama hatası:', e.message);
  await tgSend(`⚠️ Bot hata verdi: ${e.message}`);
  process.exit(1);
});
