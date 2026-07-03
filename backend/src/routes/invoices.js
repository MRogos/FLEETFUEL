const router = require('express').Router();
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db/init');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Parsuje liczbe z CSV: obsluguje polski przecinek dziesietny, spacje jako separator tysiecy, symbole walut
function parseNum(s) {
  if (s == null) return null;
  let t = String(s).trim().replace(/\s/g, '').replace(/zł|pln|eur|gbp/gi, '');
  if (t === '') return null;
  if (t.indexOf(',') > -1 && t.indexOf('.') === -1) t = t.replace(',', '.'); // przecinek = separator dziesietny
  else t = t.replace(/,/g, ''); // przecinek = separator tysiecy
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// Parsuje CSV faktury (np. Citronex) -> [{plate, liters, net, gross, discount}]
// Wykrywa delimiter (; lub ,), naglowek i mapuje kolumny po nazwie (PL/EN). Bez naglowka: plate;liters;net;gross;discount
function parseInvoiceCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const rows = lines.map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, '')));
  const header = rows[0].map(h => h.toLowerCase());
  const isHeader = header.some(h => /plate|tablic|rejestr|pojazd|auto|litr|ilos|liters|netto|net|brutto|gross|rabat|discount|upust/.test(h));
  let col = { plate: 0, liters: 1, net: 2, gross: 3, discount: 4 };
  let data = rows;
  if (isHeader) {
    const find = (...keys) => header.findIndex(h => keys.some(k => h.includes(k)));
    col = {
      plate:    find('plate', 'tablic', 'rejestr', 'pojazd', 'auto', 'nr rej'),
      liters:   find('litr', 'ilos', 'liters'),
      net:      find('netto', 'net'),
      gross:    find('brutto', 'gross'),
      discount: find('rabat', 'discount', 'upust')
    };
    data = rows.slice(1);
  }
  const get = (r, i) => (i >= 0 && i < r.length) ? r[i] : null;
  const out = [];
  data.forEach(r => {
    const plate = (get(r, col.plate) || '').toString().trim();
    if (!plate) return;
    out.push({
      plate,
      liters:   parseNum(get(r, col.liters)),
      net:      parseNum(get(r, col.net)),
      gross:    parseNum(get(r, col.gross)),
      discount: parseNum(get(r, col.discount))
    });
  });
  return out;
}

router.get('/suppliers', async (req, res, next) => {
  try { const { rows } = await pool.query('SELECT * FROM fuel_suppliers WHERE active=true ORDER BY name'); res.json(rows); }
  catch(err) { next(err); }
});

router.get('/comparison', async (req, res, next) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0,7);

    const { rows: cardData } = await pool.query(`
      SELECT
        COALESCE(v.id::text, ii.plate) AS vehicle_key,
        COALESCE(v.name, ii.plate) AS vehicle_name,
        COALESCE(v.plate, ii.plate) AS plate,
        COALESCE(SUM(ii.gross_amount),0)::float AS card_gross,
        COALESCE(SUM(ii.net_amount),0)::float AS card_net,
        COALESCE(SUM(ii.liters),0)::float AS card_liters
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN vehicles v ON v.id = ii.vehicle_id
      WHERE i.month = $1
      GROUP BY v.id, v.name, v.plate, ii.plate
      ORDER BY COALESCE(v.plate, ii.plate)
    `, [currentMonth]);

    const { rows: pumpData } = await pool.query(`
      SELECT
        v.id::text AS vehicle_key,
        v.name AS vehicle_name,
        v.plate AS plate,
        COALESCE(SUM(r.total),0)::float AS pump_total,
        COALESCE(SUM(r.liters),0)::float AS pump_liters,
        COUNT(r.id)::int AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
        AND TO_CHAR(r.date,'YYYY-MM') = $1
      GROUP BY v.id, v.name, v.plate
      ORDER BY v.plate
    `, [currentMonth]);

    const { rows: bySupplier } = await pool.query(`
      SELECT
        s.name AS supplier_name, s.currency,
        COALESCE(SUM(ii.gross_amount),0)::float AS total_gross,
        COALESCE(SUM(ii.net_amount),0)::float AS total_net,
        COALESCE(SUM(ii.liters),0)::float AS total_liters
      FROM invoices i
      JOIN fuel_suppliers s ON s.id = i.supplier_id
      JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE i.month = $1
      GROUP BY s.id, s.name, s.currency
      ORDER BY total_gross DESC
    `, [currentMonth]);

    const { rows: months } = await pool.query('SELECT DISTINCT month FROM invoices ORDER BY month DESC LIMIT 12');
    res.json({ month: currentMonth, card_data: cardData, pump_data: pumpData, by_supplier: bySupplier, available_months: months.map(m => m.month) });
  } catch(err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { month } = req.query;
    const vals = month ? [month] : [];
    const where = month ? 'WHERE i.month=$1' : '';
    const { rows } = await pool.query(`
      SELECT i.*, s.name AS supplier_name, s.currency AS supplier_currency,
        COUNT(ii.id)::int AS item_count,
        COALESCE(SUM(ii.gross_amount),0)::float AS total_gross,
        COALESCE(SUM(ii.net_amount),0)::float AS total_net,
        COALESCE(SUM(ii.liters),0)::float AS total_liters,
        COALESCE(SUM(ii.discount_amount),0)::float AS total_discount
      FROM invoices i
      JOIN fuel_suppliers s ON s.id = i.supplier_id
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      ${where}
      GROUP BY i.id, s.name, s.currency
      ORDER BY i.month DESC, s.name
    `, vals);
    res.json(rows);
  } catch(err) { next(err); }
});

router.get('/:id/items', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT ii.*, v.name AS vehicle_name FROM invoice_items ii
      LEFT JOIN vehicles v ON v.id = ii.vehicle_id
      WHERE ii.invoice_id=$1 ORDER BY ii.plate
    `, [req.params.id]);
    res.json(rows);
  } catch(err) { next(err); }
});

router.post('/scan', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });
    const { supplier_id, month, eur_rate } = req.body;
    const { rows: vehicles } = await pool.query('SELECT id, name, plate FROM vehicles ORDER BY plate');
    const platesStr = vehicles.map(v => v.plate).join(', ');
    const { rows: suppliers } = await pool.query('SELECT * FROM fuel_suppliers WHERE id=$1', [supplier_id]);
    const supplier = suppliers[0] || { name: 'Nieznany', currency: 'PLN' };
    const currency = req.body.invoice_currency || supplier.currency || 'EUR';
    const eurRate = parseFloat(eur_rate) || 4.25;

    const plateMap = {};
    vehicles.forEach(v => { plateMap[v.plate.toUpperCase().replace(/\s/g,'')] = v; });
    const toPln = (v) => (v == null ? null : (currency === 'PLN' ? v : Math.round(v * eurRate * 100) / 100));
    const ratePerL = (v) => (v == null ? null : (currency === 'PLN' ? v : Math.round(v * eurRate * 10000) / 10000));
    const buildItem = (plate, liters, net, gross, pricePerL, discPerL) => {
      const vehicle = plateMap[(plate || '').toUpperCase().replace(/\s/g,'')];
      const L = (liters != null && !isNaN(liters)) ? liters : null;
      const dPl = (discPerL != null && !isNaN(discPerL)) ? discPerL : null;
      return {
        plate, vehicle_id: vehicle ? vehicle.id : null, vehicle_name: vehicle ? vehicle.name : null,
        liters: L, net_amount: toPln(net), gross_amount: toPln(gross),
        price_per_l: (pricePerL != null && !isNaN(pricePerL)) ? pricePerL : null,
        discount_per_l: dPl,
        discount_amount: (dPl != null && L != null) ? Math.round(dPl * L * 100) / 100 : null
      };
    };

    const isCsv = req.file.mimetype === 'text/csv' || req.file.originalname.match(/\.csv$/i);

    // ── Sciezka CSV (Citronex itp.) — deterministycznie, bez AI ──
    if (isCsv) {
      const rows = parseInvoiceCsv(req.file.buffer.toString('utf8'));
      const items = rows.map(r => buildItem(r.plate, r.liters, r.net, r.gross, null, ratePerL(r.discount)));
      return res.json({ ok: true, items, supplier, currency, eur_rate: eurRate, source: 'csv' });
    }

    // ── Sciezka AI (PDF / Excel / zdjecie-screen) ──
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.match(/\.pdf$/i);
    const isExcel = req.file.originalname.match(/\.xlsx?$/i);
    let mediaType = req.file.mimetype;
    if (isExcel) mediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const fileContent = isPdf || isExcel
      ? [{ type: 'document', source: { type: 'base64', media_type: mediaType, data: req.file.buffer.toString('base64') } }]
      : [{ type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') } }];

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [...fileContent, {
          type: 'text',
          text: 'Faktura od: ' + supplier.name + ' (waluta: ' + currency + ').\nTablice we flocie: ' + platesStr + '\n\n' +
            'Wyciagnij per pojazd (po nr rejestracyjnym), sumujac wszystkie tankowania danego auta w JEDNA pozycje:\n' +
            '- plate: nr rejestracyjny\n' +
            '- liters: laczna ilosc litrow. UWAGA AS24: uzyj kolumny "Ilosc" (realne litry) — NIE kolumny "Litry"/"Litry 100 Km", bo to srednie spalanie L/100km, nie litry!\n' +
            '- net_amount: kwota netto (bez VAT) w ' + currency + '\n' +
            '- gross_amount: kwota brutto (z VAT) w ' + currency + '\n' +
            '- price_per_l: cena za litr w ' + currency + '\n' +
            '- discount_per_l: rabat na litr w ' + currency + ' (AS24: kolumna "Rabat brutto"; null gdy brak rabatu)\n\n' +
            'Odpowiedz TYLKO JSON:\n{"items": [{"plate": "ABC123", "liters": 100.0, "net_amount": 500.0, "gross_amount": 615.0, "price_per_l": 6.15, "discount_per_l": 0.55}]}'
        }]
      }]
    });

    const text = response.content[0].text.trim();
    let parsed = { items: [] };
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch(e) { const match = text.match(/\{[\s\S]*\}/); if (match) { try { parsed = JSON.parse(match[0]); } catch(e2) {} } }

    const items = (parsed.items || []).map(item => buildItem(
      item.plate,
      parseFloat(item.liters),
      parseFloat(item.net_amount) || 0,
      parseFloat(item.gross_amount) || 0,
      item.price_per_l != null ? parseFloat(item.price_per_l) : null,
      ratePerL(item.discount_per_l != null ? parseFloat(item.discount_per_l) : null)
    ));

    res.json({ ok: true, items, supplier, currency, eur_rate: eurRate, source: 'ai' });
  } catch(err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { supplier_id, invoice_no, month, eur_rate, invoice_currency, notes, items } = req.body;
    if (!supplier_id || !month || !items || !items.length) return res.status(400).json({ error: 'Brak wymaganych pol' });
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      const { rows: inv } = await conn.query(
        'INSERT INTO invoices (supplier_id, invoice_no, month, currency, eur_rate, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [supplier_id, invoice_no||null, month, invoice_currency||'EUR', eur_rate||null, notes||null]
      );
      const invoiceId = inv[0].id;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        await conn.query('INSERT INTO invoice_items (invoice_id, vehicle_id, plate, liters, net_amount, gross_amount, price_per_l, discount_per_l, discount_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [invoiceId, item.vehicle_id||null, item.plate, item.liters||null, item.net_amount||null, item.gross_amount||null, item.price_per_l||null, item.discount_per_l||null, item.discount_amount||null]);
      }
      await conn.query('COMMIT');
      res.status(201).json({ ok: true, invoice_id: invoiceId });
    } catch(e) { await conn.query('ROLLBACK'); throw e; }
    finally { conn.release(); }
  } catch(err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try { await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]); res.status(204).end(); }
  catch(err) { next(err); }
});

module.exports = router;
