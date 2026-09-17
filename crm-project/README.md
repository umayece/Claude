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

### Döviz kuru: donmuş vs. güncel

Parasal kayıtlar yazıldıkları andaki kuru `exchangeRate` alanında
**dondurur** — kur hareketi geçmiş tutarı kaydırmaz. Bu, ekranın "kur yanlış
hesaplanıyor" izlenimi vermesinin nedenidir: gösterilen TL değeri kayıt
anındaki kurdur. `dualAmount()` yardımcısı ikisini birlikte üretir:
muhasebe değeri (donmuş kur) ve bugünkü piyasa değeri (güncel kur), USD
karşılığıyla birlikte.

TCMB'ye erişimi olmayan kurulumlar için **elle kur girişi** vardır
(`PUT /api/v1/exchange-rates`, Ayarlar ekranından). Kaynak `MANUEL` olarak
işaretlenir; bir sonraki başarılı senkronizasyon üzerine yazar.

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

Harita karoları **anahtarsız** OpenStreetMap sunucusundan gelir
(`tile.openstreetmap.org`). Anahtar isteyen bir sağlayıcıya geçilirse
karoların üzerine filigran basılır.

### TCMB kur senkronizasyonu

Günde bir kez `today.xml` çekilir. Dışarı giden tek bilgi "kur listesi
istiyorum"dur — gövdede, sorgu dizesinde veya başlıkta hiçbir müşteri verisi
yoktur. İnternet yoksa **veritabanındaki son geçerli kur korunur** (silinmez,
1.0'a düşürülmez); arayüz kurun 24 saatten eski olduğunu kullanıcıya bildirir.

Kur, parasal kayıtlara yazıldığı anda `exchangeRate` alanında **dondurulur**;
sonraki kur hareketleri geçmiş tutarları kaydırmaz.

---

## Bilinen sınırlar

- **E-posta gerçekten gönderilmez.** Kurumsal SMTP tanımlanana kadar yerel
  simülatör çalışır; mesaj `EmailQueue`'ya `SENT` olarak yazılır ve zaman
  tüneline düşer. Gerçek gönderime geçerken yalnızca `email.routes.ts`
  içindeki yazma adımı bir SMTP çağrısıyla değiştirilir.
- **WhatsApp mesajı CRM'den gönderilmez.** Resmî Business API ayrı bir
  kurumsal onay sürecidir; modal `wa.me` bağlantısı üretir.
- **Sözleşme PDF'i** tarayıcının yazdırma motoruyla üretilir (ek bağımlılık yok).
