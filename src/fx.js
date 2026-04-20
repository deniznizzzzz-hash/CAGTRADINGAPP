const https = require('https');

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

// Returns { base:'EUR', rates:{ TRY:X, GBP:Y, USD:Z }, date:'YYYY-MM-DD', source:'...' }
async function fetchRates() {
  const targets = ['TRY', 'GBP', 'USD'];
  // Primary: frankfurter.app (ECB, free, no key)
  try {
    const d = await httpsGetJson(
      `https://api.frankfurter.app/latest?from=EUR&to=${targets.join(',')}`
    );
    if (d && d.rates) {
      return {
        base: 'EUR',
        rates: d.rates,
        date: d.date,
        source: 'frankfurter.app (ECB)'
      };
    }
  } catch (_) { /* fallthrough */ }

  // Fallback: open.er-api.com
  try {
    const d = await httpsGetJson('https://open.er-api.com/v6/latest/EUR');
    if (d && d.result === 'success' && d.rates) {
      const rates = {};
      for (const t of targets) if (d.rates[t] != null) rates[t] = d.rates[t];
      return {
        base: 'EUR',
        rates,
        date: (d.time_last_update_utc || '').slice(0, 16),
        source: 'open.er-api.com'
      };
    }
  } catch (_) { /* fallthrough */ }

  throw new Error('Unable to fetch exchange rates (no internet?)');
}

// Convert an amount in `currency` into EUR using a rates object
// where rates[X] means "1 EUR = X of currency X".
function convertToEUR(amount, currency, ratesObj) {
  if (!currency || currency === 'EUR') return amount;
  const r = ratesObj.rates[currency];
  if (!r || !isFinite(r)) throw new Error(`Missing FX rate for ${currency}`);
  return amount / r;
}

module.exports = { fetchRates, convertToEUR };
