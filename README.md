# CS2 Arbitraj Tarayıcı Bot — Ücretsiz Sürüm

Hiçbir ücretli servis kullanmadan çalışır:
- **Steam fiyatı**: Steam'in herkese açık, key gerektirmeyen `priceoverview` endpoint'i
- **CSFloat fiyatı**: CSFloat'ın ücretsiz API key'i
- **Bildirim**: Telegram bot (ücretsiz)
- **Çalıştığı yer**: GitHub Actions (public repo'da tamamen ücretsiz, sunucu kirası yok)

Bot **otomatik alım-satım yapmaz**, sadece fırsatı bulup Telegram'a bildirim atar. Trade'i sen manuel yaparsın.

## Kurulum

### 1) Telegram bot
1. Telegram'da `@BotFather` → `/newbot` → isim ver → **token**'ı kopyala.
2. `@userinfobot`'a `/start` yaz → **chat id**'ni al.

### 2) CSFloat API key
csfloat.com/profile → **Developer** sekmesi → key oluştur (ücretsiz).

### 3) GitHub'a yükle
1. Bu klasörü yeni bir **public** GitHub reposu yap (private repo'da Actions dakikaları sınırlı, public'te sınırsız/ücretsiz).
2. Repo → **Settings → Secrets and variables → Actions → New repository secret** ile şu 3 secret'ı ekle:
   - `CSFLOAT_API_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. Repo → **Actions** sekmesine git, workflow'u göreceksin. İlk çalıştırma için sağ üstten **"Run workflow"** ile manuel tetikleyebilirsin (cron'un ilk tetiklemesini beklemek istemezsen).

Bu kadar — repo'ya her push sonrası ve her 20 dakikada bir otomatik çalışacak.

## Eşik değerlerini değiştirmek istersen

`.github/workflows/scan.yml` içindeki şu satırları düzenle:
```yaml
MIN_MARKUP_PCT: '0'    # CSFloat'ın Steam'e göre en az ne kadar şişmesi gerektiği
MAX_MARKUP_PCT: '8'    # en fazla ne kadar şişmesi gerektiği
MIN_STEAM_PRICE: '5'   # bu fiyatın altındaki itemleri filtrele (likidite için)
MAX_ITEMS_PER_RUN: '40' # bir çalıştırmada en fazla kaç item kontrol edilsin
```

## Bilinmesi gerekenler / sınırlamalar

- **Hız**: Steam'in ücretsiz API'si rate-limit'li olduğu için her item sorgusu arasında ~1.5 saniye bekleme var. Bu yüzden bir çalıştırmada en fazla ~40 item kontrol edilebiliyor (40 item × 1.5sn ≈ 1 dakika + CSFloat sorgusu). İstersen `MAX_ITEMS_PER_RUN`'ı artırabilirsin ama Steam seni geçici olarak (birkaç dakikalığına) engelleyebilir.
- **Cron gecikmesi**: GitHub Actions'ın zamanlanmış görevleri tam dakikasında değil, yoğunluğa göre birkaç dakika gecikmeli tetiklenebilir. Bu normal.
- **ROI karşılaştırması**: Ücretsiz sürümde sadece CSFloat vs Steam markup'ına bakılıyor; Pricempire'daki gibi buff163/skinport gibi ekstra kaynak karşılaştırması yok (o özellik Pricempire'ın ücretli planında).
- **Para transferi yok**: Steam Wallet bakiyesi Steam dışına çıkarılamaz — gerçek işlem, item'i trade offer ile taşıyıp uygun yerde satmaktır. Steam'in **7 günlük trade hold** süresine dikkat et.
- **Otomatik trade yok**: CSFloat/Steam'de tam otomatik alım-satım scripti ToS ihlali olup hesap banına yol açabilir; bu yüzden bot sadece bildirim atıyor, işlemi sen yapıyorsun.
- Bildirim geldiğinde item hâlâ satışta olmayabilir — CSFloat'ta popüler fırsatlar saniyeler içinde satılabiliyor.
