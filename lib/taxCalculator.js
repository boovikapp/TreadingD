// lib/taxCalculator.js
//
// Turns closing trades (USD, with per-lot open dates when available) into
// ILS rows ready for the "פירוט עסקאות" sheet, plus totals for "ריכוז להקלדה".

const { buildRateResolver } = require('./boiRates');

/**
 * @param {Array} closingTrades - from csvParser.extractClosingTrades
 * @returns {Promise<{ rows: Array, totals: Object }>}
 */
async function calculateIlsReport(closingTrades) {
  // Collect every date we'll need a rate for: each sell date, plus every
  // lot's open date (or the sell date itself as fallback when no lots).
  const neededDates = new Set();
  for (const t of closingTrades) {
    if (t.sellDate) neededDates.add(t.sellDate);
    if (t.lots.length > 0) {
      t.lots.forEach((lot) => lot.openDate && neededDates.add(lot.openDate));
    }
  }

  const { getRate } = await buildRateResolver([...neededDates]);

  const rows = [];
  let totalProceedsIls = 0;
  let totalBasisIls = 0; // stored as negative (cost), matching IBKR convention
  let totalCommissionIls = 0; // stored as negative (cost)
  let totalPnlIls = 0;

  for (const t of closingTrades) {
    if (!t.sellDate) continue; // can't convert without a date

    const sellRateInfo = getRate(t.sellDate);
    const proceedsIls = t.proceedsUsd * sellRateInfo.rate;
    const commissionIls = t.commissionUsd * sellRateInfo.rate;

    let basisIls;
    let basisDateNote;
    let estimatedBasisDate = false;

    if (t.lots.length > 0) {
      // Accurate path: convert each lot's basis using ITS OWN purchase date.
      basisIls = 0;
      const lotDates = [];
      for (const lot of t.lots) {
        const lotDate = lot.openDate || t.sellDate;
        const lotRateInfo = getRate(lotDate);
        basisIls += lot.basisUsd * lotRateInfo.rate;
        lotDates.push(lot.openDate || '?');
      }
      basisDateNote = lotDates.join(' | ');
    } else {
      // Fallback: no ClosedLot detail in the statement, so we don't know
      // the true purchase date. We use the sell date's rate for the basis
      // too, and flag the row for manual review.
      basisIls = t.basisUsd * sellRateInfo.rate;
      basisDateNote = `${t.sellDate} (משוער - אין פירוט Lots בדוח)`;
      estimatedBasisDate = true;
    }

    const pnlIls = proceedsIls + basisIls + commissionIls;

    totalProceedsIls += proceedsIls;
    totalBasisIls += basisIls;
    totalCommissionIls += commissionIls;
    totalPnlIls += pnlIls;

    rows.push({
      tradeId: t.tradeId,
      symbol: t.symbol,
      assetCategory: t.assetCategory,
      quantity: t.quantity,
      sellDate: t.sellDate,
      basisDates: basisDateNote,
      proceedsUsd: round2(t.proceedsUsd),
      basisUsd: round2(t.basisUsd),
      commissionUsd: round2(t.commissionUsd),
      sellRate: sellRateInfo.rate,
      sellRateFallback: sellRateInfo.usedFallback,
      proceedsIls: round2(proceedsIls),
      basisIls: round2(basisIls),
      commissionIls: round2(commissionIls),
      pnlIls: round2(pnlIls),
      estimatedBasisDate,
      code: t.code,
    });
  }

  const totals = {
    totalProceedsIls: round2(totalProceedsIls),
    totalBasisIls: round2(totalBasisIls),
    totalCommissionIls: round2(totalCommissionIls),
    totalPnlIls: round2(totalPnlIls),
    tradeCount: rows.length,
  };

  return { rows, totals };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { calculateIlsReport };
