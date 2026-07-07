// lib/taxCalculator.js
//
// Converts closed cTrader deals (USD, with a Net P&L already computed by
// the broker per deal) into ILS rows for the "פירוט עסקאות" sheet, plus
// totals for "ריכוז להקלדה". Unlike stock trading, CFD/forex deals have no
// separate cost-basis to convert - each deal's "Net USD" IS the realized
// gain/loss, so we only need one FX rate per deal (its closing date).

const { buildRateResolver } = require('./boiRates');

/**
 * @param {Array} deals - from csvParser.extractClosedDeals().deals
 * @returns {Promise<{ rows: Array, totals: Object }>}
 */
async function calculateIlsReport(deals) {
  const neededDates = new Set();
  for (const d of deals) {
    if (d.closeDate) neededDates.add(d.closeDate);
  }

  const { getRate } = await buildRateResolver([...neededDates]);

  const rows = [];
  let totalNetUsd = 0;
  let totalPnlIls = 0;

  for (const d of deals) {
    if (!d.closeDate) continue;

    const rateInfo = getRate(d.closeDate);
    const pnlIls = d.netUsd * rateInfo.rate;

    totalNetUsd += d.netUsd;
    totalPnlIls += pnlIls;

    rows.push({
      symbol: d.symbol,
      direction: d.direction,
      closeDate: d.closeDate,
      quantityLots: d.quantityLots,
      entryPrice: d.entryPrice,
      closingPrice: d.closingPrice,
      netUsd: round2(d.netUsd),
      rate: rateInfo.rate,
      rateFallback: rateInfo.usedFallback,
      pnlIls: round2(pnlIls),
    });
  }

  const totals = {
    dealCount: rows.length,
    totalNetUsd: round2(totalNetUsd),
    totalPnlIls: round2(totalPnlIls),
  };

  return { rows, totals };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { calculateIlsReport };
