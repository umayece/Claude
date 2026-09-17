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

Karolar **anahtarsız, ücretsiz** resmî OpenStreetMap sunucusundan gelir:

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

Bu URL **değiştirilmemelidir**. Carto, Mapbox, Stadia gibi sağlayıcılar
anahtar ister ve anahtarsız isteklerde karoların üzerine
"API KEY REQUIRED" filigranı basar. Depoda hiçbir Carto referansı yoktur.
`{s}` alt alan adı biçimi de kullanılmaz — OSM artık HTTP/2 üzerinden tek
konağı öneriyor.

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
| Ana renk | `#002845` (Pantone 2965 C) | Sidebar, üst bar, birincil düğme, modal başlığı |
| Vurgu | `#45B4AA` (Pantone 15-5519 TPX) | Aktif sekme, Kanban ilerleme çubuğu, rozet, CTA |
| Zemin | `#F8FAFC` | Sayfa arka planı |
| Çizgi | `#C4C7C8` (Pantone 428 C) | Kenarlık, ayraç |

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
