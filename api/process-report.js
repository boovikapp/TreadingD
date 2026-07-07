// api/process-report.js
//
// POST { csvContent: string, taxYear?: string }
// -> returns an .xlsx file (binary) ready for download.

const { extractClosedDeals } = require('../lib/csvParser');
const { calculateIlsReport } = require('../lib/taxCalculator');
const { buildWorkbook } = require('../lib/excelBuilder');

// Allow bigger uploads than Vercel's 4mb default JSON body limit - annual
// activity statements with many trades can be a few MB of CSV text.
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

module.exports = async function handler(req, res) {
  // Basic CORS so you can also call this from a different host if needed.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { csvContent, taxYear } = req.body || {};

    if (!csvContent || typeof csvContent !== 'string') {
      res.status(400).json({ error: 'חסר csvContent בגוף הבקשה.' });
      return;
    }

    // 1. Parse the cTrader statement (Deals / Transactions / Summary blocks)
    const { deals, reportedTotalNetUsd } = extractClosedDeals(csvContent);
    if (deals.length === 0) {
      res.status(400).json({
        error: 'לא נמצאו עסקאות סגורות בסקציית "Deals". ודא שזה קובץ Statement CSV תקין מ-cTrader (Pepperstone).',
      });
      return;
    }

    // 2. Convert to ILS using BOI representative rates (with fallback + caching)
    const { rows, totals } = await calculateIlsReport(deals);

    // 3. Build the two-tab Excel file
    const resolvedYear = taxYear || (rows[0]?.closeDate || '').slice(0, 4) || 'unknown';
    const workbookBuffer = buildWorkbook(rows, totals, resolvedYear, reportedTotalNetUsd);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Pepperstone_Tax_Report_${resolvedYear}.xlsx"`
    );
    res.status(200).send(workbookBuffer);
  } catch (err) {
    console.error('process-report error:', err);
    res.status(500).json({ error: err.message || 'שגיאה לא צפויה בעיבוד הקובץ.' });
  }
};
