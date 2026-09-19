# MKE A.Ş. — Kurumsal B2G/B2B/B2C CRM

React (Vite + TypeScript) arayüz, Express + Prisma + PostgreSQL servis katmanı.

> **Not:** Bu depo boştu; proje sıfırdan kurulmuştur. Şartnamedeki "mevcut
> kodu denetle" başlığı, denetlenecek bir kod tabanı bulunmadığı için
> **tasarım kararları olarak** uygulanmıştır — aşağıdaki *Güvenlik Mimarisi*
> bölümü her riski ve karşılığını dosya referansıyla listeler.

---

## Kurulum

### Docker ile (önerilen)

```bash
cp .env.example .env            # sırları doldurun
docker compose up -d --build
docker compose exec backend npx prisma db seed
```

Arayüz: <http://localhost:8080> · API: <http://localhost:4000/api/v1>

### Yerel geliştirme

```bash
# Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                     # http://localhost:4000

# Frontend (ayrı terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Tohum verisi 81 il + 56 uluslararası şehir koordinatını, 5 departmanı,
6 kullanıcıyı, 51 şirketi (yurt içi + yurt dışı; B2G/B2B/B2C/G2G dengeli),
bunlara bağlı kişileri, satış fırsatlarını ve ihaleleri, ürün kataloğunu ve
özel alan tanımlarını, ambalaj/lojistik verilerini ve 3 protokol ziyaretini
(program, katılımcı ve kontrol listesiyle) yükler — harita ilk açılışta dolu gelir.
Geliştirme şifresi: `MkeCrm!2026` (ör. `admin@mke.gov.tr`).

---

## Güvenlik Mimarisi

### 1. Yetki sızıntısı (privilege escalation)

| Risk | Karşılık | Dosya |
|---|---|---|
| Token içindeki `role` claim'ine güvenmek | Her istekte kullanıcı DB'den tazelenir; yetkiler **güncel role** göre türetilir, payload'dan değil | `middleware/auth.ts` |
| Rotalarda serbest metin izin adı (yazım hatası = sessiz izin) | İzinler tek bir `Permission` birleşim tipinde; hatalı ad **derleme zamanında** yakalanır | `middleware/permissions.ts` |
| Kullanıcının kendini yükseltmesi | `PUT /users/me` şeması `role`, `isActive`, `departmentId` alanlarını **kabul etmez** (kütle atama savunması) | `routes/users.routes.ts` |
| Yöneticinin kendi seviyesini aşan rol ataması | `canAssignRole()` — yalnızca ADMIN atar ve kendi rütbesini aşamaz | `middleware/permissions.ts` |
| Rolü düşürülen kullanıcının eski token'ıyla çalışması | Rol/erişim değişimi `tokenVersion`'ı artırır, tüm token'lar anında ölür | `routes/users.routes.ts` |
| Son yöneticinin sistemi kilitlemesi | Son etkin ADMIN silinemez / düşürülemez | `routes/users.routes.ts` |

### 2. IDOR (yetkisiz kayda erişim)

İzin kontrolü tek başına IDOR'u engellemez: `deal:read` izni olan bir satışçı
`/deals/:id` üzerinden başka departmanın kaydını okuyabilir. Bu yüzden
**her sorguya kullanıcı kapsamı bir `where` parçası olarak enjekte edilir**
(`companyScope()` — `middleware/rbac.ts`). Kapsam dışındaki kayıt için 403
değil **404** döndürülür; aksi halde "403 = kayıt var" bilgisi varlık
numaralandırmaya yol açardı.

Kapsam, şirkete bağlı tüm alt kayıtlara (kişi, fırsat, teklif, ihale,
sözleşme, destek, görev, e-posta, zaman tüneli) devredilir. Yapışkan notlar
`userId` ile, kişisel görevler sahibiyle kapsanır.

### 3. Token geçersiz kılma (invalidation)

- **Kısa ömürlü access token** (15 dk) + **httpOnly, SameSite=strict refresh çerezi**.
  Access token belleğe yazılır, `localStorage`'a **yazılmaz** (XSS yüzeyi).
- **`tokenVersion`** — şifre değişimi, rol değişimi, `logout-all` ve yenileme
  anahtarı yeniden kullanımı bu sayacı artırır; dağıtılmış tüm token'lar ölür.
- **jti kara listesi** (`RevokedToken`) — tek bir çıkışta o access token ölür.
  Tablo `trashCleanup` ile süresi dolan kayıtlardan temizlenir.
- **Refresh rotation + yeniden kullanım tespiti** — her yenileme anahtarı tek
  kullanımlıktır; ikinci kez gelirse çalınma varsayılır ve kullanıcının **tüm**
  oturumları düşürülür (`routes/auth.routes.ts`).

### 4. Kaba kuvvet (brute force)

| Katman | Ayar |
|---|---|
| Hız sınırı — giriş | 15 dk / 10 deneme, anahtar **IP + hesap** bileşimi (yalnız IP ofisi kilitler, yalnız hesap dağıtık saldırıyı kaçırır) |
| Hız sınırı — MFA | 10 dk / 6 deneme |
| Kalıcı hesap kilidi | 5 hatalı denemede 15 dk |
| Zamanlama sızıntısı | Kullanıcı bulunamadığında da bcrypt maliyeti ödenir (`burnTiming()`) |
| TOTP penceresi | ±1 adım (30 sn) — geniş pencere 6 haneli kodun arama uzayını büyütür |
| MFA yarım oturum | `mfa=false` token'lar `requireMfaComplete` dışındaki **tüm** rotalarda reddedilir |

MFA kurulumu, kullanıcı geçerli bir kod göstermeden etkinleşmez (kendini
kilitleme koruması). Kurtarma kodları bcrypt ile saklanır ve **tek kullanımlıktır**.

### 5. Veri bütünlüğü — Soft delete vs. Cascade

Şirket silindiğinde ilişkili tüm kayıtlar **aynı transaction içinde** yumuşak
silinir; geri yükleme, birlikte silinenleri (±5 sn penceresi) geri getirir —
daha önce ayrıca silinmiş kayıtlar çöp kutusunda kalır.

**`trashCleanup.ts` yetim kayıt riskini iki aşamada kapatır:**

1. Süresi dolan **şirketler** kalıcı silinir → şemadaki `onDelete: Cascade`
   alt kayıtları toplar.
2. `Cascade` yalnızca şirket silinince devreye girer. Şirketi hâlâ ayakta olan
   ama kendisi süresi dolmuş fırsat/teklif/sözleşme/kişi kayıtları **hiçbir
   cascade tarafından toplanmaz**; bunlar ayrıca taranıp silinir.
3. `SetNull` ilişkiler yüzünden geride kalan **bağlantısız aktiviteler** ve
   süresi dolmuş kimlik doğrulama kayıtları da temizlenir.

### 6. Performans — sayfalama ve indeksleme

- **Sayfalama zorunludur.** `parsePagination()` üst sınırı sunucuda sabitler
  (200); istemci `pageSize=100000` göndererek tabloyu dökemez.
- **Sıralama beyaz listeye dayalıdır** (`buildOrderBy`) — ham girdi `orderBy`'a geçmez.
- **Harita** ayrı bir uçtan (`GET /companies/map`) beslenir, 2000 nokta ile
  sınırlıdır ve liste ucunun ağır `include` yükünü taşımaz.
- **Denetim tablosu** en hızlı büyüyen tablodur: üst sınır 100, erişim deseni
  `@@index([createdAt])` ve `@@index([userId, createdAt])` ile karşılanır.
- **Arama** tür başına ayrı ve sınırlı sorgu çalıştırır (tek dev UNION yerine);
  telefon araması `normalizedNumber` indeksi üzerinden gider.
- Şemada ~60 indeks tanımlıdır: `deletedAt`, `companyId`, `createdAt`,
  `(stage, deletedAt)`, `(dueDate, status)`, `(birthMonth, birthDay)`,
  `(latitude, longitude)` ve benzeri erişim desenleri kapsanır.

### 7. Diğer

- **Hata yüzeyi** — Prisma sorgu gövdeleri ve stack izleri istemciye sızmaz;
  5xx'te genel mesaj döner, ayrıntı loga yazılır (`middleware/errorHandler.ts`).
- **Denetim kaydı** — şifre, MFA anahtarı ve token alanları `[REDACTED]`
  olarak yazılır (`middleware/audit.ts`).
- **Yedekleme** — JSON dökümü kimlik doğrulama sırlarını **içermez** ve akış
  olarak yazılır (bellekte toplanmaz).
- **XSS** — AI çıktısı ve harita popup'ları `dangerouslySetInnerHTML`/`innerHTML`
  yerine DOM düğümü / React düğümü olarak üretilir; giden kutusu kayıtlı HTML'i
  render etmez, düz metin gösterir.

---

## Modüller

| Alan | Uçlar |
|---|---|
| Kimlik | `/auth/login`, `/refresh`, `/logout`, `/logout-all`, `/me`, `/change-password` |
| MFA | `/mfa/setup`, `/enable`, `/verify`, `/disable`, `/status` |
| Müşteri | `/companies` (+ `/map`, `/trash`, `/:id/restore`, `/:id/stage`, `/:id/timeline`) |
| Kişi | `/contacts` (+ `/:id/avatar`) — çoklu telefon, esnek doğum günü |
| Satış | `/deals` (+ `/pipeline`, `/:id/stage`), `/offers`, `/tenders`, `/contracts` (+ `/:id/milestones`) |
| Operasyon | `/products` (+ `/import-csv`), `/tickets`, `/tasks` (+ `/overdue`, `/:id/complete`), `/calendar` |
| İletişim | `/email/send`, `/email/outbox` — yerel simülatör |
| Akıllı | `/ai/stream` (SSE), `/ai/generate`, `/ai/status`, `/ai/save-to-timeline` |
| Protokol | `/protocol-visits` (+ `/:id/agenda`, `/:id/participants`, `/:id/checklist`) |
| Arşiv | `/documents` (+ `/:id/download`, `/stats`) |
| Sistem | `/exchange-rates` (+ `/sync`, elle `PUT`), `/audit-logs`, `/custom-fields`, `/dashboard`, `/users`, `/notes`, `/system/backup`, `/system/settings` |

### AI akışı (SSE)

`POST /api/v1/ai/stream` token bazlı Server-Sent Events döndürür:

```
event: meta   → { title, contextSummary, model, streamedAt }
event: token  → { text }
event: done   → { finished, characters }
event: error  → { message }
```

Veri **JSON kodludur**: ham token'lar satır sonu içerebilir ve SSE'de satır
sonu kare ayıracıdır. Yetki ve bağlam doğrulaması akış **açılmadan önce**
yapılır, böylece hatalar normal JSON gövdesiyle dönebilir; akış açıldıktan
sonra oluşan hata `event: error` karesi olarak iletilir.

İstemci tarafında `EventSource` kullanılamaz (yalnızca GET destekler ve
`Authorization` başlığı taşıyamaz); akış `fetch` + `ReadableStream` ile
çözülür (`frontend/src/api/client.ts` → `streamSse`).

`ANTHROPIC_API_KEY` tanımlı değilse **hiçbir veri dışarı çıkmaz**; yerel
kural tabanlı motor CRM kayıtlarından brifing üretir.

### Protokol & Heyet Programı

Yabancı askerî ataşe ve delegasyon ziyaretleri için ayrı bir modül:
saat saat **ziyaret akış programı**, **katılımcı yönetimi** (misafir heyet +
eşlik eden MKE personeli), **karşılama kontrol listesi** ve **evrak ekleri**.

Katılımcı listesinde gelmeyen kişi **silinmez, üstü çizilir**: heyet listesi
resmî bir belgedir ve kimin gelmediği de bilgidir.

### Belge deposu

Pazar analiz raporları, ülke brifingleri ve kurumsal evrak arşivi.
Dosya içeriği veritabanında `Bytes` olarak tutulur (7 MB üst sınır) —
ayrı bir nesne deposu bağlanana kadar Docker'da ek hacim yapılandırması
gerektirmeyen en basit çalışan çözüm. Kabul edilen türler beyaz listede
tutulur; indirme her zaman `Content-Disposition: attachment` ile yapılır ve
**gizlilik dereceli evrakın kim tarafından indirildiği denetim kaydına yazılır**.

### AI sağlayıcı ve yerel motor

`ANTHROPIC_API_KEY` tanımlı değilken devreye giren yerel motor **artık
veritabanını sorgular**: "bu haftaki etkinlikler", "toplam fırsatlar",
"gecikmiş görevler", "kritik stok", "kayıp nedenleri", "yaklaşan ziyaretler"
gibi soruları niyet sınıflandırmasıyla tanıyıp gerçek kayıtlardan yanıtlar.
Bir niyet tanınmazsa bunu açıkça söyler ve neleri yanıtlayabildiğini
listeler — uydurma yapmaz.

API anahtarı **Ayarlar → AI Sağlayıcı** bölümünden girilebilir; veritabanında
AES-256-GCM ile şifreli saklanır ve API yanıtlarında asla düz metin dönmez
(yalnızca maskelenmiş önizleme). Sunucuyu yeniden başlatmak gerekmez.

### Döviz kuru

Değerleme **anlıktır**; kur yalnızca resmiyet kazanmış belgelerde donar.
Ayrıntı için aşağıdaki "Kur mimarisi — anlık değerleme" bölümüne bakın.

### Uluslararası lokasyon desteği

MKE yurt dışı pazarlarda da çalıştığı için konum modeli Türkiye'ye bağlı değildir:

- `City` tablosu hem 81 ili (plaka koduyla) hem uluslararası şehirleri tutar.
  Benzersizlik `@@unique([countryCode, name])` ile tanımlıdır — şehir adı
  küresel olarak benzersiz değildir (ör. Tripoli/LB ve Tripoli/LY).
- `Company.country` + `countryCode` alanları vardır (varsayılan Türkiye/TR).
  **Şehir seçildiğinde ülke o kayıttan türetilir**, böylece "Berlin seçip
  ülke Türkiye kalması" gibi tutarsızlık imkânsızdır (`resolveLocation()`).
- Listede bulunmayan lokasyonlar için `Company.cityName` serbest metin alanı
  ve elle `latitude`/`longitude` girişi vardır; elle girilen koordinat
  sunucu tarafından **asla ezilmez**.
- Şirket, fırsat ve ihale listeleri `?scope=domestic|international` ve
  `?countryCode=XX` ile süzülür. Fırsat/ihale kaydında konum tekrarlanmaz —
  filtre şirket ilişkisi üzerinden çalışır, böylece veri tek yerde durur.
- Harita `minZoom: 2` ile küreseldir; ilk yüklemede görünür kayıtları
  kadraja alır (kayıtlar yalnızca yurt dışındaysa boş Türkiye haritası
  görünmez). "Türkiye'ye Dön" ve "Verilere Sığdır" düğmeleri mevcuttur.

#### Harita karoları

Karolar **anahtarsız, ücretsiz** CARTO Voyager CDN'inden gelir:

```
https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png
```

**Neden OSM değil:** standart OSM karolarında etiketler yerel dilde basılır
(Arapça, Yunanca, Rusça). Savunma sanayii ihracat haritasında şehir ve ülke
adlarının okunabilir olması şarttır; CARTO'nun bu uç noktası küresel olarak
İngilizce etiket kullanır.

**Anahtar gerekmez.** Filigran basan sağlayıcılar CARTO'nun ticari
"basemaps API" ürünleridir; `basemaps.cartocdn.com/rastertiles/...` yolu
ücretsiz genel CDN'dir. `{r}` retina sonekidir — Leaflet yüksek DPI
ekranlarda `@2x` koyar, normal ekranlarda boş bırakır.

#### Marker kümeleme

Her **benzersiz koordinat için tek bir marker** çizilir. Şehir merkezine
düşen kayıtların koordinatı birebir aynı olduğundan gruplama yakınlığa göre
değil, koordinat anahtarına göre yapılır; sonuç zoom seviyesinden bağımsız
olarak kararlıdır ve harici bir kümeleme eklentisi gerekmez.

Marker'a tıklanınca açılan popup o koordinattaki **tüm kurumları**
kaydırılabilir bir liste hâlinde gösterir: şirket adı, tipi (renkli rozet)
ve fırsat sayısı. Liste 260px'de kesilip kendi içinde kayar, bir satıra
tıklamak kurum detayına gider. Böylece hiçbir kayıt bir diğerinin altında
kalmaz.

### Kur mimarisi — anlık değerleme

**Kayıtlar veritabanında yalnızca kendi para birimiyle saklanır.** Bir fırsat
100.000 USD ise DB'de `amount = 100000, currency = 'USD'` yazar; TL karşılığı
**hiçbir yerde saklanmaz**. Liste, gösterge paneli ve hunide TL/USD karşılığı
**istek anında** hesaplanır (`currency.service.liveValue`). Bir ay önce girilen
100.000 $'lık fırsat, bugün bakıldığında bugünkü kurla görünür.

Tek istisna **resmiyet kazanmış belgelerdir**: sözleşmeler ve onaylanmış
teklifler. Bunlarda `exchangeRateAtCreation` alanı doldurulur ve arayüzde iki
değer yan yana gösterilir:

> İmza Tarihindeki Değeri: 3.180.000 ₺ — Güncel Piyasa Değeri: 4.240.000 ₺

Hangi kaydın donacağına `shouldFreezeRate(entity, status)` karar verir:
sözleşmede `status !== 'Taslak'`, teklifte `status ∈ {Gönderildi, Kabul}`.
Taslak hâldeyken kur donmaz — henüz bağlayıcı bir belge yoktur.

`exchangeRateAtCreation` alanı Prisma'da `@map("exchangeRate")` ile eski sütun
adına bağlıdır: **veri kaybı olmadan** yeniden adlandırma.

#### Senkronizasyon

`exchangeRateSync.ts` üç katmanlıdır:

1. **TCMB** `today.xml` — resmî efektif satış kuru.
2. **Frankfurter (ECB)** — TCMB erişilemezse anahtarsız yedek kaynak.
3. **Son geçerli kur** — ikisi de erişilemezse veritabanındaki değer korunur
   (silinmez, 1.0'a düşürülmez).

Sıklık sabit değildir: `isTcmbBusinessWindow()` `Europe/Istanbul` saatiyle
Pazartesi–Cuma 08:00–20:00 aralığında **30 dakikada bir** (`EXCHANGE_SYNC_INTERVAL_MINUTES`),
dışında 4 saatte bir çeker. Hafta sonu ve gece TCMB zaten yeni kur yayınlamaz.

Dışarı giden tek bilgi "kur listesi istiyorum"dur — gövdede, sorgu dizesinde
veya başlıkta hiçbir müşteri verisi yoktur.

#### Arayüz

Sol alttaki USD/EUR göstergesi (`RateWidget.tsx`) canlı piyasa değerini
gösterir; tıklanınca para birimi başına kur, kaynak etiketi
(`TCMB efektif satış` / `ECB referans (yedek)` / `Elle girilmiş`), tazelik
uyarısı ve **"Kurları Şimdi Güncelle"** düğmesi (ADMIN/MANAGER) açılır.
`useExchangeRates` modül düzeyinde önbellek + abone kümesi tutar: bir bileşende
yapılan yenileme **tüm ekranı** aynı anda günceller.

Ağ tamamen kapalıysa elle kur girişi (`setManualRate`) kaynağı `MANUEL` olarak
işaretler ve arayüz bunu açıkça yazar.

---

## Marka kimliği

Uygulama MKE A.Ş. kurumsal kimlik kılavuzuna göre giydirilmiştir.

| Rol | Değer | Kullanım |
| --- | --- | --- |
| Ana renk | `#0A192F` / `#0D1F3C` | Sidebar, üst bar, birincil düğme, modal başlığı |
| Aksiyon | `#E31E24` (MKE Kırmızısı) | Aktif sekme, CTA, kritik rozet |
| İkincil vurgu | `#C5A059` (Savunma bronzu) | Ayraç, seçili satır kenarı, filigran |
| Zemin | `#F4F7F9` | Sayfa arka planı |
| Çizgi | `#C4C7C8` | Kenarlık, ayraç |

> **Palet değişikliği notu.** Önceki turda marka kılavuzundaki lacivert
> `#002845` + turkuaz `#45B4AA` uygulanmıştı. Bu tur talep edilen
> lacivert `#0A192F` + kırmızı `#E31E24` + bronz `#C5A059` şeması
> yürürlüktedir; eski turkuaz değişkenleri geriye dönük takma ad olarak
> korunmuş ve yeni palete yönlendirilmiştir.
>
> Kırmızı bu palette **vurgu** rengidir, "tehlike" rengi değil. Anlamı
> renkten gelen yerler (bilgi rozeti mavi, tamamlanan iş yeşil, ilerleme
> çubuğu yeşil) bilinçli olarak kendi rengini korur — aksi halde
> "tamamlandı" işareti kırmızı görünür ve kullanıcı onu hata sanardı.

**Tipografi.** Başlık, modül adı, KPI sayacı ve tablo sütun başlıkları
**Barlow Condensed** (SemiBold/Bold, `--font-display`); form, tablo ve gövde
metni **Inter**. Fontlar `index.html` içinden Google Fonts ile yüklenir —
**kapalı ağda bu istek sessizce başarısız olur** ve CSS'teki sistem font
zinciri devreye girer, arayüz bozulmaz.

**Geometrik doku.** Kılavuz s.22'deki çift çeperli sekiz köşeli Türk Yıldızı
(`MkeStar.tsx`) filigran olarak üç yerde kullanılır: giriş ekranı (%5),
sidebar alt köşesi (%6) ve boş durum ekranları (%4). Boş durumlarda motif
29 ayrı çağrı noktasına bileşen eklenmesin diye `.empty-state::before`
pseudo-element'inde **data-URI SVG** olarak gömülüdür — ek ağ isteği yok,
DOM'a düğüm eklenmez, ekran okuyucu okumaz.

**Rozetler.** Durum etiketleri tek tip hap (pill) biçimindedir —
yarı saydam zemin + doygun metin rengi.

**Yüzey dili.** Ana paneller (kart, tablo kabı, modal, takvim, harita
kutuları) sert 1px kenarlık taşımaz; ayrım yumuşak gölge ve yüzey rengi
farkıyla kurulur. Çalışma alanı zemini `#F4F7F9`, paneller beyaz ve 16px
yuvarlak köşeli, gölge `0 4px 24px -2px rgba(0, 40, 69, 0.05)`. Düğmeler
8px yuvarlak. Tablo satırları 16px dikey boşlukla ferahtır; başlık satırı
yumuşak gri zeminde Barlow Condensed büyük harf, satır üzerine gelince
zemin `#F1F5F9`'a döner — renk değişir, satır yerinden oynamaz.

**Sidebar.** Tam `#002845`. Aktif sekme tüm satırı boyamaz: köşeleri
yuvarlatılmış turkuaz (`#45B4AA`) bir düğme gibi durur, metni lacivert olur.

Proje Tailwind kullanmaz; yukarıdaki değerler `styles.css` içinde CSS
değişkenleri olarak tanımlıdır (`--bg`, `--radius`, `--radius-btn`,
`--shadow-md`, `--row-hover`, `--th-bg`). Tek noktadan değiştirilirler.


---

## Bilinen sınırlar

- **E-posta gerçekten gönderilmez.** Kurumsal SMTP tanımlanana kadar yerel
  simülatör çalışır; mesaj `EmailQueue`'ya `SENT` olarak yazılır ve zaman
  tüneline düşer. Gerçek gönderime geçerken yalnızca `email.routes.ts`
  içindeki yazma adımı bir SMTP çağrısıyla değiştirilir.
- **WhatsApp mesajı CRM'den gönderilmez.** Resmî Business API ayrı bir
  kurumsal onay sürecidir; modal `wa.me` bağlantısı üretir.
- **Sözleşme PDF'i** tarayıcının yazdırma motoruyla üretilir (ek bağımlılık yok).


---

## Docker ile ayağa kaldırma

```bash
cp .env.example .env     # JWT_ACCESS_SECRET ve JWT_REFRESH_SECRET doldurun
docker compose up --build
```

Arayüz `http://localhost:8080`, API `http://localhost:4000`.

Örnek veriyi yüklemek için (harita boş görünmesin):

```bash
docker compose exec backend npx tsx prisma/seed.ts
```

### Derleme kararlılığı için kalıcı kurallar

Bu ayarlar bilinçli tercihtir; geri alınırsa derleme çöker.

- **`npm ci` kullanılmaz, `npm install` kullanılır.** Depoda
  `package-lock.json` tutulmuyor; `npm ci` lock dosyası olmadan çalışmayı
  reddeder ve imaj derlemesini durdurur.
- **`backend/Dockerfile` her iki aşamada `apk add --no-cache openssl`
  çalıştırır.** Prisma query engine OpenSSL'e bağlıdır; Alpine imajında
  kurulu gelmediği için `npx prisma generate` adımı hata verip derlemeyi
  durduruyordu.
- **Backend derlemesi tip hatasında durmaz:**
  `npx tsc -p tsconfig.json --noEmitOnError false || true`. JS çıktısı yine
  üretilir ve konteyner ayağa kalkar. Tip denetimi ayrı bir adımdır:
  `npm run typecheck`.
- **`frontend/.dockerignore` vardır.** `COPY . .` adımında host'taki
  `node_modules` imaja taşınırsa esbuild/Vite ikilileri konak mimarisiyle
  uyuşmaz ve `npm run build` çöker.
- **Compose komutu migration geçmişi yoksa `prisma db push` yapar.**
  `prisma migrate deploy` boş bir `prisma/migrations` klasöründe hiçbir tablo
  oluşturmadan başarıyla çıkıyor, backend de ilk sorguda
  "relation does not exist" ile ölüyordu.


---

## Esnek veri girişi

### Şirketsiz (bağımsız) kişiler

`Contact.companyId` **nullable**'dır. Bağımsız danışman, aracı, komisyoncu ve
askeri ataşe hiçbir kuruma bağlı olmadan kaydedilir — sırf kişiyi
kaydedebilmek için sahte şirket açmak veriyi bozar.

Bağımsız kişi kendi `addressLine`, `cityName`, `country`, `countryCode`,
`latitude` ve `longitude` bilgisini taşır; `contactType` alanı kişiyi
sınıflandırır (Kurum Çalışanı / Bağımsız Danışman / Aracı-Komisyoncu /
Askeri Ataşe / Diğer).

**Erişim kapsamı.** Bağımsız kişi hiçbir departmana ait olmadığı için
departman kapsamı ona uygulanamaz; `contact:read` yetkisi olan herkes görür.
Kuruma bağlı kişiler eskisi gibi kapsamlanır. Kapsam sorgusu
`{ OR: [{ companyId: null }, { company: companyScope(user) }] }` biçimindedir
ve kişi listesi, tekil erişim, genel arama, takvim (doğum günleri), e-posta
ve kontrol paneli sayacının **hepsinde** aynı şekilde uygulanır — biri
atlansaydı bağımsız kişiler o ekranda görünmez olurdu.

### Varsayılan para birimi

Fırsat, Teklif, Sözleşme ve Ürün formlarında para birimi **USD** olarak
gelir; TRY, EUR ve GBP listeden seçilebilir. İhale (Tender) **TRY** kalır:
yurt içi kamu ihaleleri TL üzerinden yürür.

---

## Teklif maliyeti ve kârlılık

`OfferItem.cost` birim başına tahmini maliyeti, `Offer.costTotal` toplamı,
`Offer.costCurrency` maliyet para birimini tutar. Maliyet para birimi satış
para biriminden **farklı olabilir**: hammadde USD alınıp teklif EUR
verilebilir.

Brüt kâr ve marj hem formda anlık, hem de sunucu yanıtında (`margin`)
hesaplanır. İki kural:

- Karşılaştırma **anlık kurla TL'ye çevrilerek** yapılır — iki farklı
  para birimini doğrudan çıkarmak sessiz ve büyük bir hata olurdu.
- **KDV hariç** net satış esas alınır: KDV devlete aittir, kâr değildir.
- Ciro sıfırken marj `null` döner; `0` göstermek "sıfır kâr" yanılgısı yaratır.

---

## Sipariş, stok ve termin

### Stok

Sözleşme detayında, bağlı teklifin kalemleri için ürünün **anlık depo
stoğu** taahhüt edilen adetle yan yana gösterilir (`stockLines`). Eksik
varsa üretim/tedarik planı sözleşme imzalanmadan netleşmelidir.

### Gerçekleşen maliyet (COGS)

`Contract.cogs` + `cogsCurrency` + `cogsNote`. Tekliften gelen tahmini
maliyetin aksine sipariş kapandığında kesinleşen rakamdır. Boş bırakılırsa
"henüz bilinmiyor" sayılır — `0` ile `null` farklı şeylerdir.

### Termin (teslimat)

`Contract.deliveryDate` yetkili tarafından revize edilebilir.
`originalDeliveryDate` ilk taahhüdü saklar: gecikme ölçümü **orijinal**
termine göre yapılır, aksi halde her revizyon gecikmeyi sıfırlar ve tedarik
performansı ölçülemez hâle gelir. Her revizyonda `deliveryRevisedAt`
damgalanır ve zaman tüneline "kimden kime" kaydı düşer.

Hatırlatıcılar `delivery.service.ts` içinde **tek bir yerde** tanımlıdır —
eşikler iki yerde ayrı hesaplansaydı ekranlar birbirini tutmazdı:

- Eşikler **30, 15 ve 7 gün**. En dar eşik kazanır: 5 gün kalmışsa uyarı
  "7 gün" seviyesindedir.
- Gün farkı **takvim günü** olarak hesaplanır; ham milisaniye bölünseydi
  sonuç kaydın saatine göre bir gün oynardı.
- `deliveredAt` dolu olan siparişler hatırlatıcı üretmez.
- Gecikmiş olanlar eşik dışı da olsa her zaman düşer.

Uyarılar iki yerde görünür ve **ikisi de aynı uç noktadan** beslenir
(`GET /api/v1/notifications`): bildirim zili ve kontrol panelindeki termin
şeridi. Zil ayrıca gecikmiş görevleri de aynı sıralı listede taşır.

---

## Aktivite havuzu ve fuar yönetimi

`BusinessActivity` modeli fuar, toplantı, saha ziyareti ve fabrika gezisini
tutar. Zaman tünelini besleyen `Activity` kaydından **ayrıdır**: `Activity`
otomatik üretilen bir olay günlüğü, `BusinessActivity` ise elle planlanan
ticari bir etkinliktir. İkisi tek modelde birleştirilseydi zaman tünelleri
planlama kayıtlarıyla kirlenirdi.

Etkinlik hiçbir kuruma bağlı olmak zorunda değildir — IDEF kimsenin müşterisi
değil, kendi başına bir etkinliktir.

**Fuar Sonuç Raporu.** Etkinliğin `outcomeNote` alanına özet değerlendirme
yazılır; hazırlanan PDF/Word dosyası `DocumentFile` olarak
`FUAR_SONUC_RAPORU` kategorisiyle aktiviteye yüklenir. `outcomeReportAt`
damgası **ilk** kaydetmede vurulur; sonraki düzeltmeler damgayı ileri
taşımaz — rapor tarihi teslim tarihidir, son düzenleme tarihi değil.
Bitmiş ama raporu yazılmamış fuarlar `?awaitingReport=true` ile listelenir
ve üst şeritte sayılır.

**Kartvizitler.** Fuarda görüşülen kişiler tek tıkla kayda bağlanır
(`ActivityContact`), ilgi seviyesi (Sıcak/Ilık/Soğuk) ve görüşme notuyla.
Kişi sistemde yoksa aynı ekrandan **şirketsiz** olarak açılır ve varsayılan
olarak **etkinliğin ülkesine** bağlanır. Bağlantı kaldırıldığında kişi
silinmez: kartvizit sisteme girdikten sonra fuar kaydından kopması kişiyi
yok saymayı gerektirmez.

**Ekip.** Katılamayacağını bildiren kişi listeden silinmez, `isAttending`
false yapılır ve adının üzeri çizilir — kimin davet edildiği kaydın bir
parçasıdır.

---

## Mühimmat lojistik hesabı

`LogisticsCalculator` kalibre ön tanımları taşır: 9x19, 5.56x45, 7.62x51,
12.7x99, 40 mm, 81 mm, 120 mm ve 155 mm. Kalibre seçilip sipariş adedi
girildiğinde sandık adedi, brüt ağırlık ve hacim otomatik çıkar; 20FT /
40FT / 40HC konteyner doluluğu görselleşir.

> **Uyarı:** Ön tanım değerleri NATO standart ambalajı için **yaklaşıktır**.
> Gerçek sevkiyatta üreticinin teknik veri sayfasındaki sandık ölçüsü ve
> brüt ağırlık esas alınmalıdır; ambalaj lot, fitil ve paketleme tipine göre
> değişir. Seçim sonrası tüm alanlar elle düzeltilebilir ve hesap
> düzeltilmiş değerlerle yapılır.

Hesap **hacim ve ağırlık** sınırlarını birlikte gözetir ve ikisinden
**büyük** olanı gerekli konteyner sayısını belirler: mühimmatta genellikle
konteyner hacmi dolmadan yük sınırına ulaşılır, yalnızca hacme bakan bir
hesap gerçekte taşınamayacak bir plan üretir.


---

## Savunma sanayii dış ticaret modülü

### Teslim şekli (Incoterms 2020)

Teklif ve sözleşmede `incoterm` + `incotermPlace` alanları vardır. Liste
`defenceTrade.service.ts` içinde tek yerde tanımlıdır ve hem Zod şemasını
hem arayüz seçicisini besler. Teklif varsayılanı **FOB** — ihracatta en
yaygın kullanılan şekil. Fark önemlidir: FOB ile CIF arasındaki navlun ve
sigorta farkı bir teklifte yüzde onları bulabilir.

### İhracat izni ve Son Kullanıcı Belgesi (EUC)

Sözleşmede `exportLicenceStatus`, `exportLicenceAuthority` (MSB / SSB /
Dışişleri / Ticaret), izin numarası, başvuru ve geçerlilik tarihleri ile
`eucStatus`, `eucAuthority`, `eucReference` alanları tutulur.

`exportGate()` bu alanlardan **sevkiyat hazırlık durumunu** türetir ve
sözleşme detayında rozet olarak görünür:

| Durum | Anlam |
| --- | --- |
| `HAZIR` | İzin onaylı, EUC tamam — sevk edilebilir |
| `BEKLIYOR` | İzin veya EUC süreci devam ediyor |
| `ENGELLI` | İzin reddedildi ya da süresi doldu — sevkiyat hukuken mümkün değil |
| `GEREKSIZ` | İzne tabi değil (yurt içi) |

Kural sırası önemlidir: **reddedildi** ve **süresi doldu** her şeyin önüne
geçer. EUC eksikliği "bekliyor"dur, çünkü süreç devam edebilir.

Sözleşme PDF'inde izne tabi sözleşmeler için ayrı bir "İhracat Kontrolü ve
Son Kullanıcı Beyanı" bölümü ve yeniden ihraç taahhüdü maddesi basılır.
Yurt içi sözleşmede bu bölüm hiç görünmez — boş bir "izin" başlığı kafa
karıştırırdı.

### Ürün sınıflandırması

`Product` modelinde `nsn` (NATO Stok Numarası, 13 hane),
`militaryListCategory` (ör. ML3), `unNumber` (ör. UN0012), `hazardClass`
(BM Sınıf 1.1–1.6), `neqGrams` (birim başına net patlayıcı ağırlığı) ve
`requiresExportLicence` alanları vardır. Ambalaj alanları (sandık adedi,
ölçü, brüt ağırlık) da artık API'ye açıktır ve lojistik hesaplayıcı
katalogdan doğrudan okur.

---

## Etiketler

Etiketler önceden `customFields` JSON alanının içinde serbest metindi; bu
yüzden "bu etikete sahip kayıtlar" sorgusu yazılamıyor, etiket yeniden
adlandırılamıyor ve bir kayıttan merkezî olarak kaldırılamıyordu.

Artık ilişkiseldir: `Tag` + `CompanyTag` + `ContactTag`. `/tags` ekranında
bir etikete tıklayınca o etiketi taşıyan kurum ve kişiler sağda listelenir
ve her satırdaki **"Etiketi Kaldır"** düğmesiyle bağ koparılır — kaydın
kendi sayfasına gitmeye gerek yoktur.

Kurum kapsamı etiket ekranında da uygulanır: kullanıcı erişemediği bir
kurumu etiket üzerinden göremez, aksi halde etiket sayfası bir yan kanal
olurdu.

---

## Mühimmat lojistik hesabı (genişletilmiş)

Kalibre ön tanımları: 9x19, 5.56x45, 7.62x51, **7.62x39**, 12.7x99, 40 mm,
81 mm, 120 mm, 155 mm. Her ön tanım sandık adedi, ölçü, brüt ağırlık,
BM madde numarası, tehlike sınıfı, **M2A1 metal kutu adedi** ve birim
başına **NEQ** taşır.

Hesap çıktısı: sandık adedi, M2A1 kutu adedi, palet adedi, toplam hacim,
brüt ağırlık, **net patlayıcı ağırlığı (NEQ)** ve 20FT/40FT/40HC konteyner
doluluk oranı. **"Sevkiyat Dökümü (PDF / Yazdır)"** düğmesi kurumsal
antetli A4 döküm üretir.

İki ölçüm kararı:

- Konteyner sayısı hacim, ağırlık ve palet alanı kısıtlarından **en
  büyüğü** alınarak bulunur; mühimmatta genellikle hacim dolmadan yük
  sınırına ulaşılır.
- NEQ sipariş **adedi** üzerinden hesaplanır, sandık kapasitesi üzerinden
  değil. Kısmi sandık dolu sayılsaydı patlayıcı ağırlığı olduğundan fazla
  çıkar ve sevkiyat gereksiz yere tehlike sınıfı atlardı.

> Ambalaj değerleri NATO standart ambalajı için **yaklaşıktır**. Kesin
> plan üreticinin teknik veri sayfasına göre yapılmalıdır; tüm alanlar
> arayüzden düzeltilebilir.

---

## Yerel AI motoru (anahtarsız)

API anahtarı tanımlı değilken `localAnswer.service.ts` soruyu sınıflandırıp
yanıtı **doğrudan veritabanından** üretir; dışarıya hiçbir veri gitmez.
Bu tur eklenen niyetler:

| Soru | Yanıt |
| --- | --- |
| "en büyük iş kimle", "en yüksek cirolu sözleşme" | En yüksek tutarlı sözleşme ve fırsat, şirket adı / tutar / sözleşme no / tarih ile |
| "hangi ülkelere satıyoruz", "yurt dışı müşteriler" | Ülke bazında kurum sayısı ve toplam hacim |
| "geciken teslimatlar", "yaklaşan termin" | Gecikmiş ve 30 gün içinde terminlenen siparişler |
| "ihracat izni durumu", "EUC bekleyenler" | İzin durumuna göre gruplanmış sözleşmeler |

Niyet sırası önemlidir: dar niyetler (en büyük iş, termin, izin) genel
niyetlerden (fırsat, ciro) **önce** eşleşir; aksi halde "en büyük iş kimle"
sorusu genel fırsat toplamına düşerdi.

"En büyük iş" sıralaması ham `amount` ile yapılmaz — aday küme **anlık
kurla TL'ye çevrilip** sıralanır; aksi halde 100.000 TRY, 90.000 USD'nin
üstüne çıkardı.


---

## Bu turdaki düzeltmeler

### Tabloların dikeyde kaydırılamaması (İhaleler)

Kök neden CSS'teydi:

```css
.table-wrap { overflow: hidden; overflow-x: auto; }
```

`overflow: hidden` **iki ekseni de** gizler; sonraki `overflow-x: auto`
yalnızca yatay ekseni geri açar ve dikey eksen **gizli kalır**. Uzun
tablolarda alttaki satırlara erişilemiyordu. Doğrusu:

```css
.table-wrap { overflow-x: auto; overflow-y: visible; }
```

Yatayda kaydırma tabloya, dikeyde kaydırma sayfaya aittir.

### Üç durumlu sıralama

`SortableTh` + `useTriStateSort` (`components/SortableTh.tsx`). Döngü:
**artan → azalan → varsayılan**. Üçüncü tıklama sıralamayı kaldırır ve
liste sunucunun doğal sırasına döner; iki durumlu sıralamada kullanıcı
"sırasız hâle" bir daha dönemez, sayfayı yenilemek zorunda kalır.

Sunucu sözleşmesi `-alan` (azalan) / `alan` (artan); varsayılanda
parametre **hiç gönderilmez**. Bağlı sayfalar: İhaleler, Şirketler,
Kişiler, Teklifler. Kişiler rotasına sıralama desteği yeni eklendi.

### Kişi ve not ekleme hataları

"Beklenmeyen bir hata oluştu" mesajı hata kodunu gizliyordu. İki yönlü
düzeltme:

- **Doğrulama sağlamlaştırıldı.** Temizlenen bir seçici `null` değil `""`
  gönderir; düz `z.string().uuid().nullish()` bunu reddediyordu. `companyId`,
  `contactId`, `dealId`, ülke/ülke kodu, koordinat ve doğum tarihi alanları
  artık boş metni açıkça `null`'a çeviriyor. `Number('')` = 0 olduğu için
  doğum yılı `min(1900)` doğrulamasını patlatıyordu; bu da düzeltildi.
- **Hata eşlemesi genişletildi** (`errorHandler.ts`): `P2000` (değer çok
  uzun), `P2011` (zorunlu alan null — **en yaygın nedeni migration'ın
  çalıştırılmamış olması**) ve `PrismaClientValidationError` artık 500
  yerine ne yapılacağını söyleyen 422 döndürüyor. Tanınmayan Prisma
  kodları da yanıtta görünüyor.

> Kişi eklerken hâlâ hata alıyorsanız ilk bakılacak yer budur:
> `Contact.companyId` şemada nullable ama veritabanında hâlâ `NOT NULL`
> ise migration çalıştırılmamış demektir.

### Fırsat kartları

`hover` artık **yalnızca** kenarlık rengi ve gölge değiştiriyor;
`transform: translateY()` kaldırıldı. Transform her kartta düzen yeniden
hesabı tetikliyor, dolu bir sütunda fare gezdirirken gözle görülür takılma
yaratıyordu.

Kart eylemleri (Teklif Oluştur, Düzenle, Aşama, Sil) üç nokta menüsüne
alındı ve menü düğmesi yalnızca kart üzerine gelince beliriyor.

### Teklif kârlılığı

Ana raporlama artık **teklifin kendi para biriminde**:
`Kâr Oranı (%) = ((Satış − Maliyet) / Satış) × 100`, KDV hariç net satış
üzerinden. Zorunlu TL çevrimi kaldırıldı — kur oynadıkça aynı teklifin
kârı değişiyormuş gibi görünüyordu. Maliyet farklı bir dövizdeyse teklifin
para birimine çevrilir. TL karşılığı tooltip ve alt satırda ikincil bilgi
olarak duruyor.

Teklif artık **kişiye de kesilebilir**: `Offer.companyId` nullable oldu,
kurum ve kişiden en az birinin dolu olması sunucuda `superRefine` ile
doğrulanıyor.

### Otomatik taslak kaydı

`useDraftAutosave` yeniden yazıldı. Taslak **otomatik uygulanmaz**:
kullanıcı yeni kayıt açtığını sanarken eski bir taslağın alanlarıyla
karşılaşırsa fark etmeyip yanlış veriyi kaydedebilir. Bunun yerine form
temiz açılır ve üstte bir bildirim çıkar:

> Kaydedilmemiş bir taslağınız bulundu · **[Taslağı Yükle]** **[Temizle]**

Bağlı formlar: Teklif, Sözleşme, İhale, Şirket, E-posta. Kayıt başarılı
olduğunda taslak silinir.

### Giriş ekranı gecikmesi

Kök neden Google Fonts `<link rel="stylesheet">` etiketiydi: render
**engelleyici** bir istek. Kapalı veya yavaş ağda tarayıcı zaman aşımını
bekliyor, giriş ekranı saniyelerce boş kalıyordu. Çözüm `media="print"` +
`onload="this.media='all'"`: sayfa anında sistem fontuyla açılır, fontlar
gelince sessizce geçiş yapar. `<noscript>` yedeği korundu.

Ayrıca yıldız filigranının köşe hesabı modül düzeyine alındı (her
render'da yeniden hesaplanıyordu).

### Dosya boyutu sınırı

Yapay 7 MB sınırı 100 MB'a çıkarıldı (istemci + sunucu). Express gövde
sınırı 140 MB yapıldı: base64 ham boyutu ~%33 şişirir, 100 MB'lık dosya
~134 MB gövde demektir. Sınır tamamen kaldırılmadı çünkü çok büyük bir
dosyayı base64'e çevirmek tarayıcı sekmesini kilitler — kullanıcıya
yüklemeden **önce** söylemek daha iyidir.

### Palet ve konteyner hesaplayıcısı

`PalletCalculator.tsx` — mühimmat hesaplayıcısından ayrı tutuldu çünkü
girdi türü ve kullanıcı kitlesi farklı (biri kalibre + fişek adedi, diğeri
ham koli ölçüsü).

Palet tipleri: Euro Palet EPAL 1 (1200×800, 1500 kg), NATO Standart
(1200×1000, 2000 kg), Sanayi (1200×1200, 1800 kg), Özel ölçü.

Hesap üç kısıtı birlikte gözetir ve **en büyüğünü** alır: palet zemin
alanı, ağırlık, hacim. Kat sayısı hem yükseklikle hem **palet taşıma
kapasitesiyle** sınırlanır — yığın fiziksel olarak mümkün olsa bile
kapasite aşılırsa taşınamaz. Koli iki yönelimde de denenir ve verimli
olan seçilir. Çıktı kopyalanabilir ve kurumsal antetli A4 olarak
yazdırılabilir.

### Renk paleti yumuşatma

| Önce | Sonra | Neden |
| --- | --- | --- |
| `#0A192F` | `#0F172A` | Beyaz kartla kontrast göz yoruyordu |
| `#E31E24` | `#DC2626` | Saf kırmızı lacivert üzerinde titreşiyordu |
| `#F4F7F9` | `#F8FAFC` | Daha dingin sayfa zemini |

Kartlara ince `#e2e8f0` kenarlık geri geldi: gölge tek başına açık zeminde
kartın sınırını belirsiz bırakıyordu. Üst bardaki kırmızı+altın çift şerit
tek ince altına indirildi — iki güçlü renk yan yana "uyarı çubuğu" gibi
okunuyordu.

### Isı haritası

Renk skalası çiğ sarı-kırmızıdan kurumsal skalaya çekildi:
`#0f2042 → #1e408c → #2563eb → #d99828 → #f59e0b`. Yarıçap 34→30 px,
azami opaklık %82→%55, bulanıklık 22→30. Altındaki coğrafya artık okunuyor.

### Harita filtre paneli

Katlanabilir: ok düğmesine basılınca 46 px'lik dikey şeride küçülür,
`transition: 0.3s` ile açılır. Tercih `localStorage`'da saklanır. Panel
`z-index: 1000` katmanında.

### İnce scrollbar

4 px genişlikte, saydam arka planlı, yuvarlatılmış. Firefox
`scrollbar-width: thin` ile, WebKit sözde elemanlarla; ikisi de
desteklenmiyorsa tarayıcı kendi çubuğunu gösterir ve hiçbir şey kırılmaz.
Tablo, menü, çekmece, modal, Kanban sütunu ve not listelerine uygulandı.

### Not renkleri

Çiğ pembe, mor ve kırmızı kaldırıldı. Kalan dört ton: soft mavi `#E0F2FE`,
soft sarı `#FEF9C3`, soft sage `#DCFCE7`, yumuşak gri `#F1F5F9`. Kırmızı
notun "hata" gibi okunması sorunu da böylece ortadan kalktı.

### AI çıktısı

Kuru paragraf yerine yapılandırılmış bloklar: numaralı aksiyon adımları
(lacivert daire içinde sıra numarası) ve **tonuna göre renklenen** madde
işaretleri — riskler kırmızı, fırsatlar yeşil, bekleyenler sarı. Ton
anahtar kelimeden çıkarılır ve tanınmayan satır **nötr bırakılır**; yanlış
renklendirmektense renksiz bırakmak yeğdir.

AI sayfası `max-width: 1280px` ile tam genişlikte, dört sekmeli:
AI Asistan · Mühimmat & Sandık · Palet & Konteyner.
