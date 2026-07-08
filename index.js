  /**
 * CS2 Arbitraj Tarayıcı Bot — ÜCRETSİZ SÜRÜM
 * --------------------------------------------
 * - Steam Community Market'in HERKESE AÇIK, KEY GEREKTİRMEYEN fiyat API'sini kullanır
 *   (steamcommunity.com/market/priceoverview). Aynı endpoint hem fiyatı hem de
 *   son 24 saatteki satış hacmini (likidite göstergesi) verir.
 * - CSFloat'ın ücretsiz API key'i ile aktif buy_now listing'lerini çeker.
 * - markup% = (csfloat_price - steam_price) / steam_price * 100
 *   Negatif değer = CSFloat, Steam'den daha ucuz (senin "ROI -%10/-15" kriterin).
 *   Pozitif değer = CSFloat, Steam'den daha pahalı (senin "en fazla %7-8 şişen" kriterin).
 * - MIN_VOLUME ile Steam'de günde en az X kere satılmayan (likit olmayan) itemler elenir.
 * - GitHub Actions üzerinde zamanlanmış (cron) olarak, HER SEFERİNDE BİR KERE
 *   çalışıp kapanacak şekilde tasarlandı (sürekli açık sunucu YOK, tamamen ücretsiz).
 * - Aynı fırsatı tekrar tekrar bildirmemek için state.json dosyasına
 *   son görülen listing id'lerini yazar; workflow bu dosyayı repo'ya geri commit'ler.
 *
 * ÖNEMLİ: Bu script SADECE TARAR ve Telegram'a bildirim atar.
 * Otomatik alım/satım YAPMAZ.
 */

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const {
  CSFLOAT_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  MIN_MARKUP_PCT = '-15',
  MAX_MARKUP_PCT = '-10',
  MIN_STEAM_PRICE = '0.5',
  MIN_VOLUME = '20',
  MAX_ITEMS_PER_RUN = '35',
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
  const minPriceCents = Math.round(parseFloat(MIN_STEAM_PRICE || '0.5') * 100);
  const url = `https://csfloat.com/api/v1/listings?sort_by=lowest_price&limit=50&min_price=${minPriceCents}`;
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

// Steam'in herkese açık, key gerektirmeyen fiyat+hacim endpoint'i.
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
  const price = parseFloat(data.lowest_price.replace(/[^0-9.,]/g, '').replace(',', '.'));
  const volume = data.volume ? parseInt(String(data.volume).replace(/,/g, ''), 10) : 0;
  if (isNaN(price)) return null;
  return { price, volume: isNaN(volume) ? 0 : volume };
}

async function scanOnce() {
  console.log(`[${new Date().toISOString()}] Tarama başlıyor...`);
  await tgSend('✅ Bot çalışıyor, tarama başladı.');

  const state = loadState();
  const seenSet = new Set(state.seen);

  const minMarkup = parseFloat(MIN_MARKUP_PCT);
  const maxMarkup = parseFloat(MAX_MARKUP_PCT);
  const minSteamPrice = parseFloat(MIN_STEAM_PRICE);
  const minVolume = parseFloat(MIN_VOLUME);
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

    const steamData = await fetchSteamPrice(name);
    checked++;
    await sleep(2000);

    if (!steamData) continue;
    const { price: steamPrice, volume } = steamData;

    if (steamPrice < minSteamPrice) continue;
    if (volume < minVolume) {
      console.log(`  ${name} | Steam $${steamPrice.toFixed(2)} | hacim ${volume} < ${minVolume}, ELENDİ (likidite)`);
      continue;
    }

    const csfloatPrice = listing.price / 100;
    const markupPct = ((csfloatPrice - steamPrice) / steamPrice) * 100;

    console.log(
      `  ${name} | CSFloat $${csfloatPrice.toFixed(2)} | Steam $${steamPrice.toFixed(2)} | markup ${markupPct.toFixed(1)}% | hacim ${volume}`
    );

    if (markupPct >= minMarkup && markupPct <= maxMarkup) {
      hits++;
      seenSet.add(key);

      const msg =
        `🎯 <b>Fırsat bulundu</b>\n` +
        `<b>${name}</b>\n` +
        `CSFloat: $${csfloatPrice.toFixed(2)} (markup: ${markupPct.toFixed(1)}%)\n` +
        `Steam: $${steamPrice.toFixed(2)} (günlük satış: ${volume})\n` +
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
