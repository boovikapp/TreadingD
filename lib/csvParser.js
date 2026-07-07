// lib/csvParser.js
//
// IBKR "Activity Statement" CSV files are NOT a single table - they are many
// mini-sections concatenated in one file, each with its own header row:
//
//   Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Code
//   Trades,Data,Order,Stocks,USD,AAPL,"2024-03-20, 10:15:00",-100,160,16000,-1,-15001,999,C
//   Trades,Data,ClosedLot,Stocks,USD,AAPL,"2024-01-05, 09:30:00",100,150,,,15001,,
//   ...
//   Trades,SubTotal,...
//
// column[0] = section name, column[1] = row type ("Header" / "Data" / "SubTotal" / "Total"),
// and from column[2] onward the fields match whatever the Header row for that
// section declared. This parser walks the file once, keeps a running "current
// header" per section, and turns every Data row into a named object.

const { parse } = require('csv-parse/sync');

/**
 * Parses the raw IBKR CSV text into a map of sections.
 * @param {string} csvText
 * @returns {{ [sectionName: string]: Array<Object> }} dataRowsBySection
 */
function parseIbkrSections(csvText) {
  // csv-parse handles quoted fields (e.g. "2024-03-20, 10:15:00") correctly,
  // which a naive line.split(',') would break.
  const records = parse(csvText, {
    columns: false,
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
  });

  const sections = {}; // sectionName -> { header: string[], rows: object[] }

  for (const row of records) {
    if (!row || row.length < 2) continue;
    const sectionName = (row[0] || '').trim();
    const rowType = (row[1] || '').trim();
    if (!sectionName) continue;

    if (!sections[sectionName]) {
      sections[sectionName] = { header: null, rows: [] };
    }
    const section = sections[sectionName];

    if (rowType === 'Header') {
      // columns from index 2 onward are the field names for this section
      section.header = row.slice(2).map((h) => (h || '').trim());
      continue;
    }

    if (rowType === 'Data' && section.header) {
      const values = row.slice(2);
      const obj = { __rowType: rowType };
      section.header.forEach((colName, idx) => {
        obj[colName] = values[idx] !== undefined ? values[idx].trim() : '';
      });
      section.rows.push(obj);
    }
    // 'SubTotal' / 'Total' rows are ignored - they're spreadsheet-style
    // aggregates from IBKR itself, not individual trades.
  }

  const dataRowsBySection = {};
  Object.keys(sections).forEach((name) => {
    dataRowsBySection[name] = sections[name].rows;
  });
  return dataRowsBySection;
}

/**
 * Extracts just the date portion (YYYY-MM-DD) from an IBKR "Date/Time" field,
 * which can look like "2024-03-20, 10:15:00" or just "2024-03-20".
 */
function extractDateOnly(dateTimeStr) {
  if (!dateTimeStr) return null;
  const match = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

/**
 * Builds a normalized list of "closing trades" from the Trades section.
 *
 * Each closing trade = one 'Order' row whose Quantity represents a sale
 * (i.e. it has a Realized P/L / Basis, meaning it closed a position).
 * If the statement was generated with "Closed Lot" detail turned on, the
 * 'ClosedLot' rows immediately following an Order give the TRUE original
 * purchase date(s) for that sale (a sale can close several lots bought on
 * different days). If no ClosedLot rows are present for an order, we fall
 * back to using the order's own date for the basis too, and flag the row
 * so you know to double check it manually.
 */
function extractClosingTrades(sections) {
  const tradeRows = sections['Trades'] || [];
  const closingTrades = [];

  let pendingOrder = null;

  const flushPendingOrder = () => {
    if (pendingOrder) {
      closingTrades.push(pendingOrder);
      pendingOrder = null;
    }
  };

  for (const row of tradeRows) {
    const discriminator = row.DataDiscriminator;

    if (discriminator === 'Order' || discriminator === 'Trade') {
      // Push the previous order (it had no ClosedLot children, or we've
      // moved on) before starting a new one.
      flushPendingOrder();

      const basisUsd = parseFloat(row['Basis'] || '0') || 0;
      const realizedPnl = parseFloat(row['Realized P/L'] || '0') || 0;
      const quantity = parseFloat(row['Quantity'] || '0') || 0;
      const code = row['Code'] || '';

      // IMPORTANT: IBKR sets a non-zero "Basis" on EVERY trade row,
      // including pure opening trades (basis = their own cost) - so basis
      // alone can't distinguish an opening buy from a closing sell. The
      // reliable signal is the "Code" column: it contains the letter "C"
      // for any row that closed (all or part of) a position. We only want
      // closing rows here - opening trades still open at year end have no
      // realized gain/loss and aren't reportable yet.
      const looksLikeClosingTrade = code.includes('C') || (realizedPnl !== 0 && !code.includes('O'));
      if (!looksLikeClosingTrade) continue;

      pendingOrder = {
        tradeId: row['Trade ID'] || row['TradeID'] || row['TransactionID'] || '',
        symbol: row['Symbol'] || '',
        assetCategory: row['Asset Category'] || '',
        currency: row['Currency'] || 'USD',
        quantity,
        sellDate: extractDateOnly(row['Date/Time']),
        proceedsUsd: parseFloat(row['Proceeds'] || '0') || 0,
        commissionUsd: parseFloat(row['Comm/Fee'] || '0') || 0,
        basisUsd,
        realizedPnlUsd: realizedPnl,
        code: row['Code'] || '',
        lots: [], // filled in from ClosedLot rows if present
      };
    } else if (discriminator === 'ClosedLot' && pendingOrder) {
      const lotBasisUsd = parseFloat(row['Basis'] || '0') || 0;
      pendingOrder.lots.push({
        openDate: extractDateOnly(row['Date/Time']),
        quantity: parseFloat(row['Quantity'] || '0') || 0,
        basisUsd: lotBasisUsd,
      });
    }
    // ignore SubTotal/Total rows if they somehow ended up as Data rows
  }
  flushPendingOrder();

  return closingTrades;
}

module.exports = { parseIbkrSections, extractClosingTrades, extractDateOnly };
