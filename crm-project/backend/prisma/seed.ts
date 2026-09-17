/* eslint-disable no-console */
import { PrismaClient, type CompanyType, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Şehirler
// ---------------------------------------------------------------------------

interface CitySeed {
  name: string;
  countryCode: string;
  country: string;
  latitude: number;
  longitude: number;
  plateCode?: number;
  region?: string;
}

/** 81 il — plaka koduyla. */
const TURKISH_CITIES: CitySeed[] = ([
  [1, 'Adana', 37.0000, 35.3213], [2, 'Adıyaman', 37.7648, 38.2786],
  [3, 'Afyonkarahisar', 38.7507, 30.5567], [4, 'Ağrı', 39.7191, 43.0503],
  [5, 'Amasya', 40.6499, 35.8353], [6, 'Ankara', 39.9334, 32.8597],
  [7, 'Antalya', 36.8969, 30.7133], [8, 'Artvin', 41.1828, 41.8183],
  [9, 'Aydın', 37.8560, 27.8416], [10, 'Balıkesir', 39.6484, 27.8826],
  [11, 'Bilecik', 40.1451, 29.9799], [12, 'Bingöl', 38.8854, 40.4980],
  [13, 'Bitlis', 38.3938, 42.1232], [14, 'Bolu', 40.5760, 31.5788],
  [15, 'Burdur', 37.7203, 30.2908], [16, 'Bursa', 40.1885, 29.0610],
  [17, 'Çanakkale', 40.1553, 26.4142], [18, 'Çankırı', 40.6013, 33.6134],
  [19, 'Çorum', 40.5506, 34.9556], [20, 'Denizli', 37.7765, 29.0864],
  [21, 'Diyarbakır', 37.9144, 40.2306], [22, 'Edirne', 41.6818, 26.5623],
  [23, 'Elazığ', 38.6810, 39.2264], [24, 'Erzincan', 39.7500, 39.5000],
  [25, 'Erzurum', 39.9000, 41.2700], [26, 'Eskişehir', 39.7767, 30.5206],
  [27, 'Gaziantep', 37.0662, 37.3833], [28, 'Giresun', 40.9128, 38.3895],
  [29, 'Gümüşhane', 40.4386, 39.5086], [30, 'Hakkâri', 37.5744, 43.7408],
  [31, 'Hatay', 36.4018, 36.3498], [32, 'Isparta', 37.7648, 30.5566],
  [33, 'Mersin', 36.8000, 34.6333], [34, 'İstanbul', 41.0082, 28.9784],
  [35, 'İzmir', 38.4192, 27.1287], [36, 'Kars', 40.6013, 43.0975],
  [37, 'Kastamonu', 41.3887, 33.7827], [38, 'Kayseri', 38.7312, 35.4787],
  [39, 'Kırklareli', 41.7333, 27.2167], [40, 'Kırşehir', 39.1425, 34.1709],
  [41, 'Kocaeli', 40.8533, 29.8815], [42, 'Konya', 37.8667, 32.4833],
  [43, 'Kütahya', 39.4167, 29.9833], [44, 'Malatya', 38.3552, 38.3095],
  [45, 'Manisa', 38.6191, 27.4289], [46, 'Kahramanmaraş', 37.5858, 36.9371],
  [47, 'Mardin', 37.3212, 40.7245], [48, 'Muğla', 37.2153, 28.3636],
  [49, 'Muş', 38.9462, 41.7539], [50, 'Nevşehir', 38.6939, 34.6857],
  [51, 'Niğde', 37.9667, 34.6833], [52, 'Ordu', 40.9839, 37.8764],
  [53, 'Rize', 41.0201, 40.5234], [54, 'Sakarya', 40.6940, 30.4358],
  [55, 'Samsun', 41.2867, 36.3300], [56, 'Siirt', 37.9333, 41.9500],
  [57, 'Sinop', 42.0231, 35.1531], [58, 'Sivas', 39.7477, 37.0179],
  [59, 'Tekirdağ', 40.9833, 27.5167], [60, 'Tokat', 40.3167, 36.5500],
  [61, 'Trabzon', 41.0027, 39.7168], [62, 'Tunceli', 39.3074, 39.4388],
  [63, 'Şanlıurfa', 37.1591, 38.7969], [64, 'Uşak', 38.6823, 29.4082],
  [65, 'Van', 38.4891, 43.4089], [66, 'Yozgat', 39.8181, 34.8147],
  [67, 'Zonguldak', 41.4564, 31.7987], [68, 'Aksaray', 38.3687, 34.0370],
  [69, 'Bayburt', 40.2552, 40.2249], [70, 'Karaman', 37.1759, 33.2287],
  [71, 'Kırıkkale', 39.8468, 33.5153], [72, 'Batman', 37.8812, 41.1351],
  [73, 'Şırnak', 37.4187, 42.4918], [74, 'Bartın', 41.6344, 32.3375],
  [75, 'Ardahan', 41.1105, 42.7022], [76, 'Iğdır', 39.8880, 44.0048],
  [77, 'Yalova', 40.6500, 29.2667], [78, 'Karabük', 41.2061, 32.6204],
  [79, 'Kilis', 36.7184, 37.1212], [80, 'Osmaniye', 37.0742, 36.2461],
  [81, 'Düzce', 40.8438, 31.1565],
] as [number, string, number, number][]).map(([plateCode, name, latitude, longitude]) => ({
  plateCode, name, latitude, longitude, countryCode: 'TR', country: 'Türkiye',
}));

/** Savunma sanayii ihracatında MKE'nin fiilen çalıştığı pazarlardan şehirler. */
const INTERNATIONAL_CITIES: CitySeed[] = ([
  // Avrupa
  ['Berlin', 'DE', 'Almanya', 52.5200, 13.4050, 'Avrupa'],
  ['München', 'DE', 'Almanya', 48.1351, 11.5820, 'Avrupa'],
  ['Paris', 'FR', 'Fransa', 48.8566, 2.3522, 'Avrupa'],
  ['Roma', 'IT', 'İtalya', 41.9028, 12.4964, 'Avrupa'],
  ['Madrid', 'ES', 'İspanya', 40.4168, -3.7038, 'Avrupa'],
  ['Londra', 'GB', 'Birleşik Krallık', 51.5074, -0.1278, 'Avrupa'],
  ['Varşova', 'PL', 'Polonya', 52.2297, 21.0122, 'Avrupa'],
  ['Bükreş', 'RO', 'Romanya', 44.4268, 26.1025, 'Avrupa'],
  ['Atina', 'GR', 'Yunanistan', 37.9838, 23.7275, 'Avrupa'],
  ['Stockholm', 'SE', 'İsveç', 59.3293, 18.0686, 'Avrupa'],
  ['Kiev', 'UA', 'Ukrayna', 50.4501, 30.5234, 'Avrupa'],
  ['Belgrad', 'RS', 'Sırbistan', 44.7866, 20.4489, 'Avrupa'],
  ['Saraybosna', 'BA', 'Bosna-Hersek', 43.8563, 18.4131, 'Avrupa'],
  ['Tiran', 'AL', 'Arnavutluk', 41.3275, 19.8187, 'Avrupa'],
  ['Budapeşte', 'HU', 'Macaristan', 47.4979, 19.0402, 'Avrupa'],
  ['Prag', 'CZ', 'Çekya', 50.0755, 14.4378, 'Avrupa'],
  ['Üsküp', 'MK', 'Kuzey Makedonya', 41.9981, 21.4254, 'Avrupa'],
  // Orta Doğu
  ['Doha', 'QA', 'Katar', 25.2854, 51.5310, 'Orta Doğu'],
  ['Abu Dabi', 'AE', 'Birleşik Arap Emirlikleri', 24.4539, 54.3773, 'Orta Doğu'],
  ['Dubai', 'AE', 'Birleşik Arap Emirlikleri', 25.2048, 55.2708, 'Orta Doğu'],
  ['Riyad', 'SA', 'Suudi Arabistan', 24.7136, 46.6753, 'Orta Doğu'],
  ['Kuveyt', 'KW', 'Kuveyt', 29.3759, 47.9774, 'Orta Doğu'],
  ['Manama', 'BH', 'Bahreyn', 26.2285, 50.5860, 'Orta Doğu'],
  ['Maskat', 'OM', 'Umman', 23.5880, 58.3829, 'Orta Doğu'],
  ['Amman', 'JO', 'Ürdün', 31.9454, 35.9284, 'Orta Doğu'],
  ['Bağdat', 'IQ', 'Irak', 33.3152, 44.3661, 'Orta Doğu'],
  ['Erbil', 'IQ', 'Irak', 36.1911, 44.0092, 'Orta Doğu'],
  ['Beyrut', 'LB', 'Lübnan', 33.8938, 35.5018, 'Orta Doğu'],
  // Asya
  ['İslamabad', 'PK', 'Pakistan', 33.6844, 73.0479, 'Asya'],
  ['Karaçi', 'PK', 'Pakistan', 24.8607, 67.0011, 'Asya'],
  ['Kuala Lumpur', 'MY', 'Malezya', 3.1390, 101.6869, 'Asya'],
  ['Cakarta', 'ID', 'Endonezya', -6.2088, 106.8456, 'Asya'],
  ['Dakka', 'BD', 'Bangladeş', 23.8103, 90.4125, 'Asya'],
  ['Bakü', 'AZ', 'Azerbaycan', 40.4093, 49.8671, 'Asya'],
  ['Astana', 'KZ', 'Kazakistan', 51.1694, 71.4491, 'Asya'],
  ['Taşkent', 'UZ', 'Özbekistan', 41.2995, 69.2401, 'Asya'],
  ['Bişkek', 'KG', 'Kırgızistan', 42.8746, 74.5698, 'Asya'],
  ['Manila', 'PH', 'Filipinler', 14.5995, 120.9842, 'Asya'],
  ['Yeni Delhi', 'IN', 'Hindistan', 28.6139, 77.2090, 'Asya'],
  ['Seul', 'KR', 'Güney Kore', 37.5665, 126.9780, 'Asya'],
  // Afrika
  ['Kahire', 'EG', 'Mısır', 30.0444, 31.2357, 'Afrika'],
  ['Trablus', 'LY', 'Libya', 32.8872, 13.1913, 'Afrika'],
  ['Tunus', 'TN', 'Tunus', 36.8065, 10.1815, 'Afrika'],
  ['Cezayir', 'DZ', 'Cezayir', 36.7538, 3.0588, 'Afrika'],
  ['Rabat', 'MA', 'Fas', 34.0209, -6.8416, 'Afrika'],
  ['Mogadişu', 'SO', 'Somali', 2.0469, 45.3182, 'Afrika'],
  ['Lagos', 'NG', 'Nijerya', 6.5244, 3.3792, 'Afrika'],
  ['Nairobi', 'KE', 'Kenya', -1.2921, 36.8219, 'Afrika'],
  ['Addis Ababa', 'ET', 'Etiyopya', 9.0320, 38.7469, 'Afrika'],
  // Amerika
  ['Washington', 'US', 'Amerika Birleşik Devletleri', 38.9072, -77.0369, 'Amerika'],
  ['Ottawa', 'CA', 'Kanada', 45.4215, -75.6972, 'Amerika'],
  ['Brasília', 'BR', 'Brezilya', -15.7939, -47.8828, 'Amerika'],
  ['Buenos Aires', 'AR', 'Arjantin', -34.6037, -58.3816, 'Amerika'],
  ['Bogotá', 'CO', 'Kolombiya', 4.7110, -74.0721, 'Amerika'],
  ['Meksiko', 'MX', 'Meksika', 19.4326, -99.1332, 'Amerika'],
] as [string, string, string, number, number, string][]).map(
  ([name, countryCode, country, latitude, longitude, region]) => ({
    name, countryCode, country, latitude, longitude, region,
  }),
);

const ALL_CITIES = [...TURKISH_CITIES, ...INTERNATIONAL_CITIES];

async function seedCities(): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  for (const city of ALL_CITIES) {
    const row = await prisma.city.upsert({
      // Benzersizlik ülke + ad bileşiminde; aynı ad farklı ülkelerde olabilir.
      where: { countryCode_name: { countryCode: city.countryCode, name: city.name } },
      update: {
        country: city.country,
        latitude: city.latitude,
        longitude: city.longitude,
        plateCode: city.plateCode ?? null,
        region: city.region ?? null,
      },
      create: {
        name: city.name,
        countryCode: city.countryCode,
        country: city.country,
        plateCode: city.plateCode ?? null,
        latitude: city.latitude,
        longitude: city.longitude,
        region: city.region ?? null,
      },
    });
    index.set(`${city.countryCode}:${city.name}`, row.id);
  }

  console.log(
    `✔ ${TURKISH_CITIES.length} il + ${INTERNATIONAL_CITIES.length} uluslararası şehir yüklendi.`,
  );
  return index;
}

// ---------------------------------------------------------------------------
// Departman ve kullanıcılar
// ---------------------------------------------------------------------------

async function seedDepartments(): Promise<string[]> {
  const names = ['Savunma Satış', 'Kamu İhaleleri', 'Uluslararası Satış', 'Satış Sonrası Hizmetler', 'Yönetim'];
  const ids: string[] = [];
  for (const name of names) {
    const dept = await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
    ids.push(dept.id);
  }
  console.log(`✔ ${names.length} departman yüklendi.`);
  return ids;
}

async function seedUsers(departmentIds: string[]): Promise<Map<string, string>> {
  // Geliştirme parolası. Üretimde ilk girişte değiştirilmesi zorunludur.
  const passwordHash = await bcrypt.hash('MkeCrm!2026', 12);

  const users: { email: string; name: string; role: Role; dept: number }[] = [
    { email: 'admin@mke.gov.tr', name: 'Sistem Yöneticisi', role: 'ADMIN', dept: 4 },
    { email: 'mudur@mke.gov.tr', name: 'Satış Müdürü', role: 'MANAGER', dept: 0 },
    { email: 'satis@mke.gov.tr', name: 'Satış Uzmanı', role: 'SALES', dept: 0 },
    { email: 'ihale@mke.gov.tr', name: 'İhale Uzmanı', role: 'SALES', dept: 1 },
    { email: 'ihracat@mke.gov.tr', name: 'İhracat Uzmanı', role: 'SALES', dept: 2 },
    { email: 'servis@mke.gov.tr', name: 'Servis Sorumlusu', role: 'SUPPORT', dept: 3 },
  ];

  const index = new Map<string, string>();
  for (const user of users) {
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
        departmentId: departmentIds[user.dept] ?? null,
      },
    });
    index.set(user.email, row.id);
  }
  console.log(`✔ ${users.length} kullanıcı yüklendi (şifre: MkeCrm!2026).`);
  return index;
}

// ---------------------------------------------------------------------------
// Şirketler
// ---------------------------------------------------------------------------

interface CompanySeed {
  name: string;
  type: CompanyType;
  status: string;
  sector: string;
  cityKey: string;
  owner: string;
  website?: string;
  /// Şehir listesinde olmayan lokasyonlar için serbest metin + koordinat.
  freeCity?: { name: string; latitude: number; longitude: number };
}

/**
 * Harita filtrelerinin HEPSİNİN dolu görünmesi için tipler bilinçli dengelendi:
 * her tip (B2G / B2B / B2C) hem yurt içinde hem yurt dışında temsil edilir.
 */
const COMPANIES: CompanySeed[] = [
  // --- Yurt içi B2G ---
  { name: 'Savunma Sanayii Başkanlığı', type: 'B2G', status: 'Kazanıldı', sector: 'Kamu', cityKey: 'TR:Ankara', owner: 'ihale@mke.gov.tr', website: 'https://www.ssb.gov.tr' },
  { name: 'Milli Savunma Bakanlığı Tedarik Dairesi', type: 'B2G', status: 'Müzakere', sector: 'Kamu', cityKey: 'TR:Ankara', owner: 'ihale@mke.gov.tr' },
  { name: 'Jandarma Genel Komutanlığı İkmal', type: 'B2G', status: 'Teklif Verildi', sector: 'Kamu', cityKey: 'TR:Ankara', owner: 'ihale@mke.gov.tr' },
  { name: 'Emniyet Genel Müdürlüğü Lojistik', type: 'B2G', status: 'Teklif Hazırlanıyor', sector: 'Kamu', cityKey: 'TR:Ankara', owner: 'satis@mke.gov.tr' },
  { name: 'Deniz Kuvvetleri Tersane Komutanlığı', type: 'B2G', status: 'İletişime Geçildi', sector: 'Savunma', cityKey: 'TR:Kocaeli', owner: 'ihale@mke.gov.tr' },

  // --- Yurt içi B2B ---
  { name: 'ASELSAN A.Ş.', type: 'B2B', status: 'Kazanıldı', sector: 'Savunma', cityKey: 'TR:Ankara', owner: 'satis@mke.gov.tr', website: 'https://www.aselsan.com.tr' },
  { name: 'TUSAŞ — Türk Havacılık ve Uzay Sanayii', type: 'B2B', status: 'Müzakere', sector: 'Havacılık', cityKey: 'TR:Ankara', owner: 'satis@mke.gov.tr' },
  { name: 'Roketsan A.Ş.', type: 'B2B', status: 'Teklif Verildi', sector: 'Savunma', cityKey: 'TR:Ankara', owner: 'satis@mke.gov.tr' },
  { name: 'BMC Otomotiv Sanayi', type: 'B2B', status: 'Teklif Hazırlanıyor', sector: 'Otomotiv', cityKey: 'TR:İzmir', owner: 'satis@mke.gov.tr' },
  { name: 'Nurol Makina ve Sanayi', type: 'B2B', status: 'Müzakere', sector: 'Makine', cityKey: 'TR:Ankara', owner: 'mudur@mke.gov.tr' },
  { name: 'Otokar Otomotiv', type: 'B2B', status: 'İletişime Geçildi', sector: 'Otomotiv', cityKey: 'TR:Sakarya', owner: 'satis@mke.gov.tr' },
  { name: 'Ege Kimya Endüstri A.Ş.', type: 'B2B', status: 'Potansiyel', sector: 'Kimya', cityKey: 'TR:İzmir', owner: 'satis@mke.gov.tr' },
  { name: 'Anadolu Döküm Sanayi', type: 'B2B', status: 'Teklif Verildi', sector: 'Makine', cityKey: 'TR:Konya', owner: 'mudur@mke.gov.tr' },
  { name: 'Karadeniz Metal İşleme', type: 'B2B', status: 'Potansiyel', sector: 'Makine', cityKey: 'TR:Trabzon', owner: 'satis@mke.gov.tr' },
  { name: 'Gaziantep Savunma Teknolojileri', type: 'B2B', status: 'İletişime Geçildi', sector: 'Savunma', cityKey: 'TR:Gaziantep', owner: 'satis@mke.gov.tr' },

  // --- Yurt içi B2C ---
  { name: 'Anadolu Avcılık ve Atıcılık Kulübü', type: 'B2C', status: 'Kazanıldı', sector: 'Diğer', cityKey: 'TR:Bursa', owner: 'satis@mke.gov.tr' },
  { name: 'İstanbul Atıcılık İhtisas Kulübü', type: 'B2C', status: 'Müzakere', sector: 'Diğer', cityKey: 'TR:İstanbul', owner: 'satis@mke.gov.tr' },
  { name: 'Ege Spor Silahları Bayii', type: 'B2C', status: 'Teklif Verildi', sector: 'Diğer', cityKey: 'TR:Antalya', owner: 'satis@mke.gov.tr' },
  { name: 'Başkent Av Malzemeleri', type: 'B2C', status: 'Potansiyel', sector: 'Diğer', cityKey: 'TR:Ankara', owner: 'satis@mke.gov.tr' },

  // --- Yurt dışı B2G ---
  { name: 'Qatar Armed Forces Procurement', type: 'B2G', status: 'Müzakere', sector: 'Kamu', cityKey: 'QA:Doha', owner: 'ihracat@mke.gov.tr' },
  { name: 'UAE Ministry of Defence — Tawazun', type: 'B2G', status: 'Teklif Verildi', sector: 'Kamu', cityKey: 'AE:Abu Dabi', owner: 'ihracat@mke.gov.tr' },
  { name: 'Pakistan Ordnance Factories Board', type: 'B2G', status: 'Kazanıldı', sector: 'Savunma', cityKey: 'PK:İslamabad', owner: 'ihracat@mke.gov.tr' },
  { name: 'Azerbaycan Savunma Sanayii Bakanlığı', type: 'B2G', status: 'Kazanıldı', sector: 'Kamu', cityKey: 'AZ:Bakü', owner: 'ihracat@mke.gov.tr' },
  { name: 'Kazakhstan Engineering National Company', type: 'B2G', status: 'Teklif Hazırlanıyor', sector: 'Kamu', cityKey: 'KZ:Astana', owner: 'ihracat@mke.gov.tr' },
  { name: 'Bangladesh Ordnance Factories', type: 'B2G', status: 'İletişime Geçildi', sector: 'Savunma', cityKey: 'BD:Dakka', owner: 'ihracat@mke.gov.tr' },
  { name: 'Ministry of Defence — Malaysia', type: 'B2G', status: 'Potansiyel', sector: 'Kamu', cityKey: 'MY:Kuala Lumpur', owner: 'ihracat@mke.gov.tr' },
  { name: 'Ukroboronprom', type: 'B2G', status: 'Müzakere', sector: 'Savunma', cityKey: 'UA:Kiev', owner: 'ihracat@mke.gov.tr' },
  { name: 'Iraq Ministry of Interior — Logistics', type: 'B2G', status: 'Teklif Verildi', sector: 'Kamu', cityKey: 'IQ:Bağdat', owner: 'ihracat@mke.gov.tr' },
  { name: 'Somali National Army Procurement', type: 'B2G', status: 'İletişime Geçildi', sector: 'Kamu', cityKey: 'SO:Mogadişu', owner: 'ihracat@mke.gov.tr' },

  // --- Yurt dışı B2B ---
  { name: 'Rheinmetall Defence Europe', type: 'B2B', status: 'Müzakere', sector: 'Savunma', cityKey: 'DE:München', owner: 'ihracat@mke.gov.tr', website: 'https://www.rheinmetall.com' },
  { name: 'Leonardo S.p.A.', type: 'B2B', status: 'Teklif Verildi', sector: 'Havacılık', cityKey: 'IT:Roma', owner: 'ihracat@mke.gov.tr' },
  { name: 'PGZ — Polska Grupa Zbrojeniowa', type: 'B2B', status: 'Teklif Hazırlanıyor', sector: 'Savunma', cityKey: 'PL:Varşova', owner: 'ihracat@mke.gov.tr' },
  { name: 'Romarm S.A.', type: 'B2B', status: 'Kazanıldı', sector: 'Savunma', cityKey: 'RO:Bükreş', owner: 'ihracat@mke.gov.tr' },
  { name: 'EDGE Group PJSC', type: 'B2B', status: 'Müzakere', sector: 'Savunma', cityKey: 'AE:Abu Dabi', owner: 'ihracat@mke.gov.tr' },
  { name: 'Barzan Holdings', type: 'B2B', status: 'Teklif Verildi', sector: 'Savunma', cityKey: 'QA:Doha', owner: 'ihracat@mke.gov.tr' },
  { name: 'Military Industry Corporation', type: 'B2B', status: 'İletişime Geçildi', sector: 'Savunma', cityKey: 'EG:Kahire', owner: 'ihracat@mke.gov.tr' },
  { name: 'Yugoimport SDPR', type: 'B2B', status: 'Potansiyel', sector: 'Savunma', cityKey: 'RS:Belgrad', owner: 'ihracat@mke.gov.tr' },
  { name: 'Defence Industries Organisation — Astana', type: 'B2B', status: 'Kaybedildi', sector: 'Savunma', cityKey: 'KZ:Astana', owner: 'ihracat@mke.gov.tr' },
  { name: 'Nexter Systems', type: 'B2B', status: 'Kaybedildi', sector: 'Savunma', cityKey: 'FR:Paris', owner: 'ihracat@mke.gov.tr' },
  // Şehir listesinde OLMAYAN bir lokasyon: serbest metin + elle koordinat.
  { name: 'Gulf Ordnance Trading FZE', type: 'B2B', status: 'Potansiyel', sector: 'Savunma', cityKey: 'AE:Dubai', owner: 'ihracat@mke.gov.tr',
    freeCity: { name: 'Jebel Ali Free Zone', latitude: 25.0110, longitude: 55.0618 } },

  // --- Yurt dışı B2C ---
  { name: 'Berlin Sportschützen Verband', type: 'B2C', status: 'Teklif Verildi', sector: 'Diğer', cityKey: 'DE:Berlin', owner: 'ihracat@mke.gov.tr' },
  { name: 'Baku Shooting Federation', type: 'B2C', status: 'Kazanıldı', sector: 'Diğer', cityKey: 'AZ:Bakü', owner: 'ihracat@mke.gov.tr' },
  { name: 'Doha Hunting & Equestrian Club', type: 'B2C', status: 'Müzakere', sector: 'Diğer', cityKey: 'QA:Doha', owner: 'ihracat@mke.gov.tr' },
];

async function seedCompanies(
  cityIndex: Map<string, string>,
  userIndex: Map<string, string>,
  departmentIds: string[],
): Promise<Map<string, string>> {
  const cityRows = await prisma.city.findMany({
    select: { id: true, name: true, country: true, countryCode: true },
  });
  const cityById = new Map(cityRows.map((c) => [c.id, c]));

  const index = new Map<string, string>();

  for (const seed of COMPANIES) {
    const cityId = cityIndex.get(seed.cityKey) ?? null;
    const city = cityId ? cityById.get(cityId) : undefined;

    const existing = await prisma.company.findFirst({
      where: { name: seed.name },
      select: { id: true },
    });

    const data = {
      name: seed.name,
      type: seed.type,
      status: seed.status,
      sector: seed.sector,
      website: seed.website ?? null,
      country: city?.country ?? 'Türkiye',
      countryCode: city?.countryCode ?? 'TR',
      cityId,
      cityName: seed.freeCity?.name ?? null,
      // Serbest metin lokasyonlarda koordinat elle verilir; aksi halde
      // rota katmanı şehir koordinatına düşer ve pin yine haritada çıkar.
      latitude: seed.freeCity?.latitude ?? null,
      longitude: seed.freeCity?.longitude ?? null,
      ownerId: userIndex.get(seed.owner) ?? null,
      // Yurt dışı kayıtlar Uluslararası Satış departmanına, yurt içi
      // kayıtlar Savunma Satış'a bağlanır (departman kapsamı testi için).
      departmentId:
        (city?.countryCode ?? 'TR') === 'TR'
          ? departmentIds[0] ?? null
          : departmentIds[2] ?? null,
    };

    const row = existing
      ? await prisma.company.update({ where: { id: existing.id }, data })
      : await prisma.company.create({ data });

    index.set(seed.name, row.id);
  }

  console.log(`✔ ${COMPANIES.length} şirket yüklendi (yurt içi + yurt dışı, B2G/B2B/B2C).`);
  return index;
}

// ---------------------------------------------------------------------------
// Kişiler, anlaşmalar, ihaleler
// ---------------------------------------------------------------------------

const FIRST_NAMES = ['Ahmet', 'Mehmet', 'Ayşe', 'Fatma', 'Mustafa', 'Elif', 'Can', 'Zeynep',
  'Hasan', 'Merve', 'Omar', 'Khalid', 'Anna', 'Marco', 'Imran', 'Rashid', 'Elena', 'Viktor'];
const LAST_NAMES = ['Yılmaz', 'Demir', 'Kaya', 'Çelik', 'Şahin', 'Aydın', 'Öztürk', 'Arslan',
  'Al-Mansouri', 'Rossi', 'Müller', 'Khan', 'Petrov', 'Nowak', 'Haddad', 'Osman'];
const TITLES = ['Satın Alma Müdürü', 'Tedarik Uzmanı', 'Teknik Direktör', 'Proje Yöneticisi',
  'İhale Sorumlusu', 'Genel Müdür Yardımcısı', 'Kalite Müdürü'];

/** Deterministik sözde-rastgele: her çalıştırmada aynı veri üretilir. */
function pick<T>(list: T[], seed: number): T {
  return list[seed % list.length]!;
}

async function seedContacts(companyIndex: Map<string, string>): Promise<void> {
  let created = 0;
  let counter = 0;

  for (const [name, companyId] of companyIndex) {
    const existing = await prisma.contact.count({ where: { companyId } });
    if (existing > 0) continue;

    const contactCount = 1 + (counter % 3);
    for (let i = 0; i < contactCount; i += 1) {
      counter += 1;
      const firstName = pick(FIRST_NAMES, counter * 7 + i);
      const lastName = pick(LAST_NAMES, counter * 3 + i);
      const isForeign = !name.match(/[çğıöşüÇĞİÖŞÜ]/) && /[A-Z]{2,}|Ltd|PJSC|S\.p\.A|GmbH|FZE/.test(name);

      await prisma.contact.create({
        data: {
          companyId,
          firstName,
          lastName,
          title: pick(TITLES, counter + i),
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
          departmentName: i === 0 ? 'Tedarik' : 'Teknik',
          isPrimary: i === 0,
          // Esnek doğum günü: bazılarında yalnızca yıl, bazılarında ay/gün.
          birthYear: counter % 3 === 0 ? 1970 + (counter % 25) : null,
          birthMonth: counter % 2 === 0 ? 1 + (counter % 12) : null,
          birthDay: counter % 2 === 0 ? 1 + (counter % 28) : null,
          phones: {
            create: [
              {
                number: isForeign
                  ? `+971 50 ${100 + (counter % 800)} ${1000 + (counter % 9000)}`
                  : `0532 ${100 + (counter % 800)} ${10 + (counter % 89)} ${10 + (counter % 89)}`,
                normalizedNumber: isForeign
                  ? `97150${100 + (counter % 800)}${1000 + (counter % 9000)}`
                  : `90532${100 + (counter % 800)}${10 + (counter % 89)}${10 + (counter % 89)}`,
                label: 'Cep',
                isPrimary: true,
              },
              // Her üçüncü kişide "kullanım dışı" bir eski numara — arama
              // davranışının doğrulanabilmesi için.
              ...(counter % 3 === 0
                ? [{
                    number: `0312 ${200 + (counter % 700)} ${10 + (counter % 89)} ${10 + (counter % 89)}`,
                    normalizedNumber: `90312${200 + (counter % 700)}${10 + (counter % 89)}${10 + (counter % 89)}`,
                    label: 'Sabit',
                    isPrimary: false,
                    isInactive: true,
                    inactiveReason: 'Hat kapandı',
                  }]
                : []),
            ],
          },
        },
      });
      created += 1;
    }
  }

  console.log(`✔ ${created} kişi yüklendi (çoklu telefon + kullanım dışı numara örnekleriyle).`);
}

const DEAL_TITLES = [
  '7.62 mm Mühimmat Tedarik Paketi',
  '5.56 mm NATO Fişek Çerçeve Anlaşması',
  '120 mm Tank Mühimmatı Alımı',
  'Yedek Parça ve Bakım Paketi',
  'Namlu Üretim Hattı Modernizasyonu',
  'Endüstriyel Patlayıcı Hammadde Tedariki',
  'Periyodik Bakım Hizmet Sözleşmesi',
  'Eğitim Mühimmatı Yıllık Alımı',
];

const LOSS_REASONS = ['Yüksek Fiyat', 'Şartname Uyumsuzluğu', 'Teslimat Süresi', 'Rakip Tercihi', 'İhale İptali'];

async function seedDeals(companyIndex: Map<string, string>): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { id: { in: [...companyIndex.values()] } },
    select: { id: true, name: true, status: true, type: true, countryCode: true, ownerId: true },
  });

  const rates: Record<string, number> = { TRY: 1, USD: 42.15, EUR: 49.30, GBP: 56.80 };
  let created = 0;
  let counter = 0;

  for (const company of companies) {
    if ((await prisma.deal.count({ where: { companyId: company.id } })) > 0) continue;

    const dealCount = 1 + (counter % 3);
    for (let i = 0; i < dealCount; i += 1) {
      counter += 1;

      // Yurt dışı işler döviz, yurt içi işler TL bazlıdır.
      const currency = company.countryCode === 'TR'
        ? 'TRY'
        : (['USD', 'EUR', 'USD'] as const)[counter % 3]!;

      // Şirketin ana aşaması ilk anlaşmaya yansır; diğerleri çeşitlenir.
      const stage = i === 0
        ? company.status
        : pick(['Potansiyel', 'İletişime Geçildi', 'Teklif Verildi', 'Müzakere', 'Kazanıldı'], counter + i);

      const baseAmount = company.type === 'B2C'
        ? 80_000 + (counter % 12) * 25_000
        : company.type === 'B2G'
          ? 4_000_000 + (counter % 9) * 3_500_000
          : 1_200_000 + (counter % 11) * 900_000;

      const amount = currency === 'TRY' ? baseAmount : Math.round(baseAmount / 30);
      const isClosed = stage === 'Kazanıldı' || stage === 'Kaybedildi';

      await prisma.deal.create({
        data: {
          title: `${pick(DEAL_TITLES, counter + i)} — ${company.name.slice(0, 28)}`,
          companyId: company.id,
          ownerId: company.ownerId,
          stage,
          amount,
          currency,
          // Kur kayıt anında dondurulur (canlı kurla yeniden hesaplanmaz).
          exchangeRate: rates[currency] ?? 1,
          expectedCloseDate: new Date(Date.now() + ((counter % 14) - 4) * 15 * 86_400_000),
          description: 'Tohum verisi ile oluşturulmuş örnek satış fırsatı.',
          winProbabilityScore: stage === 'Kazanıldı' ? 100 : stage === 'Kaybedildi' ? 0 : 20 + (counter % 70),
          lossReason: stage === 'Kaybedildi' ? pick(LOSS_REASONS, counter) : null,
          closedAt: isClosed ? new Date(Date.now() - (counter % 60) * 86_400_000) : null,
          createdAt: new Date(Date.now() - (10 + (counter % 120)) * 86_400_000),
        },
      });
      created += 1;
    }
  }

  console.log(`✔ ${created} satış fırsatı yüklendi (TL + döviz, tüm aşamalar).`);
}

async function seedTenders(companyIndex: Map<string, string>): Promise<void> {
  const b2gCompanies = await prisma.company.findMany({
    where: { id: { in: [...companyIndex.values()] }, type: 'B2G' },
    select: { id: true, name: true, countryCode: true },
  });

  let created = 0;
  for (const [i, company] of b2gCompanies.entries()) {
    if ((await prisma.tender.count({ where: { companyId: company.id } })) > 0) continue;

    const currency = company.countryCode === 'TR' ? 'TRY' : 'USD';
    await prisma.tender.create({
      data: {
        tenderNumber: `IHL-2026-${String(1000 + i).padStart(4, '0')}`,
        title: `${pick(DEAL_TITLES, i)} İhalesi`,
        companyId: company.id,
        status: pick(['Takipte', 'Şartname Alındı', 'Teklif Hazırlanıyor', 'Teklif Verildi', 'Değerlendirmede'], i),
        method: 'Açık İhale',
        currency,
        exchangeRate: currency === 'TRY' ? 1 : 42.15,
        estimatedValue: currency === 'TRY' ? 12_000_000 + i * 4_000_000 : 400_000 + i * 120_000,
        announcementDate: new Date(Date.now() - (20 + i * 3) * 86_400_000),
        submissionDeadline: new Date(Date.now() + ((i % 9) - 2) * 10 * 86_400_000),
        description: 'Tohum verisi ile oluşturulmuş örnek ihale kaydı.',
        specificationText: i % 2 === 0
          ? [
              'TEKNİK ŞARTNAME (ÖRNEK)',
              '1. Teslimat, sözleşme imzasından itibaren 180 takvim günü içinde tamamlanacaktır.',
              '2. Yüklenici, ISO 9001 ve AQAP 2110 belgelerine sahip olmalıdır.',
              '3. Muayene ve kabul işlemleri idarenin belirleyeceği tesiste yapılacaktır.',
              '4. Geçici teminat, teklif bedelinin %3\'ünden az olamaz.',
              '5. Gecikme halinde günlük %0,05 oranında ceza uygulanır.',
              '6. Yedek parça garantisi asgari 10 yıl olacaktır.',
            ].join('\n')
          : null,
        winProbabilityScore: 25 + (i * 7) % 60,
      },
    });
    created += 1;
  }

  console.log(`✔ ${created} ihale yüklendi.`);
}

// ---------------------------------------------------------------------------
// Sabit veriler
// ---------------------------------------------------------------------------

async function seedExchangeRates(): Promise<void> {
  const seeds = [
    { code: 'USD', rate: 42.15 },
    { code: 'EUR', rate: 49.30 },
    { code: 'GBP', rate: 56.80 },
  ];
  for (const seed of seeds) {
    await prisma.exchangeRateCache.upsert({
      where: { code: seed.code },
      update: {},
      create: { ...seed, source: 'SEED' },
    });
  }
  console.log('✔ Başlangıç kurları yüklendi.');
}

async function seedProducts(): Promise<void> {
  const products = [
    { sku: 'MKE-MH-7762', name: '7.62x51 mm NATO Fişek', category: 'Mühimmat', unitPrice: 48.5, unit: 'Adet', stockQuantity: 250_000 },
    { sku: 'MKE-MH-5556', name: '5.56x45 mm NATO Fişek', category: 'Mühimmat', unitPrice: 32.0, unit: 'Adet', stockQuantity: 480_000 },
    { sku: 'MKE-AS-120M', name: '120 mm Tank Mühimmatı', category: 'Ağır Silah', unitPrice: 185_000, unit: 'Adet', stockQuantity: 420 },
    { sku: 'MKE-YP-0431', name: 'Namlu Yedek Parça Seti', category: 'Yedek Parça', unitPrice: 12_400, unit: 'Koli', stockQuantity: 75 },
    { sku: 'MKE-KM-TNT1', name: 'Endüstriyel Patlayıcı Hammadde', category: 'Kimyasal', unitPrice: 890, unit: 'Kg', stockQuantity: 12_000 },
    { sku: 'MKE-HZ-BAKIM', name: 'Periyodik Bakım Hizmeti', category: 'Hizmet', unitPrice: 4_500, unit: 'Saat', stockQuantity: 0 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: { ...product, currency: 'TRY', taxRate: 20, minStockLevel: 50 },
    });
  }
  console.log(`✔ ${products.length} ürün yüklendi.`);
}

async function seedCustomFields(): Promise<void> {
  const definitions = [
    { entityType: 'COMPANY', fieldKey: 'guvenlikBelgesi', fieldLabel: 'Tesis Güvenlik Belgesi', fieldType: 'SELECT', optionsJson: JSON.stringify(['Var', 'Yok', 'Başvuru Aşamasında']) },
    { entityType: 'COMPANY', fieldKey: 'ihracatLisansi', fieldLabel: 'İhracat Lisans Durumu', fieldType: 'SELECT', optionsJson: JSON.stringify(['Alındı', 'Başvuruldu', 'Gerekmiyor']) },
    { entityType: 'COMPANY', fieldKey: 'sozlesmeSorumlusu', fieldLabel: 'Sözleşme Sorumlusu', fieldType: 'TEXT', optionsJson: null },
    { entityType: 'TENDER', fieldKey: 'ekapNo', fieldLabel: 'EKAP İhale Kayıt No', fieldType: 'TEXT', optionsJson: null },
    { entityType: 'TENDER', fieldKey: 'gecicTeminat', fieldLabel: 'Geçici Teminat Tutarı', fieldType: 'NUMBER', optionsJson: null },
  ];

  for (const [index, def] of definitions.entries()) {
    await prisma.customFieldDefinition.upsert({
      where: { entityType_fieldKey: { entityType: def.entityType, fieldKey: def.fieldKey } },
      update: {},
      create: { ...def, sortOrder: index },
    });
  }
  console.log(`✔ ${definitions.length} özel alan tanımı yüklendi.`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('MKE CRM tohum verisi yükleniyor...\n');

  const cityIndex = await seedCities();
  const departmentIds = await seedDepartments();
  const userIndex = await seedUsers(departmentIds);

  await seedExchangeRates();
  await seedProducts();
  await seedCustomFields();

  const companyIndex = await seedCompanies(cityIndex, userIndex, departmentIds);
  await seedContacts(companyIndex);
  await seedDeals(companyIndex);
  await seedTenders(companyIndex);

  console.log('\n✅ Tamamlandı.');
}

main()
  .catch((error) => {
    console.error('Tohum verisi yüklenemedi:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
