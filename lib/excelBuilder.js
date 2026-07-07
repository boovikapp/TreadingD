// lib/excelBuilder.js
const XLSX = require('xlsx');

/**
 * @param {Array} rows - from taxCalculator.calculateIlsReport().rows
 * @param {Object} totals - from taxCalculator.calculateIlsReport().totals
 * @param {string} taxYear
 * @returns {Buffer} xlsx file buffer
 */
function buildWorkbook(rows, totals, taxYear) {
  const wb = XLSX.utils.book_new();

  // ---------- Sheet 1: פירוט עסקאות ----------
  const detailHeader = [
    'Trade ID (ברוקר)',
    'טיקר',
    'סוג נכס',
    'כמות',
    'תאריך מכירה',
    'תאריך/י קנייה (Lots)',
    'תמורה $',
    'עלות (Basis) $',
    'עמלה $',
    'שער מכירה',
    'שער משוער (fallback)?',
    'תמורה ₪',
    'עלות ₪',
    'עמלה ₪',
    'רווח/הפסד ₪',
    'תאריך קנייה משוער?',
    'קוד IBKR',
  ];

  const detailData = rows.map((r) => [
    r.tradeId,
    r.symbol,
    r.assetCategory,
    r.quantity,
    r.sellDate,
    r.basisDates,
    r.proceedsUsd,
    r.basisUsd,
    r.commissionUsd,
    r.sellRate,
    r.sellRateFallback ? 'כן' : '',
    r.proceedsIls,
    r.basisIls,
    r.commissionIls,
    r.pnlIls,
    r.estimatedBasisDate ? 'כן - לבדוק ידנית' : '',
    r.code,
  ]);

  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]);
  detailSheet['!cols'] = detailHeader.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  detailSheet['!views'] = [{ rightToLeft: true, RTL: true }];
  XLSX.utils.book_append_sheet(wb, detailSheet, 'פירוט עסקאות');

  // ---------- Sheet 2: ריכוז להקלדה ----------
  const summaryHeader = ['שדה', 'סכום ₪', 'הערה'];
  const summaryData = [
    ['שנת מס', taxYear, ''],
    ['מספר עסקאות סגורות', totals.tradeCount, ''],
    ['סך מחזור מכירות (תמורה)', totals.totalProceedsIls, 'קוד 150 (מחזור)'],
    ['סך עלות קניות (Basis)', totals.totalBasisIls, 'מוצג כמספר שלילי, כמוסכם ב-IBKR'],
    ['סך עמלות', totals.totalCommissionIls, 'מוצג כמספר שלילי'],
    ['רווח/הפסד נקי סופי', totals.totalPnlIls, 'לקוד 150/166 - רווח עסקי ממסחר בניירות ערך'],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryData]);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 45 }];
  summarySheet['!views'] = [{ rightToLeft: true, RTL: true }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ריכוז להקלדה');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

module.exports = { buildWorkbook };
