// lib/csvParser.js
//
// cTrader (used by Pepperstone and other brokers) exports its "Statement"
// CSV as several blocks separated by blank lines, each starting with a
// title line ("Deals", "Transactions", "Summary", "Balance"), e.g.:
//
//   Deals
//   Symbol,Opening Direction,Closing Time (UTC+3),Entry price,Closing price,Closing Quantity,Net USD,Balance USD
//   NAS100,Buy,03 Jun 2026 14:34:12.258,30717.3,30757.8,5 Lots,202.50,1 536.11
//   ...
//   ,,,,,,-46 942.81,        <- footer/subtotal row (empty Symbol)
//
//   Transactions
//   ID,Time (UTC+3),Transaction type,Payment type,Gross USD,Note
//   ...
//
// Unlike IBKR, each row in "Deals" is already a CLOSED position with its
// net realized P&L in USD precomputed by the broker (includes commission/
// swap) - there's no FIFO lot-matching to do. We only need to pull out the
// closing date and Net USD per row, then convert to ILS.

const { parse } = require('csv-parse/sync');

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Splits the raw statement text into named blocks (title line -> rest of block).
 * @param {string} csvText
 * @returns {{ [title: string]: string }} title -> block body (without title line)
 */
function splitIntoSections(csvText) {
  const normalized = csvText.replace(/\r\n/g, '\n').replace(/﻿/g, '');
  const blocks = normalized.split(/\n\s*\n/);
  const sections = {};
  for (const block of blocks) {
    const lines = block.split('\n');
    const title = (lines[0] || '').trim();
    if (!title) continue;
    sections[title] = lines.slice(1).join('\n');
  }
  return sections;
}

/**
 * Numbers in cTrader statements use a space as thousands separator
 * (e.g. "1 536.11", "-46 942.81") - strip whitespace before parsing.
 */
function parseNumber(str) {
  if (str === undefined || str === null) return 0;
  const cleaned = String(str).replace(/[\s ]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

/** "5 Lots" -> 5, "0.4 Lots" -> 0.4 */
function parseLots(str) {
  const match = String(str || '').match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * "03 Jun 2026 14:34:12.258" -> "2026-06-03"
 * The statement's own timezone label (e.g. "UTC+3") is kept as-is - we only
 * need the calendar date it falls on for the BOI representative-rate lookup.
 */
function parseClosingDate(str) {
  const m = String(str || '').match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return null;
  const [, day, mon, year] = m;
  const month = MONTHS[mon];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

/**
 * Extracts closed deals from the "Deals" section.
 * @param {string} csvText
 * @returns {{ deals: Array<Object>, reportedTotalNetUsd: number|null }}
 */
function extractClosedDeals(csvText) {
  const sections = splitIntoSections(csvText);
  const dealsBlock = sections['Deals'];
  if (!dealsBlock) {
    return { deals: [], reportedTotalNetUsd: null };
  }

  const records = parse(dealsBlock, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const deals = [];
  let reportedTotalNetUsd = null;

  for (const rec of records) {
    const symbol = (rec['Symbol'] || '').trim();

    if (!symbol) {
      // Footer/subtotal row: empty Symbol, Net USD holds the broker's own total.
      if (rec['Net USD'] !== undefined && rec['Net USD'] !== '') {
        reportedTotalNetUsd = parseNumber(rec['Net USD']);
      }
      continue;
    }

    const closeDate = parseClosingDate(rec['Closing Time (UTC+3)']);
    if (!closeDate) continue;

    deals.push({
      symbol,
      direction: (rec['Opening Direction'] || '').trim(),
      closeDate,
      closeDateTimeRaw: (rec['Closing Time (UTC+3)'] || '').trim(),
      entryPrice: parseNumber(rec['Entry price']),
      closingPrice: parseNumber(rec['Closing price']),
      quantityLots: parseLots(rec['Closing Quantity']),
      netUsd: parseNumber(rec['Net USD']),
    });
  }

  return { deals, reportedTotalNetUsd };
}

module.exports = { splitIntoSections, extractClosedDeals, parseClosingDate, parseNumber, parseLots };
