const router = require('express').Router();
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db/init');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /api/invoices/suppliers
router.get('/suppliers', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM fuel_suppliers WHERE active=true ORDER BY name');
    res.json(rows);
  } catch(err) { next(err); }
});

// GET /api/invoices — lista faktur
router.get('/', async (req, res, next) => {
  try {
    const { month } = req.query;
    const conds = month ? 'WHERE i.month=$1' : '';
    const vals = month ? [month] : [];
    const { rows } = await pool.query(`
      SELECT i.*, s.name AS supplier_name, s.currency AS supplier_currency,
        COUNT(ii.id)::int AS item_count,
        COALESCE(SUM(ii.gross_amount),0)::float AS total_gross,
        COALESCE(SUM(ii.net_amount),0)::float AS total_net,
        COALESCE(SUM(ii.liters),0)::float AS total_liters
      FROM invoices i
      JOIN fuel_suppliers s ON s.id = i.supplier_id
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      ${conds}
      GROUP BY i.id, s.name, s.currency
      ORDER BY i.month DESC, s.name
    `, vals);
    res.json(rows);
  } catch(err) { next(err); }
});

// GET /api/invoices/:id/items
router.get('/:id/items', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT ii.*, v.name AS vehicle_name
      FROM invoice_items ii
      LEFT JOIN vehicles v ON v.id = ii.vehicle_id
      WHERE ii.invoice_id=$1
      ORDER BY ii.plate
    `, [req.params.id]);
    res.json(rows);
  } catch(err) { next(err); }
});

// POST /api/invoices/scan — skanuj fakture AI
router.post('/scan', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });

    const { supplier_id, month, eur_rate, gbp_rate } = req.body;

    // Pobierz pojazdy zeby AI moglo je dopasowac
    const { rows: vehicles } = await pool.query('SELECT id, name, plate FROM vehicles ORDER BY plate');
    const platesStr = vehicles.map(v => v.plate).join(', ');

    // Pobierz dostawce
    const { rows: suppliers } = await pool.query('SELECT * FROM fuel_suppliers WHERE id=$1', [supplier_id]);
    const supplier = suppliers[0] || { name: 'Nieznany', currency: 'PLN' };

    let fileContent;
    const isExcel = req.file.mimetype.includes('sheet') || req.file.originalname.match(/\.xlsx?$/i);
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.match(/\.pdf$/i);

    if (isExcel) {
      // Dla Excel - konwertuj do base64 i wyslij jako dokument
      fileContent = [{
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: req.file.buffer.toString('base64')
        }
      }];
    } else if (isPdf) {
      fileContent = [{
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: req.file.buffer.toString('base64')
        }
      }];
    } else {
      // Obraz
      fileContent = [{
        type: 'image',
        source: {
          type: 'base64',
          media_type: req.file.mimetype,
          data: req.file.buffer.toString('base64')
        }
      }];
    }

    const eurRate = parseFloat(eur_rate) || 4.25;
    const gbpRate = parseFloat(gbp_rate) || 5.00;
    const currency = supplier.currency || 'PLN';

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          ...fileContent,
          {
            type: 'text',
            text: `To jest faktura od dostawcy paliwa: ${supplier.name} (waluta: ${currency}).
Znane tablice rejestracyjne pojazdow w flocie: ${platesStr}

Wyciagnij dane per pojazd/rejestracja. Dla kazdego wiersza podaj:
- plate: numer rejestracyjny (dopasuj do listy powyzej jesli mozliwe)
- liters: ilosc paliwa w litrach (liczba)
- net_amount: kwota netto w ${currency}
- gross_amount: kwota brutto w ${currency}
- price_per_l: cena za litr w ${currency} (jesli widoczna, inaczej null)

Jezeli kwoty sa w EUR a faktura nie jest PLN, podaj w oryginalnej walucie (${currency}).
Kurs EUR/PLN: ${eurRate}, kurs GBP/PLN: ${gbpRate}

Odpowiedz TYLKO w JSON:
{"items": [{"plate": "DSR80682", "liters": 407.58, "net_amount": 3204.11, "gross_amount": 3812.93, "price_per_l": 9.35}]}

Jesli nie mozesz odczytac danych, zwroc {"items": [], "error": "opis problemu"}`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    let parsed = { items: [] };
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch(e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch(e2) {}
      }
    }

    // Dopasuj pojazdy po tablicach
    const plateMap = {};
    vehicles.forEach(v => { plateMap[v.plate.toUpperCase().replace(/\s/g,'')] = v; });

    const items = (parsed.items || []).map(item => {
      const plateClean = (item.plate || '').toUpperCase().replace(/\s/g,'');
      const vehicle = plateMap[plateClean];

      // Przelicz na PLN jesli trzeba
      let grossPln = parseFloat(item.gross_amount) || 0;
      let netPln = parseFloat(item.net_amount) || 0;
      if (currency === 'EUR') { grossPln *= eurRate; netPln *= eurRate; }
      if (currency === 'GBP') { grossPln *= gbpRate; netPln *= gbpRate; }

      return {
        plate: item.plate,
        vehicle_id: vehicle ? vehicle.id : null,
        vehicle_name: vehicle ? vehicle.name : null,
        liters: parseFloat(item.liters) || null,
        net_amount: parseFloat(netPln.toFixed(2)),
        gross_amount: parseFloat(grossPln.toFixed(2)),
        price_per_l: item.price_per_l ? parseFloat(item.price_per_l) : null,
        original_currency: currency,
        original_gross: parseFloat(item.gross_amount) || null,
      };
    });

    res.json({ ok: true, items, supplier, currency, eur_rate: eurRate, gbp_rate: gbpRate, raw_error: parsed.error });
  } catch(err) { next(err); }
});

// POST /api/invoices — zapisz fakture
router.post('/', async (req, res, next) => {
  try {
    const { supplier_id, invoice_no, month, eur_rate, gbp_rate, notes, items } = req.body;
    if (!supplier_id || !month || !items || !items.length) {
      return res.status(400).json({ error: 'Brak wymaganych pol' });
    }

    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');

      const { rows: inv } = await client2.query(
        `INSERT INTO invoices (supplier_id, invoice_no, month, eur_rate, gbp_rate, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [supplier_id, invoice_no || null, month, eur_rate || null, gbp_rate || null, notes || null]
      );
      const invoiceId = inv[0].id;

      for (const item of items) {
        await client2.query(
          `INSERT INTO invoice_items (invoice_id, vehicle_id, plate, liters, net_amount, gross_amount, price_per_l)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [invoiceId, item.vehicle_id || null, item.plate, item.liters || null,
           item.net_amount || null, item.gross_amount || null, item.price_per_l || null]
        );
      }

      await client2.query('COMMIT');
      res.status(201).json({ ok: true, invoice_id: invoiceId });
    } catch(e) {
      await client2.query('ROLLBACK');
      throw e;
    } finally {
      client2.release();
    }
  } catch(err) { next(err); }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch(err) { next(err); }
});

// GET /api/invoices/comparison — porownanie dystrybutor vs karta
router.get('/comparison', async (req, res, next) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0,7);

    // Koszty z kart (faktury) per pojazd
    const { rows: cardData } = await pool.query(`
      SELECT
        COALESCE(v.id::text, ii.plate) AS vehicle_key,
        COALESCE(v.name, ii.plate)     AS vehicle_name,
        COALESCE(v.plate, ii.plate)    AS plate,
        COALESCE(SUM(ii.gross_amount),0)::float AS card_gross,
        COALESCE(SUM(ii.net_amount),0)::float   AS card_net,
        COALESCE(SUM(ii.liters),0)::float       AS card_liters,
        COUNT(DISTINCT i.supplier_id)::int       AS supplier_count
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN vehicles v ON v.id = ii.vehicle_id
      WHERE i.month = $1
      GROUP BY vehicle_key, vehicle_name, plate
      ORDER BY plate
    `, [currentMonth]);

    // Koszty z dystrybutora (skan/recznie) per pojazd
    const { rows: pumpData } = await pool.query(`
      SELECT
        v.id::text AS vehicle_key,
        v.name     AS vehicle_name,
        v.plate    AS plate,
        COALESCE(SUM(r.total),0)::float  AS pump_total,
        COALESCE(SUM(r.liters),0)::float AS pump_liters,
        COUNT(r.id)::int                 AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
        AND TO_CHAR(r.date,'YYYY-MM') = $1
      GROUP BY v.id, v.name, v.plate
      ORDER BY v.plate
    `, [currentMonth]);

    // Sumy per dostawca
    const { rows: bySupplier } = await pool.query(`
      SELECT
        s.name AS supplier_name,
        s.currency,
        COALESCE(SUM(ii.gross_amount),0)::float AS total_gross,
        COALESCE(SUM(ii.net_amount),0)::float   AS total_net,
        COALESCE(SUM(ii.liters),0)::float       AS total_liters
      FROM invoices i
      JOIN fuel_suppliers s ON s.id = i.supplier_id
      JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE i.month = $1
      GROUP BY s.id, s.name, s.currency
      ORDER BY total_gross DESC
    `, [currentMonth]);

    // Dostepne miesiace
    const { rows: months } = await pool.query(`
      SELECT DISTINCT month FROM invoices ORDER BY month DESC LIMIT 12
    `);

    res.json({
      month: currentMonth,
      card_data: cardData,
      pump_data: pumpData,
      by_supplier: bySupplier,
      available_months: months.map(m => m.month),
    });
  } catch(err) { next(err); }
});

module.exports = router;
