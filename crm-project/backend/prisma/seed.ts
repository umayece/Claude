/* eslint-disable no-console */
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** 81 il — harita koordinatları buradan gelir (il merkezleri). */
const CITIES: [number, string, number, number][] = [
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
];

async function seedCities(): Promise<void> {
  for (const [plateCode, name, latitude, longitude] of CITIES) {
    await prisma.city.upsert({
      where: { plateCode },
      update: { name, latitude, longitude },
      create: { plateCode, name, latitude, longitude },
    });
  }
  console.log(`✔ ${CITIES.length} il yüklendi.`);
}

async function seedDepartments(): Promise<string[]> {
  const names = ['Savunma Satış', 'Kamu İhaleleri', 'Satış Sonrası Hizmetler', 'Yönetim'];
  const ids: string[] = [];
  for (const name of names) {
    const dept = await prisma.department.upsert({
      where: { name }, update: {}, create: { name },
    });
    ids.push(dept.id);
  }
  console.log(`✔ ${names.length} departman yüklendi.`);
  return ids;
}

async function seedUsers(departmentIds: string[]): Promise<void> {
  // Geliştirme parolası. Üretimde ilk girişte değiştirilmesi zorunludur.
  const passwordHash = await bcrypt.hash('MkeCrm!2026', 12);

  const users: { email: string; name: string; role: Role; dept: number }[] = [
    { email: 'admin@mke.gov.tr', name: 'Sistem Yöneticisi', role: 'ADMIN', dept: 3 },
    { email: 'mudur@mke.gov.tr', name: 'Satış Müdürü', role: 'MANAGER', dept: 0 },
    { email: 'satis@mke.gov.tr', name: 'Satış Uzmanı', role: 'SALES', dept: 0 },
    { email: 'ihale@mke.gov.tr', name: 'İhale Uzmanı', role: 'SALES', dept: 1 },
    { email: 'servis@mke.gov.tr', name: 'Servis Sorumlusu', role: 'SUPPORT', dept: 2 },
  ];

  for (const user of users) {
    await prisma.user.upsert({
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
  }
  console.log(`✔ ${users.length} kullanıcı yüklendi (şifre: MkeCrm!2026).`);
}

async function seedExchangeRates(): Promise<void> {
  // Başlangıç değerleri; ilk TCMB senkronizasyonunda güncellenir.
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

async function main(): Promise<void> {
  console.log('MKE CRM tohum verisi yükleniyor...\n');
  await seedCities();
  const departmentIds = await seedDepartments();
  await seedUsers(departmentIds);
  await seedExchangeRates();
  await seedProducts();
  await seedCustomFields();
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
