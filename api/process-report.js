// api/process-report.js
//
// POST { csvContent: string, taxYear?: string }
// -> returns an .xlsx file (binary) ready for download.

const { parseIbkrSections, extractClosingTrades } = require('../lib/csvParser');
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

    // 1. Parse the multi-section IBKR CSV
    const sections = parseIbkrSections(csvContent);
    if (!sections['Trades']) {
      res.status(400).json({
        error: 'לא נמצאה סקציית "Trades" בקובץ. ודא שזה קובץ Activity Statement CSV תקין מ-IBKR.',
      });
      return;
    }

    // 2. Extract only closed positions (realized trades)
    const closingTrades = extractClosingTrades(sections);
    if (closingTrades.length === 0) {
      res.status(400).json({
        error: 'לא נמצאו עסקאות סגורות (עם רווח/הפסד ממומש) בקובץ שהועלה.',
      });
      return;
    }

    // 3. Convert to ILS using BOI representative rates (with fallback + caching)
    const { rows, totals } = await calculateIlsReport(closingTrades);

    // 4. Build the two-tab Excel file
    const resolvedYear = taxYear || (rows[0]?.sellDate || '').slice(0, 4) || 'unknown';
    const workbookBuffer = buildWorkbook(rows, totals, resolvedYear);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="IBKR_Tax_Report_${resolvedYear}.xlsx"`
    );
    res.status(200).send(workbookBuffer);
  } catch (err) {
    console.error('process-report error:', err);
    res.status(500).json({ error: err.message || 'שגיאה לא צפויה בעיבוד הקובץ.' });
  }
};
