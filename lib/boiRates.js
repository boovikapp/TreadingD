// lib/boiRates.js
//
// Fetches USD/ILS representative ("yatzig") exchange rates from Bank of
// Israel's public series API and builds a Date -> Rate lookup with
// weekend/holiday fallback (uses the most recent PRIOR business day's rate,
// as required for tax reporting).
//
// IMPORTANT: The exact JSON shape returned by edge.boi.gov.il is not fully
// documented publicly. This module fetches the ENTIRE date range needed in
// a single request (not one request per trade - that's the caching
// strategy) and then tries several common response shapes to find the
// (date, value) pairs. If BOI changes their schema, only parseBoiResponse()
// below needs to change - everything else (fallback logic, ILS conversion)
// stays the same. Test once against a real deployment and check the
// Vercel function logs; the raw payload is logged on first fetch.

const BOI_BASE_URL =
  'https://edge.boi.gov.il/BoiVolcanoWebSvc/api/v1/data/series/exchangerates/01';

/**
 * Fetches raw USD rate observations from BOI for the given date range.
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @returns {Promise<Map<string, number>>} date (YYYY-MM-DD) -> rate
 */
async function fetchBoiUsdRates(startDate, endDate) {
  const url = `${BOI_BASE_URL}?startdate=${startDate}&enddate=${endDate}&format=json`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`BOI API request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return parseBoiResponse(json);
}

/**
 * Tries several known/likely BOI response shapes and normalizes them into
 * a Map<'YYYY-MM-DD', number>. Logs the raw shape once so it's easy to
 * adjust this function against your real deployment if BOI's schema
 * differs from what's implemented here.
 */
function parseBoiResponse(json) {
  const map = new Map();

  // Candidate arrays where the observations might live.
  const candidateArrays = [
    json?.data,
    json?.Data,
    json?.observations,
    json?.Observations,
    json?.series,
    json?.result,
    Array.isArray(json) ? json : null,
  ].filter(Boolean);

  const observations = candidateArrays.length > 0 ? candidateArrays[0] : null;

  if (!observations || !Array.isArray(observations)) {
    console.error(
      'BOI response did not match any known shape. Raw payload:',
      JSON.stringify(json).slice(0, 2000)
    );
    throw new Error(
      'לא ניתן היה לפרש את תגובת ה-API של בנק ישראל. בדוק את ה-logs בוורסל ועדכן את parseBoiResponse.'
    );
  }

  for (const item of observations) {
    const rawDate =
      item?.date || item?.Date || item?.TradeDate || item?.observation_date || item?.period;
    const rawValue =
      item?.value ??
      item?.Value ??
      item?.currentValue ??
      item?.CurrentExchangeRate ??
      item?.rate ??
      item?.Rate;

    if (!rawDate || rawValue === undefined || rawValue === null) continue;

    const dateOnly = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
    const numericValue = parseFloat(rawValue);
    if (dateOnly && !Number.isNaN(numericValue)) {
      map.set(dateOnly[0], numericValue);
    }
  }

  if (map.size === 0) {
    console.error('BOI response parsed but produced zero rates. Raw payload:', JSON.stringify(json).slice(0, 2000));
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
