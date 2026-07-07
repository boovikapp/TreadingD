// lib/boiRates.js
//
// Fetches USD/ILS representative ("yatzig") exchange rates from Bank of
// Israel's SDMX "new series database" API and builds a Date -> Rate lookup
// with weekend/holiday fallback (uses the most recent PRIOR business day's
// rate, as required for tax reporting).
//
// As of 2023 BOI serves this from edge.boi.gov.il/FusionEdgeServer (SDMX
// 2.1), NOT the older BoiVolcanoWebSvc path (which now 404s). The series
// code for the USD representative rate is RER_USD_ILS, filtered to
// DATA_TYPE=OF00 (representative rate, as opposed to buy/sell rates).
// CSV is used over sdmx-json because its column layout is documented and
// stable: SERIES_CODE, FREQ, BASE_CURRENCY, COUNTER_CURRENCY, UNIT_MEASURE,
// DATA_TYPE, DATA_SOURCE, TIME_PERIOD, OBS_VALUE, RELEASE_STATUS.

const { parse } = require('csv-parse/sync');

const BOI_BASE_URL =
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS';

/**
 * Fetches raw USD rate observations from BOI for the given date range.
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @returns {Promise<Map<string, number>>} date (YYYY-MM-DD) -> rate
 */
async function fetchBoiUsdRates(startDate, endDate) {
  const params = new URLSearchParams({
    'c[DATA_TYPE]': 'OF00',
    startperiod: startDate,
    endperiod: endDate,
    format: 'csv',
  });
  const url = `${BOI_BASE_URL}?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: 'text/csv' },
  });

  if (!res.ok) {
    throw new Error(`BOI API request failed: ${res.status} ${res.statusText}`);
  }

  const csvText = await res.text();
  return parseBoiCsv(csvText);
}

/**
 * Parses the BOI SDMX CSV response into a Map<'YYYY-MM-DD', number>.
 * Logs the raw payload once on failure so it's easy to adjust this
 * function if BOI changes their column layout.
 */
function parseBoiCsv(csvText) {
  const map = new Map();

  let records;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    console.error('Failed to parse BOI CSV response. Raw payload:', csvText.slice(0, 2000));
    throw new Error('לא ניתן היה לפרש את תגובת ה-API של בנק ישראל (CSV לא תקין).');
  }

  for (const rec of records) {
    const rawDate = rec['TIME_PERIOD'] || rec['time_period'];
    const rawValue = rec['OBS_VALUE'] ?? rec['obs_value'];

    if (!rawDate || rawValue === undefined || rawValue === '') continue;

    const dateOnly = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
    const numericValue = parseFloat(rawValue);
    if (dateOnly && !Number.isNaN(numericValue)) {
      map.set(dateOnly[0], numericValue);
    }
  }

  if (map.size === 0) {
    console.error('BOI CSV parsed but produced zero rates. Raw payload:', csvText.slice(0, 2000));
    throw new Error('בנק ישראל החזיר תשובה ריקה של שערים לטווח התאריכים המבוקש.');
  }

  return map;
}

/**
 * Builds a rate-lookup helper for a whole set of needed dates in ONE network
 * call (the caching layer requested): fetches [minDate - 10 days, maxDate]
 * so weekend/holiday fallback always has somewhere to fall back to, then
 * returns a function that finds the exact rate or walks backwards day by
 * day (max 10 tries) to find the last business day with a published rate.
 *
 * @param {string[]} neededDates array of 'YYYY-MM-DD' strings
 */
async function buildRateResolver(neededDates) {
  const sorted = [...new Set(neededDates)].filter(Boolean).sort();
  if (sorted.length === 0) {
    return { getRate: () => { throw new Error('אין תאריכים לשליפת שער'); } };
  }

  const minDate = addDays(sorted[0], -10); // buffer for weekend/holiday fallback
  const maxDate = sorted[sorted.length - 1];

  const rateMap = await fetchBoiUsdRates(minDate, maxDate);

  /** @type {Map<string, {rate: number, usedFallback: boolean, actualDate: string}>} */
  const resolvedCache = new Map();

  function getRate(targetDate) {
    if (resolvedCache.has(targetDate)) return resolvedCache.get(targetDate);

    let cursor = targetDate;
    for (let i = 0; i <= 10; i++) {
      if (rateMap.has(cursor)) {
        const result = {
          rate: rateMap.get(cursor),
          usedFallback: cursor !== targetDate,
          actualDate: cursor,
        };
        resolvedCache.set(targetDate, result);
        return result;
      }
      cursor = addDays(cursor, -1);
    }

    throw new Error(
      `לא נמצא שער דולר יציג עבור ${targetDate} או ב-10 הימים שקדמו לו.`
    );
  }

  return { getRate };
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { buildRateResolver, fetchBoiUsdRates };
