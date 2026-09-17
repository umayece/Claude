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

export interface Contact {
  id: string;
  companyId: string;
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
}

export interface Deal {
  id: string;
  title: string;
  companyId: string;
  contactId: string | null;
  ownerId: string | null;
  stage: string;
  amount: number;
  amountTry?: number;
  currency: CurrencyCode;
  exchangeRate: number;
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
  exchangeRate: number;
  estimatedValue: number;
  estimatedValueTry?: number;
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
  taxRate: number;
  discountRate: number;
  lineTotal: number;
  sortOrder: number;
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
  exchangeRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  totalTry?: number;
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
  amountTry?: number;
  currency: CurrencyCode;
  exchangeRate: number;
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
  amountTry?: number;
  currency: CurrencyCode;
  exchangeRate: number;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  description: string | null;
  terms: string | null;
  createdAt: string;
  company?: { id: string; name: string };
  offer?: { id: string; offerNumber: string; title: string } | null;
  tender?: { id: string; tenderNumber: string; title: string } | null;
  milestones?: PaymentMilestone[];
  milestoneSummary?: {
    total: number; collectedTry: number; pendingTry: number; overdueCount: number;
  };
  _count?: { milestones: number };
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
  source: string;
  updatedAt: string;
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
    openAmountTry: number;
    winRate: number | null;
  };
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
