const router = require('express').Router();
const { pool } = require('../db/init');

// GET /api/drivers
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*,
        COUNT(r.id)::int AS refuel_count,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost
      FROM drivers d
      LEFT JOIN refuels r ON r.driver_id = d.id
      WHERE d.active = true
      GROUP BY d.id
      ORDER BY d.name
    `);
    res.json(rows);
  } catch(err) { next(err); }
});

// POST /api/drivers
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Brak nazwy' });
    const { rows } = await pool.query(
      'INSERT INTO drivers (name) VALUES ($1) RETURNING *', [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// PUT /api/drivers/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, active } = req.body;
    const fields = [], vals = [];
    let i = 1;
    if (name !== undefined) { fields.push(`name=$${i++}`); vals.push(name.trim()); }
    if (active !== undefined) { fields.push(`active=$${i++}`); vals.push(active); }
    if (!fields.length) return res.status(400).json({ error: 'Brak pol' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE drivers SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// DELETE /api/drivers/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('UPDATE drivers SET active=false WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch(err) { next(err); }
});

module.exports = router;
