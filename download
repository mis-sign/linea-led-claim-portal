// warrantyMatch.js
// Matches a complaint's Warranty ID against the warranty database and works
// out whether it's currently "In Warranty" or "Out of Warranty".
//
// The warranty CSV export doesn't use one consistent date format across all
// rows (some are MM/DD/YYYY, some are DD-MM-YYYY), so parseFlexibleDate()
// makes a best-effort guess. If a date genuinely can't be parsed, we treat
// the match as "Unknown" rather than silently guessing wrong.

function parseFlexibleDate(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (!s || s === "-") return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return safeDate(m[1], m[2], m[3]);

  // Separator is either / or -
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    let [, a, b, year] = m;
    a = Number(a);
    b = Number(b);
    // If the first number can't be a month (>12), it must be a day -> DD-MM-YYYY
    if (a > 12 && b <= 12) return safeDate(year, b, a);
    // Otherwise assume the CSV's dominant format: MM/DD/YYYY (or MM-DD-YYYY)
    return safeDate(year, a, b);
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function safeDate(year, month, day) {
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * @param {object} db - the full database object (from readDb())
 * @param {string} warrantyId - the ID entered on the complaint form
 * @returns {{status: string, record: object|null}}
 *   status is one of: "In Warranty", "Out of Warranty", "Unknown Dates", "Not Found"
 */
function matchWarranty(db, warrantyId) {
  if (!warrantyId || !warrantyId.trim()) {
    return { status: "Not Found", record: null };
  }
  const id = warrantyId.trim().toLowerCase();
  const record = db.warranties.find((w) => (w.warrantyId || "").trim().toLowerCase() === id);

  if (!record) return { status: "Not Found", record: null };

  const start = parseFlexibleDate(record.warrantyStartDate);
  const end = parseFlexibleDate(record.warrantyEndDate);
  if (!start || !end) return { status: "Unknown Dates", record };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (today >= start && today <= end) {
    return { status: "In Warranty", record };
  }
  return { status: "Out of Warranty", record };
}

module.exports = { matchWarranty, parseFlexibleDate };
