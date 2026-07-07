// lib/excelBuilder.js
const XLSX = require('xlsx');

/**
 * @param {Array} rows - from taxCalculator.calculateIlsReport().rows
 * @param {Object} totals - from taxCalculator.calculateIlsReport().totals
 * @param {string} taxYear
 * @param {number|null} reportedTotalNetUsd - broker's own footer total, for reconciliation
 * @returns {Buffer} xlsx file buffer
 */
function buildWorkbook(rows, totals, taxYear, reportedTotalNetUsd) {
  const wb = XLSX.utils.book_new();

  // ---------- Sheet 1: פירוט עסקאות ----------
  const detailHeader = [
    'סימבול',
    'כיוון פתיחה',
    'כמות (לוטים)',
    'תאריך סגירה',
    'מחיר כניסה',
    'מחיר סגירה',
    'רווח/הפסד נטו $',
    'שער יציג',
    'שער משוער (fallback)?',
    'רווח/הפסד ₪',
  ];

  const detailData = rows.map((r) => [
    r.symbol,
    r.direction,
    r.quantityLots,
    r.closeDate,
    r.entryPrice,
    r.closingPrice,
    r.netUsd,
    r.rate,
    r.rateFallback ? 'כן' : '',
    r.pnlIls,
  ]);

  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]);
  detailSheet['!cols'] = detailHeader.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  detailSheet['!views'] = [{ rightToLeft: true, RTL: true }];
  XLSX.utils.book_append_sheet(wb, detailSheet, 'פירוט עסקאות');

  // ---------- Sheet 2: ריכוז להקלדה ----------
  const reconciliationOk =
    reportedTotalNetUsd === null || Math.abs(reportedTotalNetUsd - totals.totalNetUsd) < 0.5;

  const summaryHeader = ['שדה', 'ערך', 'הערה'];
  const summaryData = [
    ['שנת מס', taxYear, ''],
    ['מספר עסקאות סגורות', totals.dealCount, ''],
    ['סך רווח/הפסד נטו $', totals.totalNetUsd, ''],
    ['רווח/הפסד נטו סופי ₪', totals.totalPnlIls, 'להעברה לדוח רווח הון / הכנסה ממסחר (בהתאם לייעוץ מס)'],
    [
      'בדיקת התאמה מול סה"כ הברוקר',
      reportedTotalNetUsd === null ? 'לא נמצא בקובץ' : reportedTotalNetUsd,
      reconciliationOk ? 'תואם ✓' : 'אינו תואם - יש לבדוק ידנית!',
    ],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryData]);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 50 }];
  summarySheet['!views'] = [{ rightToLeft: true, RTL: true }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ריכוז להקלדה');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

module.exports = { buildWorkbook };
