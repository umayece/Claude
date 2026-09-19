/** Backend sözleşmesinin aynası. Rota yanıtları bu tiplerle daraltılır. */

export type Role = 'ADMIN' | 'MANAGER' | 'SALES' | 'SUPPORT' | 'VIEWER';
export type CompanyType = 'B2G' | 'B2B' | 'B2C' | 'G2G' | 'OTHER';
export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  avatarUrl: string | null;
  phone?: string | null;
  permissions: string[];
  mfaEnabled?: boolean;
  mfaSatisfied?: boolean;
  secondaryEmails?: string[] | null;
  calendarFilterPreferences?: CalendarFilterPreferences | null;
  department?: { id: string; name: string } | null;
}

export interface CalendarFilterPreferences {
  showTasks?: boolean;
  showTenders?: boolean;
  showContracts?: boolean;
  showBirthdays?: boolean;
  showMilestones?: boolean;
}

export interface City {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 */
  countryCode: string;
  country: string;
  /** Yalnızca Türkiye illerinde dolu. */
  plateCode: number | null;
  latitude: number;
  longitude: number;
  region: string | null;
}

export interface CountryOption {
  countryCode: string;
  country: string;
  cityCount: number;
}

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  status: string;
  sector: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  address: string | null;
  country: string;
  countryCode: string;
  cityId: string | null;
  /** Şehir listesinde olmayan lokasyonlar için serbest metin. */
  cityName: string | null;
  /** Sunucunun çözdüğü görünen şehir adı (şehir kaydı ya da serbest metin). */
  displayCity?: string | null;
  districtName: string | null;
  latitude: number | null;
  longitude: number | null;
  rawLatitude?: number | null;
  rawLongitude?: number | null;
  coordinateSource?: 'COMPANY' | 'CITY' | 'NONE';
  notes: string | null;
  ownerId: string | null;
  departmentId: string | null;
  customFields: Record<string, unknown> | null;
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  city?: {
    id: string; name: string; latitude: number; longitude: number;
    country: string; countryCode: string;
  } | null;
  owner?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  revenueTry?: number;
  purgeAt?: string;
  daysUntilPurge?: number;
  _count?: {
    contacts: number; deals: number; tenders: number; contracts: number; tickets: number;
  };
  contacts?: Contact[];
  deals?: Deal[];
  tenders?: Tender[];
  contracts?: Contract[];
  tickets?: Ticket[];
  /** İlişkisel etiket bağları. */
  tags?: TagLink[];
}

export interface MapPoint {
  id: string;
  name: string;
  type: CompanyType;
  status: string;
  sector: string | null;
  cityName: string | null;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  coordinateSource: string;
  revenueTry: number;
  tenderCount: number;
  dealCount: number;
  createdAt: string;
}

export type PhoneLabel = 'İş' | 'Cep' | 'Sabit' | 'Dahili' | 'Faks';

export interface ContactPhone {
  id: string;
  contactId?: string;
  number: string;
  normalizedNumber?: string;
  label: PhoneLabel;
  isPrimary: boolean;
  isInactive: boolean;
  inactiveReason: string | null;
}

export type ContactType =
  | 'Kurum Çalışanı' | 'Bağımsız Danışman' | 'Aracı/Komisyoncu'
  | 'Askeri Ataşe' | 'Diğer';

export const CONTACT_TYPES: ContactType[] = [
  'Kurum Çalışanı', 'Bağımsız Danışman', 'Aracı/Komisyoncu',
  'Askeri Ataşe', 'Diğer',
];

export interface Contact {
  id: string;
  /** Bağımsız kişilerde (danışman, aracı, ataşe) null olur. */
  companyId: string | null;
  contactType: ContactType;
  /** Kuruma bağlı olmayan kişinin kendi adres/konum bilgisi. */
  addressLine: string | null;
  cityName: string | null;
  country: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  departmentName: string | null;
  managerName: string | null;
  website: string | null;
  sector: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  isPrimary: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  phones: ContactPhone[];
  company?: { id: string; name: string; type?: CompanyType };
  deals?: Deal[];
  offers?: Offer[];
  tickets?: Ticket[];
  tags?: TagLink[];
}

export interface Deal {
  id: string;
  title: string;
  companyId: string;
  contactId: string | null;
  ownerId: string | null;
  stage: string;
  amount: number;
  currency: CurrencyCode;
  /** Denetim izi — değerlemede KULLANILMAZ. */
  exchangeRateAtCreation?: number | null;
  /** Sunucunun anlık kurla hesapladığı karşılıklar. */
  amountTry?: number;
  amountUsd?: number;
  rate?: number;
  expectedCloseDate: string | null;
  description: string | null;
  winProbabilityScore: number | null;
  lossReason: string | null;
  lossDetail: string | null;
  closedAt: string | null;
  createdAt: string;
  company?: { id: string; name: string; type?: CompanyType };
  contact?: { id: string; firstName: string; lastName: string } | null;
  owner?: { id: string; name: string } | null;
}

export interface Tender {
  id: string;
  tenderNumber: string;
  title: string;
  companyId: string;
  status: string;
  method: string | null;
  currency: CurrencyCode;
  exchangeRateAtCreation?: number | null;
  estimatedValue: number;
  estimatedValueTry?: number;
  amountTry?: number;
  amountUsd?: number;
  submissionDeadline: string | null;
  announcementDate: string | null;
  description: string | null;
  specificationText?: string | null;
  hasSpecification?: boolean;
  daysUntilDeadline?: number | null;
  winProbabilityScore: number | null;
  lossReason: string | null;
  lossDetail: string | null;
  createdAt: string;
  company?: { id: string; name: string; type?: CompanyType };
}

export interface OfferItem {
  id: string;
  productId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  /** Birim başına tahmini maliyet (Offer.costCurrency cinsinden). */
  cost: number;
  taxRate: number;
  discountRate: number;
  lineTotal: number;
  sortOrder: number;
}

/** Teklif kârlılığı — sunucuda anlık kurla hesaplanır. */
export interface OfferMargin {
  revenueTry: number;
  costTry: number;
  grossProfitTry: number;
  /** Ciro sıfırken marj tanımsızdır. */
  marginPercent: number | null;
}

export interface Offer {
  id: string;
  offerNumber: string;
  title: string;
  companyId: string;
  contactId: string | null;
  dealId: string | null;
  status: string;
  currency: CurrencyCode;
  exchangeRateAtCreation?: number | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  costTotal: number;
  costCurrency: CurrencyCode;
  incoterm: string | null;
  incotermPlace: string | null;
  margin?: OfferMargin;
  totalTry?: number;
  amountTry?: number;
  amountUsd?: number;
  amountTryAtCreation?: number | null;
  hasDrift?: boolean;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  createdAt: string;
  items?: OfferItem[];
  company?: { id: string; name: string };
}

export interface PaymentMilestone {
  id: string;
  contractId: string;
  title: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRateAtCreation?: number | null;
  amountTry?: number;
  amountUsd?: number;
  amountTryAtCreation?: number | null;
  hasDrift?: boolean;
  dueDate: string;
  status: string;
  effectiveStatus?: string;
  isOverdue?: boolean;
  daysOverdue?: number;
  invoiceNumber: string | null;
  paidAt: string | null;
  note: string | null;
  sortOrder: number;
}

export interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  companyId: string;
  offerId: string | null;
  tenderId: string | null;
  status: string;
  amount: number;
  currency: CurrencyCode;
  /** İmza tarihindeki kur; taslak sözleşmelerde null. */
  exchangeRateAtCreation?: number | null;
  amountTry?: number;
  amountUsd?: number;
  amountTryAtCreation?: number | null;
  differenceTry?: number | null;
  driftPercent?: number | null;
  hasDrift?: boolean;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  description: string | null;
  terms: string | null;

  // --- Termin (teslimat) ---
  deliveryDate: string | null;
  originalDeliveryDate: string | null;
  deliveryRevisedAt: string | null;
  deliveryNote: string | null;
  deliveredAt: string | null;
  /** Sunucuda hesaplanan termin durumu. */
  delivery?: DeliveryInfo;

  // --- Gerçekleşen maliyet ---
  cogs: number | null;
  cogsCurrency: CurrencyCode;
  cogsNote: string | null;

  // --- Teslim şekli (Incoterms 2020) ---
  incoterm: string | null;
  incotermPlace: string | null;

  // --- İhracat kontrolü ---
  eucStatus: EucStatus;
  eucAuthority: string | null;
  eucReference: string | null;
  eucReceivedAt: string | null;
  exportLicenceStatus: ExportLicenceStatus;
  exportLicenceAuthority: string | null;
  exportLicenceNumber: string | null;
  exportLicenceAppliedAt: string | null;
  exportLicenceIssuedAt: string | null;
  exportLicenceExpiresAt: string | null;
  exportLicenceNote: string | null;
  /** Sunucuda hesaplanan sevkiyat hazırlık durumu. */
  exportGate?: ExportGate;
  stockReserved: boolean;
  stockNote: string | null;

  createdAt: string;
  company?: { id: string; name: string };
  offer?: { id: string; offerNumber: string; title: string } | null;
  tender?: { id: string; tenderNumber: string; title: string } | null;
  milestones?: PaymentMilestone[];
  /** Siparişe bağlı ürünlerin anlık stok durumu (detayda döner). */
  stockLines?: StockLine[];
  milestoneSummary?: {
    total: number; collectedTry: number; pendingTry: number; overdueCount: number;
  };
  _count?: { milestones: number };
}

export type DeliveryUrgency = 'GECIKTI' | 'BUGUN' | 'KRITIK' | 'YAKIN' | 'UZAK' | 'YOK';

export interface DeliveryInfo {
  deliveryDate: string | null;
  originalDeliveryDate: string | null;
  /** Bugünden termine kalan tam gün; negatifse gecikme. */
  daysUntil: number | null;
  isOverdue: boolean;
  isDelivered: boolean;
  /** Tetiklenen eşik: 30, 15 veya 7. */
  reminderTier: number | null;
  urgency: DeliveryUrgency;
  /** Orijinal taahhüde göre kayma (gün). */
  slipDays: number;
}

/** Sipariş kaleminin taahhüt edilen adedi ile depodaki adedi. */
export interface StockLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  stockQuantity: number;
  minStockLevel: number;
  shortage: number;
  isSufficient: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unitPrice: number;
  currency: CurrencyCode;
  taxRate: number;
  stockQuantity: number;
  minStockLevel: number;
  unit: string;
  isActive: boolean;
  isLowStock?: boolean;
  createdAt: string;

  // Ambalaj / lojistik
  unitWeightKg?: number | null;
  caseQuantity?: number | null;
  caseLengthCm?: number | null;
  caseWidthCm?: number | null;
  caseHeightCm?: number | null;
  caseWeightKg?: number | null;
  hazardClass?: string | null;

  // --- Savunma sanayii sınıflandırması ---
  /** BM madde numarası, ör. "UN0012". */
  unNumber?: string | null;
  /** Birim başına net patlayıcı ağırlığı (gram). */
  neqGrams?: number | null;
  /** NATO Stok Numarası, 13 hane. */
  nsn?: string | null;
  /** Askeri Liste sınıfı, ör. "ML3". */
  militaryListCategory?: string | null;
  requiresExportLicence?: boolean;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  companyId: string;
  contactId: string | null;
  assignedUserId: string | null;
  slaDeadline: string | null;
  slaBreached?: boolean;
  hoursUntilSla?: number | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  company?: { id: string; name: string };
  contact?: { id: string; firstName: string; lastName: string } | null;
  assignedUser?: { id: string; name: string; avatarUrl: string | null } | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  dueDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  tenderId: string | null;
  assignedUserId: string | null;
  completedAt: string | null;
  isOverdue?: boolean;
  daysOverdue?: number;
  createdAt: string;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  deal?: { id: string; title: string } | null;
  tender?: { id: string; tenderNumber: string; title: string } | null;
  assignedUser?: { id: string; name: string; avatarUrl: string | null } | null;
}

export type CalendarEventType =
  | 'TASK' | 'TENDER_DEADLINE' | 'CONTRACT_RENEWAL' | 'BIRTHDAY' | 'MILESTONE';

export interface CalendarEvent {
  id: string;
  sourceId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  type: CalendarEventType;
  priority: string | null;
  status: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  description: string | null;
  isOverdue: boolean;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  body: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user?: { id: string; name: string; avatarUrl: string | null } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
}

export interface EmailMessage {
  id: string;
  toAddress: string;
  ccAddress: string | null;
  subject: string;
  bodyHtml?: string;
  bodyText?: string | null;
  preview?: string;
  status: string;
  provider: string;
  sentAt: string;
  createdAt: string;
  errorText: string | null;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  user?: { id: string; name: string } | null;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  ip: string | null;
  userAgent: string | null;
  statusCode: number | null;
  createdAt: string;
  user?: { id: string; name: string; email: string; avatarUrl: string | null } | null;
}

export interface ExchangeRate {
  code: CurrencyCode;
  rate: number;
  /** TCMB | FALLBACK_ECB | MANUEL | SEED | SABIT */
  source: string;
  /** Kaynağın yayınladığı değerleme tarihi. */
  rateDate: string | null;
  updatedAt: string;
}

/** Anlık değerleme — listeler ve panolar bunu kullanır. */
export interface LiveValuation {
  amountTry: number;
  amountUsd: number;
  rate: number;
}

/** Resmî belgeler için çift değerleme (imza tarihi + güncel piyasa). */
export interface DualValuation extends LiveValuation {
  rateAtCreation: number | null;
  amountTryAtCreation: number | null;
  differenceTry: number | null;
  driftPercent: number | null;
  hasDrift: boolean;
}

export interface CustomFieldDefinition {
  id: string;
  entityType: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT';
  options: string[];
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface FunnelStage {
  stage: string;
  count: number;
  totalTry: number;
  totalUsd?: number;
  conversionRate: number | null;
}

export interface DashboardData {
  range: { from: string; to: string; preset: string };
  kpis: {
    companyCount: number;
    newCompanyCount: number;
    contactCount: number;
    openTenders: number;
    activeContracts: number;
    openTickets: number;
    overdueTasks: number;
    dealCount: number;
    wonCount: number;
    lostCount: number;
    wonAmountTry: number;
    wonAmountUsd: number;
    openAmountTry: number;
    openAmountUsd: number;
    winRate: number | null;
  };
  valuation?: { valuedAt: string; rates: Record<string, number> };
  funnel: FunnelStage[];
  lossReasons: { reason: string; count: number }[];
  series: { date: string; count: number; totalTry: number }[];
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  matchReason: string | null;
  companyId: string | null;
  url: string;
}

export interface StickyNote {
  id: string;
  title: string | null;
  body: string;
  color: string;
  positionX: number;
  positionY: number;
  isPinned: boolean;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string; type?: CompanyType } | null;
  contact?: { id: string; firstName: string; lastName: string } | null;
  deal?: { id: string; title: string } | null;
  user?: { id: string; name: string; avatarUrl: string | null } | null;
}

/** `StickyNote` ile aynı kayıt; kurum detayında bu adla anılır. */
export type Note = StickyNote;

// ---------------------------------------------------------------------------
// Protokol & heyet programı
// ---------------------------------------------------------------------------

export interface VisitAgendaItem {
  id: string;
  visitId: string;
  day: string;
  startTime: string;
  endTime: string | null;
  title: string;
  activityType: string;
  location: string | null;
  responsible: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface VisitParticipant {
  id: string;
  visitId: string;
  /** MISAFIR (gelen heyet) veya EV_SAHIBI (eşlik eden MKE personeli) */
  side: 'MISAFIR' | 'EV_SAHIBI';
  fullName: string;
  title: string | null;
  rank: string | null;
  organization: string | null;
  nationality: string | null;
  passportNo: string | null;
  email: string | null;
  phone: string | null;
  /** false → listede üstü çizili gösterilir, kayıt silinmez. */
  isAttending: boolean;
  absenceReason: string | null;
  contactId: string | null;
  userId: string | null;
  sortOrder: number;
}

export interface VisitChecklistItem {
  id: string;
  visitId: string;
  title: string;
  category: string;
  isDone: boolean;
  dueDate: string | null;
  assignedUserId: string | null;
  note: string | null;
  sortOrder: number;
  completedAt: string | null;
}

export interface ProtocolVisit {
  id: string;
  visitCode: string;
  title: string;
  visitType: string;
  status: string;
  country: string;
  countryCode: string;
  companyId: string | null;
  startDate: string;
  endDate: string | null;
  location: string | null;
  classification: string;
  summary: string | null;
  hostUserId: string | null;
  createdAt: string;
  company?: { id: string; name: string; type?: CompanyType } | null;
  host?: { id: string; name: string; avatarUrl: string | null } | null;
  agenda?: VisitAgendaItem[];
  participants?: VisitParticipant[];
  checklist?: VisitChecklistItem[];
  documents?: DocumentFile[];
  pendingChecklist?: number;
  daysUntilStart?: number;
  _count?: { agenda: number; participants: number; checklist: number; documents: number };
  summaryStats?: {
    guestCount: number;
    guestAttending: number;
    hostCount: number;
    checklistDone: number;
    checklistTotal: number;
    agendaDays: number;
  };
}

// ---------------------------------------------------------------------------
// Belge deposu
// ---------------------------------------------------------------------------

export interface DocumentFile {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  description: string | null;
  classification: string;
  tags: string[] | null;
  companyId: string | null;
  visitId: string | null;
  activityId: string | null;
  createdAt: string;
  updatedAt?: string;
  company?: { id: string; name: string } | null;
  visit?: { id: string; visitCode: string; title: string } | null;
  uploadedBy?: { id: string; name: string; avatarUrl?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Sistem ayarları
// ---------------------------------------------------------------------------

export interface SystemSettingView {
  key: string;
  /** Sırlarda maskelenmiş önizleme, diğerlerinde gerçek değer. */
  value: string | null;
  isSecret: boolean;
  isSet: boolean;
  description: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  fromEnvironment: boolean;
}

// ---------------------------------------------------------------------------
// Lojistik
// ---------------------------------------------------------------------------

/** Ürün kataloğundaki ambalaj alanları (koli/palet/konteyner hesabı). */
export interface ProductPackaging {
  unitWeightKg: number | null;
  caseQuantity: number | null;
  caseLengthCm: number | null;
  caseWidthCm: number | null;
  caseHeightCm: number | null;
  caseWeightKg: number | null;
  hazardClass: string | null;
}


// ===========================================================================
// Aktivite havuzu (fuar, toplantı, saha ziyareti, fabrika gezisi)
// ===========================================================================

export type ActivityKind =
  | 'TOPLANTI' | 'FUAR' | 'SAHA_ZIYARETI' | 'FABRIKA_GEZISI' | 'DIGER';
export type ActivityStatus = 'Planlandı' | 'Devam Ediyor' | 'Tamamlandı' | 'İptal';
export type InterestLevel = 'Sıcak' | 'Ilık' | 'Soğuk';

export const ACTIVITY_KINDS: { key: ActivityKind; label: string }[] = [
  { key: 'TOPLANTI', label: 'Toplantı' },
  { key: 'FUAR', label: 'Fuar' },
  { key: 'SAHA_ZIYARETI', label: 'Saha Ziyareti' },
  { key: 'FABRIKA_GEZISI', label: 'Fabrika Gezisi' },
  { key: 'DIGER', label: 'Diğer' },
];

export const ACTIVITY_STATUSES: ActivityStatus[] = [
  'Planlandı', 'Devam Ediyor', 'Tamamlandı', 'İptal',
];

export const INTEREST_LEVELS: InterestLevel[] = ['Sıcak', 'Ilık', 'Soğuk'];

export interface ActivityTeamMember {
  id: string;
  activityId: string;
  userId: string | null;
  fullName: string;
  role: string | null;
  /** Katılamayan kişi listeden silinmez, üstü çizilir. */
  isAttending: boolean;
  absenceReason: string | null;
  sortOrder: number;
}

export interface ActivityContactLink {
  id: string;
  activityId: string;
  contactId: string;
  note: string | null;
  interest: InterestLevel;
  followedUp: boolean;
  createdAt: string;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    title: string | null;
    email: string | null;
    contactType: ContactType;
    country: string;
    countryCode: string;
    company?: { id: string; name: string } | null;
  };
}

export interface BusinessActivity {
  id: string;
  activityCode: string;
  title: string;
  type: ActivityKind;
  status: ActivityStatus;
  startDate: string;
  endDate: string | null;
  location: string | null;
  venue: string | null;
  country: string;
  countryCode: string;
  objective: string | null;
  summary: string | null;
  /** Fuar Sonuç Raporu özet değerlendirme notu. */
  outcomeNote: string | null;
  /** Rapor ilk yazıldığında damgalanır. */
  outcomeReportAt: string | null;
  leadCount: number;
  budgetAmount: number | null;
  budgetCurrency: CurrencyCode;
  ownerId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdAt: string;
  owner?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
  deal?: { id: string; title: string; stage: string } | null;
  team?: ActivityTeamMember[];
  contacts?: ActivityContactLink[];
  documents?: DocumentFile[];
  _count?: { team: number; contacts: number; documents: number };
}

export interface ActivitySummary {
  total: number;
  upcoming: number;
  fairs: number;
  /** Bitmiş ama sonuç raporu yazılmamış fuarlar. */
  awaitingReport: number;
}

// ===========================================================================
// Bildirimler (gecikmiş görev + termin uyarıları)
// ===========================================================================

export type NotificationKind = 'TASK_OVERDUE' | 'DELIVERY_DUE' | 'DELIVERY_OVERDUE';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  severity: number;
  dueDate: string | null;
  daysUntil: number | null;
}


// ===========================================================================
// Etiketler
// ===========================================================================

export interface Tag {
  id: string;
  name: string;
  /** Rozet rengi (#RRGGBB). */
  color: string;
  description: string | null;
  createdAt: string;
}

export interface TagSummary extends Tag {
  companyCount: number;
  contactCount: number;
  totalCount: number;
}

/** Kurum/kişi yanıtlarında gömülü gelen etiket bağı. */
export interface TagLink {
  tag: { id: string; name: string; color: string };
}

export interface TagRecords {
  tag: Tag;
  companies: {
    id: string; name: string; type: CompanyType; status: string;
    country: string; countryCode: string;
  }[];
  contacts: {
    id: string; firstName: string; lastName: string; title: string | null;
    contactType: ContactType; country: string;
    company: { id: string; name: string } | null;
  }[];
}

// ===========================================================================
// Savunma sanayii dış ticaret
// ===========================================================================

export const INCOTERMS: { code: string; label: string }[] = [
  { code: 'EXW', label: 'EXW — Ex Works (Fabrika Teslimi)' },
  { code: 'FCA', label: 'FCA — Free Carrier (Taşıyıcıya Teslim)' },
  { code: 'FAS', label: 'FAS — Free Alongside Ship' },
  { code: 'FOB', label: 'FOB — Free On Board (Gemi Bordasında)' },
  { code: 'CFR', label: 'CFR — Cost and Freight' },
  { code: 'CIF', label: 'CIF — Cost, Insurance and Freight' },
  { code: 'CPT', label: 'CPT — Carriage Paid To' },
  { code: 'CIP', label: 'CIP — Carriage and Insurance Paid To' },
  { code: 'DAP', label: 'DAP — Delivered At Place' },
  { code: 'DPU', label: 'DPU — Delivered at Place Unloaded' },
  { code: 'DDP', label: 'DDP — Delivered Duty Paid' },
];

export const EUC_STATUSES = [
  'Gerekli Değil', 'Talep Edildi', 'Beklemede', 'Alındı', 'Reddedildi',
] as const;
export type EucStatus = (typeof EUC_STATUSES)[number];

export const EXPORT_LICENCE_STATUSES = [
  'Gerekli Değil', 'Başvurulmadı', 'Başvuruldu', 'İnceleniyor',
  'Onaylandı', 'Reddedildi', 'Süresi Doldu',
] as const;
export type ExportLicenceStatus = (typeof EXPORT_LICENCE_STATUSES)[number];

export const LICENCE_AUTHORITIES = [
  'MSB (Millî Savunma Bakanlığı)',
  'SSB (Savunma Sanayii Başkanlığı)',
  'Dışişleri Bakanlığı',
  'Ticaret Bakanlığı',
  'Diğer',
];

export const UN_HAZARD_CLASSES = [
  { code: '1.1', label: '1.1 — Kütlesel patlama tehlikesi' },
  { code: '1.2', label: '1.2 — Parça saçma tehlikesi' },
  { code: '1.3', label: '1.3 — Yangın, hafif patlama tehlikesi' },
  { code: '1.4', label: '1.4 — Önemli tehlike arz etmeyen' },
  { code: '1.5', label: '1.5 — Çok duyarsız, kütlesel patlama tehlikeli' },
  { code: '1.6', label: '1.6 — Aşırı duyarsız' },
];

export type ExportReadiness = 'HAZIR' | 'BEKLIYOR' | 'ENGELLI' | 'GEREKSIZ';

/** Sevkiyat yapılabilir mi? Sunucuda izin ve EUC durumundan türer. */
export interface ExportGate {
  readiness: ExportReadiness;
  reason: string;
  licenceDaysLeft: number | null;
}
