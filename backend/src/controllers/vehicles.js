const { pool } = require('../db/init');

const getAll = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*,
        COUNT(r.id)::int          AS refuel_count,
        COALESCE(SUM(r.liters),0) AS total_liters,
        COALESCE(SUM(r.total),0)  AS total_cost,
        MAX(r.mileage)            AS last_mileage
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
      GROUP BY v.id
      ORDER BY v.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vehicles WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { name, plate, year, fuel_type, mileage, vin } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO vehicles (name, plate, year, fuel_type, mileage, vin)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, plate.toUpperCase(), year || null, fuel_type || 'PB95', mileage || 0, vin || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Plate already exists' });
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const fields = [];
    const vals = [];
    let i = 1;
    const allowed = ['name','plate','year','fuel_type','mileage','vin'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key}=$${i++}`);
        vals.push(key === 'plate' ? req.body[key].toUpperCase() : req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE vehicles SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM vehicles WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
};

module.exports = { getAll, getOne, create, update, remove };
