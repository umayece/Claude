/**
 * MKE kurumsal evrak baskı şablonu.
 *
 * Neden tarayıcı yazdırma motoru: sunucu tarafı PDF üretimi (Puppeteer,
 * wkhtmltopdf) headless Chrome ve ~300 MB ek imaj bağımlılığı getirir.
 * Tarayıcının "PDF olarak kaydet" çıktısı aynı görsel sonucu verir ve
 * kullanıcı kâğıda basmayı da seçebilir.
 *
 * İçerik `textContent` ile yazılır: sözleşme metnindeki bir "<" karakteri
 * HTML olarak yorumlanmaz (saklanan-XSS yüzeyi kapatılır).
 */

export interface PrintParty {
  label: string;
  name: string;
  lines: string[];
}

export interface PrintSection {
  heading: string;
  /** Düz paragraflar. */
  paragraphs?: string[];
  /** Anahtar-değer künye satırları. */
  rows?: [string, string][];
  /** Tablo: başlık satırı + veri satırları. */
  table?: { headers: string[]; rows: string[][]; align?: ('left' | 'right')[] };
}

export interface PrintDocument {
  /** Üst bantta görünen evrak türü: "SÖZLEŞME", "TEKLİF" … */
  documentType: string;
  documentNumber: string;
  title: string;
  /** Gizlilik derecesi damgası. */
  classification?: string;
  parties?: PrintParty[];
  sections: PrintSection[];
  /** İmza/kaşe alanı başlıkları. */
  signatures?: { label: string; name?: string }[];
  footerNote?: string;
}

const STYLES = `
  @page { size: A4; margin: 18mm 16mm 20mm; }

  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    color: #111827; font-size: 11pt; line-height: 1.55; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .sheet { max-width: 190mm; margin: 0 auto; position: relative; }

  /*
     Resmî evrak filigranı.

     position: fixed kullanılır ki ÇOK SAYFALI çıktıda her sayfada
     görünsün; absolute olsaydı yalnızca ilk sayfaya basılırdı.
     Opaklık %4: metni okunaksız kılmadan evrakın kurumsal olduğunu
     belli eder.
  */
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-28deg);
    font-size: 96pt; font-weight: 900; letter-spacing: 12px;
    color: #0A192F; opacity: 0.04;
    z-index: 0; pointer-events: none; white-space: nowrap;
  }
  .sheet > *:not(.watermark) { position: relative; z-index: 1; }

  /* --- Antet --- */
  .letterhead {
    display: flex; align-items: center; gap: 14px;
    border-bottom: 3px solid #0a192f; padding-bottom: 12px; margin-bottom: 4px;
  }
  .logo {
    width: 58px; height: 58px; border-radius: 10px; flex-shrink: 0;
    background: linear-gradient(135deg, #E31E24 0%, #B8171C 100%);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 17px; letter-spacing: 1px;
  }
  .org { flex: 1; }
  .org-name { font-size: 15pt; font-weight: 800; color: #0a192f; letter-spacing: -0.2px; }
  .org-sub { font-size: 8.5pt; color: #5b6676; margin-top: 2px; }
  .doc-stamp { text-align: right; font-size: 8.5pt; color: #5b6676; }
  .doc-stamp strong { display: block; font-size: 11pt; color: #0a192f; }

  /* Kırmızı ana ayraç + altın ince şerit: kurumsal antet imzası. */
  .crimson-rule { height: 3px; background: #E31E24; margin-bottom: 2px; }
  .gold-rule { height: 1px; background: #C5A059; margin-bottom: 18px; }

  .classification {
    display: inline-block; border: 1.5px solid #b91c1c; color: #b91c1c;
    font-size: 8.5pt; font-weight: 800; letter-spacing: 1px;
    padding: 2px 10px; text-transform: uppercase; margin-bottom: 14px;
  }

  h1.doc-title {
    font-size: 14pt; text-align: center; margin: 6px 0 18px;
    text-transform: uppercase; letter-spacing: 0.5px; color: #0a192f;
  }

  h2 {
    font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.6px;
    color: #0a192f; margin: 18px 0 8px; padding-bottom: 4px;
    border-bottom: 1px solid #c9d2df;
  }

  /* --- Taraflar --- */
  .parties { display: flex; gap: 14px; margin-bottom: 6px; }
  .party {
    flex: 1; border: 1px solid #c9d2df; border-radius: 4px; padding: 10px 12px;
    background: #f7f9fc;
  }
  .party-label {
    font-size: 8pt; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.6px; color: #E31E24; margin-bottom: 4px;
  }
  .party-name { font-weight: 700; font-size: 11pt; margin-bottom: 4px; }
  .party-line { font-size: 9pt; color: #374151; }

  /* --- Künye --- */
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.meta td { padding: 5px 8px; border-bottom: 1px solid #e3e8ef; font-size: 10pt; }
  table.meta td:first-child {
    width: 38%; color: #5b6676; font-weight: 600; background: #f7f9fc;
  }

  /* --- Veri tablosu --- */
  table.data { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
  table.data th {
    background: #0a192f; color: #fff; font-size: 9pt; font-weight: 700;
    padding: 7px 8px; text-align: left; text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  table.data td {
    padding: 6px 8px; border-bottom: 1px solid #e3e8ef; font-size: 9.5pt;
  }
  table.data tr:nth-child(even) td { background: #f7f9fc; }
  table.data td.num, table.data th.num { text-align: right; }

  p.para { margin: 0 0 8px; text-align: justify; }

  /* --- İmza --- */
  .signatures {
    display: flex; gap: 22px; margin-top: 34px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .signature { flex: 1; text-align: center; }
  .signature-box {
    height: 74px; border: 1px dashed #98a2b3; border-radius: 4px;
    margin-bottom: 6px; display: flex; align-items: flex-end;
    justify-content: center; padding-bottom: 5px;
    font-size: 7.5pt; color: #98a2b3;
  }
  .signature-label { font-size: 9pt; font-weight: 700; color: #0a192f; }
  .signature-name { font-size: 8.5pt; color: #5b6676; }

  footer.doc-footer {
    margin-top: 26px; padding-top: 8px; border-top: 1px solid #c9d2df;
    font-size: 7.5pt; color: #5b6676; display: flex;
    justify-content: space-between; gap: 12px;
  }

  @media print {
    .no-print { display: none !important; }
    h2 { page-break-after: avoid; }
    table.data { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
`;

function el(doc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Belgeyi yeni bir pencerede oluşturur ve yazdırma iletişim kutusunu açar.
 * Açılır pencere engellenirse `false` döner; çağıran kullanıcıyı uyarır.
 */
export function printCorporateDocument(input: PrintDocument): boolean {
  const win = window.open('', '_blank', 'width=980,height=760');
  if (!win) return false;

  const doc = win.document;
  doc.title = `${input.documentNumber} — ${input.title}`;

  const style = doc.createElement('style');
  style.textContent = STYLES;
  doc.head.appendChild(style);

  const sheet = el(doc, 'div', 'sheet');

  // --- Antet ---
  const letterhead = el(doc, 'div', 'letterhead');
  // Filigran ilk düğüm: arkada kalmalı.
  sheet.appendChild(el(doc, 'div', 'watermark', 'MKE A.Ş.'));

  letterhead.appendChild(el(doc, 'div', 'logo', 'MKE'));

  const org = el(doc, 'div', 'org');
  org.appendChild(el(doc, 'div', 'org-name', 'MKE A.Ş.'));
  org.appendChild(el(doc, 'div', 'org-sub',
    'Makina ve Kimya Endüstrisi Anonim Şirketi · Savunma Sanayii'));
  letterhead.appendChild(org);

  const stamp = el(doc, 'div', 'doc-stamp');
  stamp.appendChild(el(doc, 'strong', undefined, input.documentType));
  stamp.appendChild(el(doc, 'div', undefined, `Belge No: ${input.documentNumber}`));
  stamp.appendChild(el(doc, 'div', undefined,
    `Düzenleme: ${new Date().toLocaleDateString('tr-TR')}`));
  letterhead.appendChild(stamp);

  sheet.appendChild(letterhead);
  sheet.appendChild(el(doc, 'div', 'crimson-rule'));
  sheet.appendChild(el(doc, 'div', 'gold-rule'));

  if (input.classification) {
    sheet.appendChild(el(doc, 'div', 'classification', input.classification));
  }

  sheet.appendChild(el(doc, 'h1', 'doc-title', input.title));

  // --- Taraflar ---
  if (input.parties?.length) {
    sheet.appendChild(el(doc, 'h2', undefined, 'Taraflar'));
    const parties = el(doc, 'div', 'parties');
    for (const party of input.parties) {
      const box = el(doc, 'div', 'party');
      box.appendChild(el(doc, 'div', 'party-label', party.label));
      box.appendChild(el(doc, 'div', 'party-name', party.name));
      for (const line of party.lines) {
        box.appendChild(el(doc, 'div', 'party-line', line));
      }
      parties.appendChild(box);
    }
    sheet.appendChild(parties);
  }

  // --- Bölümler ---
  for (const section of input.sections) {
    sheet.appendChild(el(doc, 'h2', undefined, section.heading));

    if (section.rows?.length) {
      const table = el(doc, 'table', 'meta');
      const tbody = doc.createElement('tbody');
      for (const [key, value] of section.rows) {
        const tr = doc.createElement('tr');
        tr.appendChild(el(doc, 'td', undefined, key));
        tr.appendChild(el(doc, 'td', undefined, value));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      sheet.appendChild(table);
    }

    for (const paragraph of section.paragraphs ?? []) {
      sheet.appendChild(el(doc, 'p', 'para', paragraph));
    }

    if (section.table) {
      const table = el(doc, 'table', 'data');
      const thead = doc.createElement('thead');
      const headRow = doc.createElement('tr');
      section.table.headers.forEach((label, index) => {
        const th = el(doc, 'th', section.table?.align?.[index] === 'right' ? 'num' : undefined, label);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = doc.createElement('tbody');
      for (const row of section.table.rows) {
        const tr = doc.createElement('tr');
        row.forEach((value, index) => {
          tr.appendChild(
            el(doc, 'td', section.table?.align?.[index] === 'right' ? 'num' : undefined, value),
          );
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      sheet.appendChild(table);
    }
  }

  // --- İmza / kaşe ---
  if (input.signatures?.length) {
    const signatures = el(doc, 'div', 'signatures');
    for (const signature of input.signatures) {
      const box = el(doc, 'div', 'signature');
      box.appendChild(el(doc, 'div', 'signature-box', 'kaşe / imza'));
      box.appendChild(el(doc, 'div', 'signature-label', signature.label));
      if (signature.name) {
        box.appendChild(el(doc, 'div', 'signature-name', signature.name));
      }
      signatures.appendChild(box);
    }
    sheet.appendChild(signatures);
  }

  const footer = el(doc, 'footer', 'doc-footer');
  footer.appendChild(el(doc, 'span', undefined,
    input.footerNote ?? 'Bu belge MKE A.Ş. CRM sisteminden üretilmiştir.'));
  footer.appendChild(el(doc, 'span', undefined,
    `${input.documentNumber} · ${new Date().toLocaleString('tr-TR')}`));
  sheet.appendChild(footer);

  doc.body.appendChild(sheet);

  win.focus();
  // Yazdırma iletişim kutusu, tarayıcı düzeni tamamlasın diye bir kare
  // sonraya bırakılır; aksi halde Safari boş sayfa basabiliyor.
  win.setTimeout(() => win.print(), 120);
  return true;
}
