// backend/src/routes/export.js
//
// Eksport tankowań dla panelu floty (raporty.vipremium.pl).
// Read-only. Autoryzacja nagłówkiem X-API-Key — klucz w zmiennej środowiskowej
// FLEET_EXPORT_KEY (ustaw tę samą wartość co FLEETFUEL_API_KEY w panelu).
//
// Podłączenie w backend/src/index.js:
//     const exportRoutes = require('./routes/export');
//     app.use('/api/export', exportRoutes);
//
// Test:
//     curl -H "X-API-Key: TWOJ_KLUCZ" \
//       "https://fleetfuel-vipremium.onrender.com/api/export/fuel?from=2026-01-01&to=2026-12-31"

const express = require('express');
const router = express.Router();
const { pool } = require('../db/init');

// prosty strażnik kluczem
function requireKey(req, res, next) {
  const key = process.env.FLEET_EXPORT_KEY || '';
  if (!key) return res.status(500).json({ error: 'Brak FLEET_EXPORT_KEY w środowisku FleetFuela' });
  if (req.get('X-API-Key') !== key) return res.status(401).json({ error: 'Zły klucz' });
  next();
}

// GET /api/export/fuel?from=YYYY-MM-DD&to=YYYY-MM-DD
// Zwraca płaską listę tankowań. Agregację (koszty per miesiąc, km z liczników)
// robi panel — tu tylko surowe dane.
router.get('/fuel', requireKey, async (req, res) => {
  try {
    const from = req.query.from || '2000-01-01';
    const to   = req.query.to   || '2100-12-31';

    const q = await pool.query(
      `SELECT
         r.id,
         v.plate,
         r.date,
         r.liters,
         r.total,
         r.mileage,
         r.station,
         r.is_full,
         r.fuel_type
       FROM refuels r
       JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.date >= $1 AND r.date <= $2
       ORDER BY r.date, r.id`,
      [from, to]
    );

    const refuels = q.rows.map(x => ({
      id: x.id,
      plate: x.plate,
      date: (x.date instanceof Date) ? x.date.toISOString().slice(0, 10) : String(x.date).slice(0, 10),
      liters: x.liters != null ? Number(x.liters) : null,
      total: x.total != null ? Number(x.total) : 0,
      mileage: x.mileage != null ? Number(x.mileage) : null,
      station: x.station || null,
      full_refuel: x.is_full !== false,
      fuel_type: x.fuel_type || null,
    }));

    res.json({ count: refuels.length, from, to, refuels });
  } catch (e) {
    console.error('export/fuel:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
