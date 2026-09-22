const router = require('express').Router();
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Tylko pliki graficzne'));
  }
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const COUNTRY_CURRENCY = {
  PL: 'PLN', DE: 'EUR', NL: 'EUR', BE: 'EUR', FR: 'EUR', GB: 'GBP'
};

const { pool } = require('../db/init');
const VAT_RATES = { PL: 0.23, DE: 0.19, NL: 0.21, BE: 0.21, FR: 0.20, GB: 0.20 };

// Odswieza cene BRUTTO detaliczna kraju i zapisuje w bazie (swiadome pobranie nadpisuje tez reczna korekte)
async function refreshCountryPrice(country) {
  const currency = COUNTRY_CURRENCY[country] || 'EUR';
  const info = await getDieselPrice(country); // detal = brutto
  if (!info || !info.price) return null;
  await pool.query(
    `INSERT INTO fuel_prices (country, price_gross, currency, source, manual, fetched_at)
     VALUES ($1,$2,$3,$4,false,NOW())
     ON CONFLICT (country) DO UPDATE SET price_gross=EXCLUDED.price_gross, currency=EXCLUDED.currency, source=EXCLUDED.source, manual=false, fetched_at=NOW()`,
    [country, info.price, currency, info.source]
  );
  return info;
}

// Zwraca cene BRUTTO z bazy; lazy-odswieza raz dziennie. Reczna korekta nie jest nadpisywana automatycznie.
async function getStoredPrice(country) {
  const q = await pool.query('SELECT * FROM fuel_prices WHERE country=$1', [country]);
  let row = q.rows[0];
  const stale = !row || (Date.now() - new Date(row.fetched_at).getTime()) > 20 * 3600 * 1000;
  if (stale && (!row || !row.manual)) {
    try {
      const info = await refreshCountryPrice(country);
      if (info) { const q2 = await pool.query('SELECT * FROM fuel_prices WHERE country=$1', [country]); row = q2.rows[0]; }
    } catch (e) { console.error('getStoredPrice refresh', country, e.message); }
  }
  if (!row) return null;
  const fresh = (Date.now() - new Date(row.fetched_at).getTime()) <= 20 * 3600 * 1000;
  return { price: parseFloat(row.price_gross), currency: row.currency, source: (row.manual ? 'reczna korekta' : row.source) + (fresh ? '' : ' (nieodswiezone)'), fetched_at: row.fetched_at, manual: row.manual };
}

async function getRate(currency) {
  if (currency === 'PLN') return { rate: 1.0, date: null };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/?format=json`);
    if (!res.ok) throw new Error('NBP error');
    const data = await res.json();
    return { rate: parseFloat(data.rates[0].mid), date: data.rates[0].effectiveDate };
  } catch {
    return { rate: currency === 'EUR' ? 4.25 : 5.00, date: 'fallback' };
  }
}

async function getDieselPrice(country) {
  try {
    switch(country) {
      case 'PL': {
        const res = await fetch('https://cenypaliw.fyi/', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } });
        const html = await res.text();
        const match = html.match(/ON[^0-9]*?([5-9]\.[0-9]{2})/i) || html.match(/diesel[^0-9]*?([5-9]\.[0-9]{2})/i);
        if (match) { const price = parseFloat(match[1]); if (price > 5 && price < 10) return { price, source: 'Orlen PL (cenypaliw.fyi)' }; }
        const prices = [...html.matchAll(/([5-9]\.[0-9]{2})/g)].map(m => parseFloat(m[1])).filter(p => p > 5.5 && p < 9);
        if (prices.length) return { price: prices[0], source: 'Orlen PL (cenypaliw.fyi)' };
        return { price: 8.70, source: 'Orlen PL (wartosc orientacyjna)' };
      }
      case 'DE': {
        const apiKey = process.env.TANKERKOENIG_API_KEY;
        if (apiKey) {
          const tankpoolId = '005056ba-7cb6-1ed2-bceb-90e360dc0de2';
          const res = await fetch(`https://creativecommons.tankerkoenig.de/api/detail.php?id=${tankpoolId}&apikey=${apiKey}`);
          const data = await res.json();
          if (data.ok && data.station && data.station.diesel) return { price: parseFloat(data.station.diesel), source: 'Tankpool24 Straelen (Tankerkoenig)' };
          const res2 = await fetch(`https://creativecommons.tankerkoenig.de/api/list.php?lat=51.4397&lng=6.2617&rad=5&sort=price&type=diesel&apikey=${apiKey}`);
          const data2 = await res2.json();
          if (data2.ok && data2.stations && data2.stations.length) {
            const prices = data2.stations.map(s => s.price).filter(p => p > 0);
            const avg = prices.reduce((a,b) => a+b) / prices.length;
            return { price: Math.round(avg * 1000) / 1000, source: `Srednia Straelen DE (${prices.length} stacji)` };
          }
        }
        const res3 = await fetch('https://www.fuel-prices.eu/live/germany/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html3 = await res3.text();
        const match3 = html3.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match3) { const price = parseFloat(match3[1]); if (price > 1.2 && price < 2.5) return { price, source: 'Srednia DE (fuel-prices.eu)' }; }
        return { price: 2.13, source: 'Niemcy DE (wartosc orientacyjna)' };
      }
      case 'FR': {
        const res = await fetch('https://www.fuel-prices.eu/live/france/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) { const price = parseFloat(match[1]); if (price > 1.5 && price < 2.5) return { price, source: 'Srednia FR (fuel-prices.eu)' }; }
        return { price: 1.80, source: 'Francja FR (wartosc orientacyjna)' };
      }
      case 'GB': {
        const res = await fetch('https://www.fuel-prices.eu/live/uk/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) { const price = parseFloat(match[1]); if (price > 1.2 && price < 2.5) return { price, source: 'Srednia UK (fuel-prices.eu)' }; }
        return { price: 1.91, source: 'Wielka Brytania UK (wartosc orientacyjna)' };
      }
      case 'NL': {
        const res = await fetch('https://www.fuel-prices.eu/live/netherlands/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) { const price = parseFloat(match[1]); if (price > 1.3 && price < 2.5) return { price, source: 'Srednia NL (fuel-prices.eu)' }; }
        return { price: 1.85, source: 'Holandia NL (wartosc orientacyjna)' };
      }
      case 'BE': {
        const res = await fetch('https://www.fuel-prices.eu/live/belgium/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const match = html.match(/Diesel[^0-9]*?([1-2]\.[0-9]{2,3})/i);
        if (match) { const price = parseFloat(match[1]); if (price > 1.3 && price < 2.5) return { price, source: 'Srednia BE (fuel-prices.eu)' }; }
        return { price: 1.80, source: 'Belgia BE (wartosc orientacyjna)' };
      }
      default: return null;
    }
  } catch(e) {
    console.error('getDieselPrice error:', country, e.message);
    const fallback = { PL: 8.70, DE: 2.13, FR: 1.80, GB: 1.91, NL: 1.85, BE: 1.80 };
    return fallback[country] ? { price: fallback[country], source: country + ' (wartosc orientacyjna)' } : null;
  }
}

router.post('/', upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Brak zdjec' });

    const country = req.body.country || 'DE';
    const useTankpool = req.body.use_tankpool === 'true';
    const currency = COUNTRY_CURRENCY[country] || 'EUR';

    const imageContents = req.files.map(file => ({
      type: 'image',
      source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') }
    }));

    const currencyHint = currency === 'PLN' ? 'Ceny sa w PLN.' : `Ceny sa w ${currency}. Podaj wartosci w oryginalnej walucie ${currency}.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          ...imageContents,
          {
            type: 'text',
            text: `Przeanalizuj te zdjecia z tankowania. ${currencyHint}\n\nWyciagnij DOKLADNIE:\n- mileage: przebieg z licznika (liczba calkowita)\n- liters: ilosc paliwa w litrach (UWAGA: na dystrybutorach Tokheim gorny segment cyfry 7 bywa niewidoczny i wyglada jak 1 - jesli widzisz np. 13.85L na duzym pojezdzie, rozważ ze to 73.85L)\n- price_per_l: cena za litr w ${currency} (null jesli brak)\n- total: laczna kwota w ${currency} (null jesli brak)\n- fuel_type: rodzaj paliwa (ON=diesel domyslnie; ADBLUE jesli AdBlue/DEF/AUS32)\n- station: nazwa stacji\n- has_price: true jesli cena widoczna, false jesli brak\n\nOdpowiedz TYLKO JSON:\n{"mileage": 970050, "liters": 73.54, "price_per_l": null, "total": null, "fuel_type": "ON", "station": "Tankpool", "has_price": false}`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    let scanned = {};
    try { scanned = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch(e) { const match = text.match(/\{[\s\S]*\}/); if (match) { try { scanned = JSON.parse(match[0]); } catch(e2) {} } }

    const rateInfo = await getRate(currency);
    const rate = rateInfo.rate;

    let priceInfo = null;
    if (!scanned.price_per_l && !scanned.total && (useTankpool || scanned.has_price === false)) {
      priceInfo = await getStoredPrice(country);
      if (priceInfo) scanned.price_per_l = priceInfo.price;
    }

    const price_per_l_pln = scanned.price_per_l ? Math.round(scanned.price_per_l * rate * 1000) / 1000 : null;
    const total_orig = scanned.total;
    const total_pln = total_orig ? Math.round(total_orig * rate * 100) / 100 : null;
    const calc_total = total_pln || (price_per_l_pln && scanned.liters ? Math.round(price_per_l_pln * scanned.liters * 100) / 100 : null);

    res.json({
      ok: true,
      data: { mileage: scanned.mileage||null, liters: scanned.liters||null, price_per_l: price_per_l_pln, total: calc_total, fuel_type: scanned.fuel_type||'ON', station: scanned.station||null },
      meta: { country, currency, rate, rate_date: rateInfo.date, price_source: priceInfo?priceInfo.source:null, price_auto_fetched: !!priceInfo, original: { price_per_l: scanned.price_per_l, total: total_orig } }
    });
  } catch(err) { next(err); }
});

router.get('/diesel-price/:country', async (req, res, next) => {
  try {
    const country = req.params.country.toUpperCase();
    const currency = COUNTRY_CURRENCY[country] || 'EUR';
    const priceInfo = await getDieselPrice(country);
    const rateInfo = await getRate(currency);
    res.json({ country, currency, price_local: priceInfo?priceInfo.price:null, price_pln: priceInfo?Math.round(priceInfo.price*rateInfo.rate*100)/100:null, source: priceInfo?priceInfo.source:'brak danych', rate: rateInfo.rate, rate_date: rateInfo.date });
  } catch(err) { next(err); }
});

router.get('/rate/:currency', async (req, res, next) => {
  try { const info = await getRate(req.params.currency.toUpperCase()); res.json(info); }
  catch(err) { next(err); }
});

// Lista cen dziennych (brutto lokalne + PLN po aktualnym kursie NBP)
router.get('/prices', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM fuel_prices ORDER BY country');
    const out = [];
    for (const r of rows) {
      const rate = (await getRate(r.currency)).rate;
      const g = parseFloat(r.price_gross);
      out.push({ country: r.country, currency: r.currency, price_gross: g, price_pln: Math.round(g * rate * 100) / 100, rate, source: r.source, manual: r.manual, fetched_at: r.fetched_at });
    }
    res.json(out);
  } catch (err) { next(err); }
});

// Wymuszone odswiezenie wszystkich krajow (dla crona / przycisku)
router.post('/prices/refresh', async (req, res, next) => {
  try {
    const results = [];
    for (const c of Object.keys(COUNTRY_CURRENCY)) {
      try { const info = await refreshCountryPrice(c); results.push({ country: c, ok: !!info, price: info ? info.price : null, source: info ? info.source : null }); }
      catch (e) { results.push({ country: c, ok: false, error: e.message }); }
    }
    res.json({ ok: true, refreshed_at: new Date().toISOString(), results });
  } catch (err) { next(err); }
});

// Reczna korekta ceny brutto dla kraju (trzyma sie do nastepnego wymuszonego refreshu)
router.put('/prices/:country', async (req, res, next) => {
  try {
    const country = req.params.country.toUpperCase();
    const currency = COUNTRY_CURRENCY[country] || 'EUR';
    const price = parseFloat(req.body.price_gross);
    if (!price || price <= 0) return res.status(400).json({ error: 'Zla cena' });
    await pool.query(
      `INSERT INTO fuel_prices (country, price_gross, currency, source, manual, fetched_at)
       VALUES ($1,$2,$3,'reczna korekta',true,NOW())
       ON CONFLICT (country) DO UPDATE SET price_gross=EXCLUDED.price_gross, source='reczna korekta', manual=true, fetched_at=NOW()`,
      [country, price, currency]
    );
    res.json({ ok: true, country, price_gross: price, currency });
  } catch (err) { next(err); }
});

// ===== AUDYT (TYLKO ODCZYT) — ostatnie 2 mies: stan tankowan vs faktury vs szacunek brutto =====
const STATION_COUNTRY = [
  [/\bPOL\b|POLSKA|ILOWA|WYKROTY|SLUBICE|GLIWICE|BLONIE|KRZYWA|ORLEN|CITRONEX|A2\b/i, 'PL'],
  [/\bGBR\b|LYMPNE|CHIPPENHAM|FLAMSTEAD|WOLVERHAMPTON|SKELTON|BURY ST|LEEMING|ALCONBURY|RED LION/i, 'GB'],
  [/\bFRA\b|FRANCE|CALAIS|ORLEANS|CLERMONT/i, 'FR'],
  [/\bNL\b|NETHERLAND|WESTFALICA/i, 'NL'],
  [/\bBE\b|BELGI/i, 'BE'],
  [/\bDEU\b|\bDE\b|STRAELEN|RHEINE|EMMERICH|ARNSBERG|MARBURG|LEINEFELDE|DOBELN|BRUCHSAL|NORTMOOR|SCHUTTDORF|WESTERKAPPELN|ESCHWEILER|TANKPOOL|TOKHEIM|GILBARCO|TOTALENERGIES/i, 'DE'],
];
function guessCountry(s) { if (!s) return '?'; for (const [re, c] of STATION_COUNTRY) if (re.test(s)) return c; return '?'; }
function esc(x) { return String(x == null ? '' : x).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
function n2(x) { return x == null ? '—' : Number(x).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

router.get('/audit', async (req, res, next) => {
  try {
    const since = new Date(); since.setMonth(since.getMonth() - 2); const sinceStr = since.toISOString().slice(0, 10);
    const { rows: refuels } = await pool.query(
      `SELECT r.id, r.date, r.liters, r.price_per_l, r.total, r.station, r.country, v.plate
       FROM refuels r JOIN vehicles v ON v.id=r.vehicle_id
       WHERE r.date >= $1 AND r.fuel_type <> 'ADBLUE'
       ORDER BY v.plate, r.date`, [sinceStr]);
    const { rows: inv } = await pool.query(
      `SELECT ii.plate, i.month AS ym, SUM(ii.gross_amount)::float AS gross, SUM(ii.liters)::float AS liters
       FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
       WHERE i.month >= $1 GROUP BY ii.plate, i.month`, [sinceStr.slice(0, 7)]);
    const invMap = {}; inv.forEach(r => { invMap[(r.plate || '').toUpperCase() + '|' + r.ym] = r; });
    // dzisiejsze brutto PLN/L per kraj (szacunek)
    const { rows: fp } = await pool.query('SELECT * FROM fuel_prices');
    const todayGross = {};
    for (const p of fp) { const rate = (await getRate(p.currency)).rate; todayGross[p.country] = parseFloat(p.price_gross) * rate; }

    // grupuj po auto|miesiac
    const groups = {};
    for (const r of refuels) {
      const ym = r.date.toISOString().slice(0, 7);
      const key = r.plate + '|' + ym;
      const g = groups[key] || (groups[key] = { plate: r.plate, ym, n: 0, L: 0, total: 0, countries: {}, rows: [] });
      const c = guessCountry(r.station);
      g.n++; g.L += parseFloat(r.liters) || 0; g.total += parseFloat(r.total) || 0;
      g.countries[c] = (g.countries[c] || 0) + 1;
      g.rows.push({ ...r, country: c });
    }

    let sumCur = 0, sumInv = 0, sumEst = 0;
    let g1 = '';
    Object.values(groups).sort((a, b) => a.plate.localeCompare(b.plate) || a.ym.localeCompare(b.ym)).forEach(g => {
      const dom = Object.keys(g.countries).sort((a, b) => g.countries[b] - g.countries[a])[0];
      const invRow = invMap[g.plate.toUpperCase() + '|' + g.ym];
      const invGross = invRow ? invRow.gross : null;
      const est = todayGross[dom] != null ? g.L * todayGross[dom] : null; // szacunek: litry x dzisiejsze brutto kraju
      sumCur += g.total; if (invGross != null) sumInv += invGross; if (est != null) sumEst += est;
      const gap = invGross != null ? invGross - g.total : null;
      const gapPct = (invGross != null && g.total > 0) ? (gap / g.total * 100) : null;
      g1 += `<tr>
        <td><b>${esc(g.plate)}</b></td><td>${esc(g.ym)}</td><td>${esc(dom)}</td>
        <td style="text-align:right">${g.n}</td>
        <td style="text-align:right">${n2(g.L)} L</td>
        <td style="text-align:right">${n2(g.total)}</td>
        <td style="text-align:right">${g.L > 0 ? n2(g.total / g.L) : '—'}</td>
        <td style="text-align:right;color:#7fd1cf">${invGross != null ? n2(invGross) : '<span style=color:#666>brak faktury</span>'}</td>
        <td style="text-align:right;color:#7fd1cf">${invRow ? n2(invRow.gross / invRow.liters) : '—'}</td>
        <td style="text-align:right;color:#c8a24a">${est != null ? n2(est) : '—'}</td>
        <td style="text-align:right;font-weight:700;color:${gap != null && gap > 0 ? '#e05a5a' : '#5ad18a'}">${gap != null ? n2(gap) : '—'}${gapPct != null ? ' ('+gapPct.toFixed(0)+'%)' : ''}</td>
      </tr>`;
    });

    // detal per tankowanie
    let g2 = '';
    refuels.forEach(r => {
      const c = guessCountry(r.station);
      const flag = (r.price_per_l && r.price_per_l < 2.6) ? '<span style="color:#e05a5a">obce-surowe?</span>' : (r.price_per_l && r.price_per_l < 5.5 ? '<span style="color:#c8a24a">nisko</span>' : '<span style="color:#5ad18a">PLN?</span>');
      const curC = r.country || c || ''; const csel = '<select onchange="setC('+r.id+',this.value,this)" style="background:#1c2424;color:#dfe6e6;border:1px solid #2a3a3a;border-radius:4px;padding:2px 4px;font-size:11px">'+['','PL','DE','GB','NL','BE','FR'].map(function(o){return '<option value="'+o+'"'+(o===curC?' selected':'')+'>'+(o||'?')+'</option>';}).join('')+'</select>';
      g2 += `<tr><td>${esc(r.date.toISOString().slice(0,10))}</td><td><b>${esc(r.plate)}</b></td><td>${esc(r.station)||'—'}</td><td>${csel}</td><td style="text-align:right">${n2(r.liters)} L</td><td style="text-align:right">${r.price_per_l != null ? n2(r.price_per_l) : '—'}</td><td style="text-align:right">${n2(r.total)}</td><td>${flag}</td></tr>`;
    });

    // === ANALIZA WG WIELKOSCI (metoda Marcina: duze=PL, male=zagranica) ===
    const maxByVeh = {};
    refuels.forEach(r => { const L = parseFloat(r.liters) || 0; if (L > (maxByVeh[r.plate] || 0)) maxByVeh[r.plate] = L; });
    const plG = todayGross['PL'] || 8.9, forG = todayGross['DE'] || 9.2;
    const vehAgg = {};
    refuels.forEach(r => {
      const L = parseFloat(r.liters) || 0, cur = parseFloat(r.total) || 0;
      const thr = 0.55 * (maxByVeh[r.plate] || L);
      const isPL = L >= thr;
      const a = vehAgg[r.plate] || (vehAgg[r.plate] = { plate: r.plate, thr, plN: 0, plL: 0, plCur: 0, plEst: 0, foN: 0, foL: 0, foCur: 0, foEst: 0 });
      const est = L * (isPL ? plG : forG);
      if (isPL) { a.plN++; a.plL += L; a.plCur += cur; a.plEst += est; } else { a.foN++; a.foL += L; a.foCur += cur; a.foEst += est; }
    });
    let tCur = 0, tEst = 0;
    const s3 = Object.values(vehAgg).sort((a, b) => a.plate.localeCompare(b.plate)).map(a => {
      const cur = a.plCur + a.foCur, est = a.plEst + a.foEst; tCur += cur; tEst += est;
      return `<tr><td><b>${esc(a.plate)}</b></td><td style="text-align:right">${n2(a.thr)} L</td><td style="text-align:right">${a.plN} / ${n2(a.plL)} L</td><td style="text-align:right">${n2(a.plCur)}</td><td style="text-align:right;color:#c8a24a">${a.foN} / ${n2(a.foL)} L</td><td style="text-align:right">${n2(a.foCur)}</td><td style="text-align:right">${n2(cur)}</td><td style="text-align:right;color:#7fd1cf">${n2(est)}</td><td style="text-align:right;font-weight:700;color:${est - cur > 0 ? '#e05a5a' : '#5ad18a'}">${n2(est - cur)}</td></tr>`;
    }).join('');

    const html = `<!doctype html><meta charset=utf-8><title>Audyt tankowan</title>
<style>body{background:#0b0e0f;color:#dfe6e6;font-family:-apple-system,system-ui,sans-serif;padding:24px;max-width:1400px;margin:auto}
h1,h2{font-weight:700}h2{margin-top:32px;font-size:16px;color:#9fb0b0}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{padding:6px 8px;border-bottom:1px solid #1c2424;white-space:nowrap}
th{text-align:left;color:#7f9090;font-size:11px;position:sticky;top:0;background:#0b0e0f}
tr:hover td{background:#111717}.mono{font-variant-numeric:tabular-nums}
.note{background:#111717;border:1px solid #1c2424;border-radius:8px;padding:12px 16px;font-size:12px;color:#9fb0b0;margin:12px 0}</style>
<h1>Audyt tankowan — ostatnie 2 miesiace (od ${sinceStr})</h1>
<div class="note"><b>Tylko odczyt.</b> Nic nie zmienione w bazie. Kolumny: <b>obecna kwota</b> = co jest teraz w tankowaniach (PLN). <b>Faktura brutto</b> = realny koszt z karty (per auto/mies) — to jest prawda. <b>Szac. brutto</b> = litry × dzisiejsza cena brutto kraju (tylko poglad). <b>Roznica</b> = faktura − obecna (czerwone = zanizone).</div>
<h2>ANALIZA WG WIELKOSCI (Twoja metoda: duze=PL, male=zagranica)</h2>
<div class="note">Dla kazdego auta prog = 55% najwiekszego tankowania. Powyzej = PL (pelny bak), ponizej = dolewka zagraniczna (DE/GB). "Szac. poprawna" = litry x brutto (PL ${n2(plG)} zl/L, zagr ${n2(forG)} zl/L). Patrz na SUMA na dole tej tabeli - to ile realnie brakuje.</div>
<table class=mono><thead><tr><th>Auto</th><th>Prog</th><th>PL: szt/litry</th><th>PL obecna</th><th>Zagr: szt/litry</th><th>Zagr obecna</th><th>Razem obecna</th><th>Szac. poprawna</th><th>Roznica</th></tr></thead><tbody>${s3}
<tr style="border-top:2px solid #2a3a3a;font-weight:700"><td colspan=6>SUMA</td><td style="text-align:right">${n2(tCur)}</td><td style="text-align:right;color:#7fd1cf">${n2(tEst)}</td><td style="text-align:right;color:#e05a5a">${n2(tEst - tCur)}</td></tr>
</tbody></table>
<h2>1. Per auto × miesiac — obecne vs faktury vs szacunek</h2>
<table class=mono><thead><tr><th>Auto</th><th>Mies</th><th>Kraj*</th><th>Szt</th><th>Litry</th><th>Obecna PLN</th><th>zl/L teraz</th><th>Faktura brutto</th><th>zl/L faktura</th><th>Szac. brutto</th><th>Roznica (faktura−obecna)</th></tr></thead><tbody>${g1}
<tr style="border-top:2px solid #2a3a3a;font-weight:700"><td colspan=5>SUMA</td><td style="text-align:right">${n2(sumCur)}</td><td></td><td style="text-align:right;color:#7fd1cf">${n2(sumInv)}</td><td></td><td style="text-align:right;color:#c8a24a">${n2(sumEst)}</td><td style="text-align:right;color:#e05a5a">${n2(sumInv - sumCur)}</td></tr>
</tbody></table>
<div class="note">*Kraj zgadywany z nazwy stacji — moze byc „?" gdzie nie wykryto. Do audytu, nie do rozliczen.</div>
<h2>2. Detal per tankowanie (${refuels.length} szt)</h2>
<table class=mono><thead><tr><th>Data</th><th>Auto</th><th>Stacja</th><th>Kraj*</th><th>Litry</th><th>zl/L teraz</th><th>Kwota teraz</th><th>Stan</th></tr></thead><tbody>${g2}</tbody></table>
<script>function setC(id,val,el){el.style.borderColor='#c8a24a';fetch('/api/refuels/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:val||null})}).then(function(r){el.style.borderColor=r.ok?'#5ad18a':'#e05a5a';}).catch(function(){el.style.borderColor='#e05a5a';});}</script>`;
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (err) { next(err); }
});

// === DOPASOWANIE AS24: przypisz kraj do tankowan po aucie+litrach+dacie (dry-run; ?apply=1 zapisuje) ===
let AS24 = [];
try { AS24 = require('../data/as24.json'); } catch(e) { console.error('as24.json brak:', e.message); }
try { AS24 = AS24.concat(require('../data/tankpool.json')); } catch(e) { console.error('tankpool.json brak:', e.message); }
try { AS24 = AS24.concat(require('../data/citronex.json')); } catch(e) { console.error('citronex.json brak:', e.message); }
function daysDiff(a, b) { return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000); }
router.get('/match-as24', async (req, res, next) => {
  try {
    const apply = req.query.apply === '1';
    if (!AS24.length) return res.send('<p style="color:red">Brak danych AS24</p>');
    const plates = [...new Set(AS24.map(t => t.plate))];
    const { rows: refuels } = await pool.query(
      `SELECT r.id, v.plate, TO_CHAR(r.date,'YYYY-MM-DD') AS d, r.liters::float AS liters, r.country
       FROM refuels r JOIN vehicles v ON v.id=r.vehicle_id
       WHERE v.plate = ANY($1) AND r.date >= '2026-06-28' AND r.date <= '2026-09-05' AND r.fuel_type <> 'ADBLUE'`, [plates]);
    const byPlate = {};
    refuels.forEach(r => { (byPlate[r.plate] = byPlate[r.plate] || []).push(r); });
    const used = new Set();
    const matched = []; const rest1 = [];
    for (const t of AS24) {
      const best = (byPlate[t.plate] || []).filter(r => !used.has(r.id) && Math.abs(r.liters - t.liters) <= 0.6 && daysDiff(r.d, t.date) <= 10).sort((a, b) => daysDiff(a.d, t.date) - daysDiff(b.d, t.date))[0];
      if (best) { used.add(best.id); matched.push({ t, r: best }); } else rest1.push(t);
    }
    const summed = []; const rest2 = []; const grp = {};
    rest1.forEach(t => { const k = t.plate + '|' + t.date + '|' + t.country; (grp[k] = grp[k] || []).push(t); });
    for (const k of Object.keys(grp)) {
      const g = grp[k];
      if (g.length < 2) { rest2.push(...g); continue; }
      const sumL = Math.round(g.reduce((a, t) => a + t.liters, 0) * 100) / 100;
      const cand = (byPlate[g[0].plate] || []).filter(r => !used.has(r.id) && Math.abs(r.liters - sumL) <= 1.5 && daysDiff(r.d, g[0].date) <= 10).sort((a, b) => daysDiff(a.d, g[0].date) - daysDiff(b.d, g[0].date))[0];
      if (cand) { used.add(cand.id); summed.push({ t: { plate: g[0].plate, date: g[0].date, country: g[0].country, liters: sumL, parts: g.length }, r: cand }); }
      else rest2.push(...g);
    }
    const looseM = []; const unmatched = [];
    for (const t of rest2) {
      const loose = (byPlate[t.plate] || []).filter(r => !used.has(r.id) && daysDiff(r.d, t.date) <= 5 && Math.abs(r.liters - t.liters) <= 5).sort((a, b) => (daysDiff(a.d, t.date) + Math.abs(a.liters - t.liters) / 5) - (daysDiff(b.d, t.date) + Math.abs(b.liters - t.liters) / 5))[0];
      if (loose) { used.add(loose.id); looseM.push({ t, r: loose }); } else unmatched.push(t);
    }
    if (apply) { for (const m of matched.concat(looseM).concat(summed)) await pool.query('UPDATE refuels SET country=$1 WHERE id=$2', [m.t.country, m.r.id]); }
    const perC = {}; matched.concat(looseM).concat(summed).forEach(m => perC[m.t.country] = (perC[m.t.country] || 0) + 1);
    const noC = refuels.filter(r => !used.has(r.id));
    const noCHtml = noC.sort((a,b)=>a.plate.localeCompare(b.plate)||a.d.localeCompare(b.d)).map(r => `<tr><td>${r.plate}</td><td>${r.d}</td><td style="text-align:right">${r.liters} L</td><td>${r.country||'<span style=color:#e05a5a>brak</span>'}</td></tr>`).join('');
    const rowsHtml = matched.map(m => `<tr><td>${m.r.plate}</td><td>${m.t.date}</td><td style="text-align:right">${m.t.liters} L</td><td><b>${m.t.country}</b></td><td style="color:#888">#${m.r.id} (${m.r.d}, ${m.r.liters}L)</td></tr>`).join('');
    const looseHtml = looseM.map(m => `<tr><td>${m.r.plate}</td><td>${m.t.date}</td><td style="text-align:right">${m.t.liters} L</td><td><b>${m.t.country}</b></td><td style="color:#c8a24a">#${m.r.id} (${m.r.d}, ${m.r.liters}L) - litry sie roznia, sprawdz</td></tr>`).join('');
    const summedHtml = summed.map(m => `<tr><td>${m.r.plate}</td><td>${m.t.date}</td><td style="text-align:right">${m.t.liters} L (${m.t.parts} czesci)</td><td><b>${m.t.country}</b></td><td style="color:#888">#${m.r.id} (${m.r.d}, ${m.r.liters}L)</td></tr>`).join('');
    const unHtml = unmatched.map(t => `<tr><td>${t.plate}</td><td>${t.date}</td><td style="text-align:right">${t.liters} L</td><td>${t.country}</td></tr>`).join('');
    res.set('Content-Type','text/html; charset=utf-8').send(`<!doctype html><meta charset=utf-8><style>body{background:#0b0e0f;color:#dfe6e6;font-family:system-ui;padding:24px}table{border-collapse:collapse;font-size:12px;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #1c2424;text-align:left}h1,h2{font-weight:700}.b{background:#111717;border:1px solid #1c2424;border-radius:8px;padding:12px 16px;margin:12px 0}</style>
<h1>Dopasowanie AS24 -> kraj tankowan</h1>
<div class="b">${apply ? '<b style="color:#5ad18a">ZAPISANO do bazy.</b>' : '<b>PODGLAD (dry-run) - nic nie zapisano.</b> Zeby zapisac: dodaj <b>?apply=1</b> na koncu adresu.'}<br>
AS24 transakcji: <b>${AS24.length}</b> | Pewne: <b>${matched.length}</b> | Luzne: <b>${looseM.length}</b> | Zsumowane: <b>${summed.length}</b> | Razem: <b>${matched.length+looseM.length+summed.length}</b> (${Object.entries(perC).map(([c,n])=>c+':'+n).join(', ')||'-'}) | Bez: <b>${unmatched.length}</b></div>
<h2>Dopasowane pewne (${matched.length})</h2><table><thead><tr><th>Auto</th><th>Data AS24</th><th>Litry</th><th>Kraj</th><th>Tankowanie w bazie</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<h2>Dopasowane luzniej - SPRAWDZ czy OK (${looseM.length})</h2><table><thead><tr><th>Auto</th><th>Data AS24</th><th>Litry AS24</th><th>Kraj</th><th>Tankowanie w bazie</th></tr></thead><tbody>${looseHtml}</tbody></table>
<h2>Zsumowane (AS24 rozbil, program scalil) (${summed.length})</h2><table><thead><tr><th>Auto</th><th>Data AS24</th><th>Litry (suma)</th><th>Kraj</th><th>Tankowanie w bazie</th></tr></thead><tbody>${summedHtml}</tbody></table>
<h2>Bez dopasowania AS24/Tankpool (${unmatched.length})</h2><table><thead><tr><th>Auto</th><th>Data</th><th>Litry</th><th>Kraj</th></tr></thead><tbody>${unHtml}</tbody></table>
<div class="b" style="border-color:#3a2a2a"><b>ODWROTNY WIDOK - tankowania W PROGRAMIE (auta z kart, ostatnie 2 mies, bez AdBlue):</b><br>
Razem w bazie: <b>${refuels.length}</b> | Dostaly kraj: <b>${refuels.length - noC.length}</b> | <b style="color:#e05a5a">BEZ kraju: ${noC.length}</b> (Citronex-PL albo niezeskanowane)</div>
<h2>Tankowania w programie BEZ przypisanego kraju (${noC.length})</h2><table><thead><tr><th>Auto</th><th>Data</th><th>Litry</th><th>Kraj teraz</th></tr></thead><tbody>${noCHtml}</tbody></table>`);
  } catch (err) { next(err); }
});


// === PRZELICZANIE KWOT: wycena Kowalskiego (PL dzienny hurt Orlen+VAT, DE/GB miesiecznie) ===
let PL_DAILY = {};
try { PL_DAILY = require('../data/pl_daily.json'); } catch(e) { console.error('pl_daily.json brak:', e.message); }
const FX_MONTHLY = { DE: { 7: 2.08, 8: 2.18 }, GB: { 7: 1.72, 8: 1.80 } };
function plPriceOn(ds) { if (PL_DAILY[ds]) return PL_DAILY[ds]; const ks = Object.keys(PL_DAILY).sort(); let v = null; for (const k of ks) { if (k <= ds) v = PL_DAILY[k]; else break; } return v; }
async function nbpRange(cur) { try { const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${cur.toLowerCase()}/2026-06-25/2026-09-05/?format=json`); if (!res.ok) throw new Error('nbp'); const data = await res.json(); const m = {}; data.rates.forEach(r => m[r.effectiveDate] = parseFloat(r.mid)); return m; } catch (e) { return {}; } }
function rateOn(map, ds, fb) { if (map[ds]) return map[ds]; const ks = Object.keys(map).sort(); let v = null; for (const k of ks) { if (k <= ds) v = map[k]; else break; } return v || fb; }
router.get('/reprice', async (req, res, next) => {
  try {
    const apply = req.query.apply === '1';
    const eurMap = await nbpRange('EUR'), gbpMap = await nbpRange('GBP');
    const { rows } = await pool.query(
      `SELECT r.id, v.plate, TO_CHAR(r.date,'YYYY-MM-DD') AS d, r.liters::float AS liters, r.price_per_l::float AS price, r.total::float AS total, r.country
       FROM refuels r JOIN vehicles v ON v.id=r.vehicle_id
       WHERE r.country IN ('PL','DE','GB') AND r.date >= '2026-07-01' AND r.date <= '2026-08-31' AND r.fuel_type <> 'ADBLUE'
       ORDER BY v.plate, r.date`);
    const out = []; let sumOld = 0, sumNew = 0; const perC = {};
    for (const r of rows) {
      const month = parseInt(r.d.slice(5, 7));
      let unit = null, rate = 1, cur = 'PLN';
      if (r.country === 'PL') { unit = plPriceOn(r.d); }
      else { cur = r.country === 'DE' ? 'EUR' : 'GBP'; const fx = r.country === 'DE' ? eurMap : gbpMap; rate = rateOn(fx, r.d, cur === 'EUR' ? 4.30 : 5.05); const loc = (FX_MONTHLY[r.country] || {})[month]; unit = loc ? loc * rate : null; }
      if (!unit || !r.liters) continue;
      const newTotal = Math.round(unit * r.liters * 100) / 100;
      const newPrice = Math.round(unit * 1000) / 1000;
      const oldTotal = r.total || 0;
      sumOld += oldTotal; sumNew += newTotal;
      perC[r.country] = perC[r.country] || { old: 0, neu: 0, n: 0 };
      perC[r.country].old += oldTotal; perC[r.country].neu += newTotal; perC[r.country].n++;
      out.push({ id: r.id, plate: r.plate, d: r.d, liters: r.liters, country: r.country, oldTotal, newTotal, oldPrice: r.price, newPrice, cur, rate });
      if (apply) { await pool.query('UPDATE refuels SET total_orig=COALESCE(total_orig,total), price_orig=COALESCE(price_orig,price_per_l), total=$1, price_per_l=$2 WHERE id=$3', [newTotal, newPrice, r.id]); }
    }
    const diff = Math.round((sumNew - sumOld) * 100) / 100;
    const perCHtml = Object.entries(perC).map(([c, o]) => `<tr><td><b>${c}</b></td><td>${o.n}</td><td class="mono">${o.old.toFixed(2)}</td><td class="mono">${o.neu.toFixed(2)}</td><td class="mono" style="color:${o.neu>=o.old?'#5ad18a':'#e05a5a'}">${(o.neu-o.old>=0?'+':'')}${(o.neu-o.old).toFixed(2)}</td></tr>`).join('');
    const rowsHtml = out.map(r => `<tr><td>${r.plate}</td><td>${r.d}</td><td><b>${r.country}</b></td><td class="mono">${r.liters} L</td><td class="mono" style="color:#888">${r.oldTotal.toFixed(2)}</td><td class="mono" style="color:#5ad18a">${r.newTotal.toFixed(2)}</td><td class="mono" style="color:#888">${r.cur==='PLN'?'hurt+VAT':(r.cur+' x'+r.rate.toFixed(4))}</td></tr>`).join('');
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><meta charset=utf-8><style>body{background:#0b0e0f;color:#dfe6e6;font-family:system-ui;padding:24px}table{border-collapse:collapse;font-size:12px;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #1c2424;text-align:left}h1,h2{font-weight:700}.b{background:#111717;border:1px solid #1c2424;border-radius:8px;padding:12px 16px;margin:12px 0}</style>
<h1>Przelicz kwoty -> cena Kowalskiego</h1>
<div class="b">${apply ? '<b style="color:#5ad18a">ZAPISANO. Stare kwoty w total_orig (mozna cofnac).</b>' : '<b>PODGLAD (dry-run) - nic nie zapisano.</b> Zeby zapisac: dodaj <b>?apply=1</b> na koncu adresu.'}<br>
Tankowan: <b>${out.length}</b> | Suma stara: <b>${sumOld.toFixed(2)} zl</b> | Suma nowa: <b>${sumNew.toFixed(2)} zl</b> | Roznica: <b style="color:${diff>=0?'#5ad18a':'#e05a5a'}">${diff>=0?'+':''}${diff.toFixed(2)} zl</b><br>
<span style="font-size:11px;color:#888">PL = dzienny hurt Orlen ON x 1.23 VAT. DE/GB = miesieczna srednia detaliczna x kurs NBP z dnia. FR pominiete.</span></div>
<h2>Podsumowanie per kraj</h2><table><thead><tr><th>Kraj</th><th>Ile</th><th>Stara suma</th><th>Nowa suma</th><th>Roznica</th></tr></thead><tbody>${perCHtml}</tbody></table>
<h2>Szczegoly (${out.length})</h2><table><thead><tr><th>Auto</th><th>Data</th><th>Kraj</th><th>Litry</th><th>Stara kwota</th><th>Nowa kwota</th><th>Wycena</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);
  } catch (err) { next(err); }
});

module.exports = router;

