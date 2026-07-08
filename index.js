/**
 * CS2 Arbitraj Tarayıcı Bot — ÜCRETSİZ SÜRÜM (v2 — Steam rate limit sorunu çözüldü)
 * -----------------------------------------------------------------------------
 * ÖNEMLİ KEŞİF: CSFloat'ın kendi API'si, her listing için Steam Community Market
 * fiyatını ve hacmini zaten "item.scm.price" / "item.scm.volume" alanlarında veriyor.
 * Bu yüzden artık Steam'e AYRI istek atmıyoruz — rate limit sorunu tamamen bitti,
 * tarama çok daha hızlı ve güvenilir.
 *
 * - sort_by=highest_discount: CSFloat'ın kendi hesapladığı, Steam'e göre en çok
 *   indirimli item'leri en üstte getirir — tam olarak aradığımız "ucuz kalmış" itemler.
 * - markup% = (csfloat_price - scm_price) / scm_price * 100
 *   Negatif değer = CSFloat, Steam'den daha ucuz (ROI kriterin).
 * - MIN_VOLUME ile Steam'de az satılan (likit olmayan) itemler elenir.
 * - GitHub Actions üzerinde zamanlanmış (cron) olarak, HER SEFERİNDE BİR KERE
 *   çalışıp kapanacak şekilde tasarlandı.
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
  MIN_MARKUP_PCT = '-20',
  MAX_MARKUP_PCT = '-5',
  MIN_STEAM_PRICE = '0.5',
  MIN_VOLUME = '20',
  MAX_ITEMS_PER_RUN = '50',
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
  const url = `https://csfloat.com/api/v1/listings?sort_by=highest_discount&limit=50&min_price=${minPriceCents}`;
  const res = await fetch(url, {
    headers: { Authorization: CSFLOAT_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`CSFloat API hata: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
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
  console.log(`${listings.length} CSFloat listing çekildi (Steam verisi dahil, ekstra istek yok).`);

  let checked = 0;
  let hits = 0;
  let noScmData = 0;

  for (const listing of listings) {
    if (checked >= maxItems) break;
    checked++;

    const name = listing.item?.market_hash_name;
    if (!name) continue;

    const key = `${name}-${listing.id}`;
    if (seenSet.has(key)) continue;

    const scm = listing.item?.scm;
    if (!scm || !scm.price) {
      noScmData++;
      console.log(`  ${name} | Steam (scm) verisi yok, atlanıyor`);
      continue;
    }

    const steamPrice = scm.price / 100;
    const volume = scm.volume || 0;

    if (steamPrice < minSteamPrice) {
      console.log(`  ${name} | Steam $${steamPrice.toFixed(2)} < $${minSteamPrice} eşiği, ELENDİ (fiyat)`);
      continue;
    }
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

  console.log(`Tarama bitti. ${checked} item kontrol edildi, ${noScmData} veri eksikti, ${hits} yeni fırsat bulundu.`);
}

scanOnce().catch(async (e) => {
  console.error('Tarama hatası:', e.message);
  await tgSend(`⚠️ Bot hata verdi: ${e.message}`);
  process.exit(1);
});
