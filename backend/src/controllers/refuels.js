const { pool } = require('../db/init');
const getAll = async (req, res, next) => {
  try {
    const { vehicle_id, fuel_type, month, driver_id } = req.query;
    const conds = [], vals = [];
    let i = 1;
    if (vehicle_id) { conds.push(`r.vehicle_id=$${i++}`); vals.push(vehicle_id); }
    if (fuel_type)  { conds.push(`r.fuel_type=$${i++}`); vals.push(fuel_type); }
    if (month)      { conds.push(`TO_CHAR(r.date,'YYYY-MM')=$${i++}`); vals.push(month); }
    if (driver_id)  { conds.push(`r.driver_id=$${i++}`); vals.push(driver_id); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(`
      SELECT r.*, v.name AS vehicle_name, v.plate AS vehicle_plate,
        d.name AS driver_name
      FROM refuels r
      JOIN vehicles v ON v.id = r.vehicle_id
      LEFT JOIN drivers d ON d.id = r.driver_id
      ${where}
      ORDER BY CASE WHEN r.mileage IS NULL THEN 1 ELSE 0 END, r.mileage DESC, r.date DESC
    `, vals);
    res.json(rows);
  } catch (err) { next(err); }
};
const getOne = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, v.name AS vehicle_name, v.plate AS vehicle_plate,
        d.name AS driver_name
      FROM refuels r
      JOIN vehicles v ON v.id=r.vehicle_id
      LEFT JOIN drivers d ON d.id=r.driver_id
      WHERE r.id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};
const create = async (req, res, next) => {
  try {
    const { vehicle_id, date, fuel_type, liters, price_per_l, total, mileage, driver_id, station, notes, is_full } = req.body;
    const finalTotal = total || (price_per_l && liters ? (price_per_l * liters).toFixed(2) : null);
    const { rows } = await pool.query(
      `INSERT INTO refuels (vehicle_id, date, fuel_type, liters, price_per_l, total, mileage, driver_id, station, notes, is_full)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [vehicle_id, date, fuel_type||'ON', liters, price_per_l||null, finalTotal, mileage||null, driver_id||null, station||null, notes||null, is_full !== false]
    );
    if (mileage) {
      await pool.query(
        'UPDATE vehicles SET mileage=$1 WHERE id=$2 AND (mileage IS NULL OR mileage < $1)',
        [mileage, vehicle_id]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
};
const update = async (req, res, next) => {
  try {
    const fields = [], vals = [];
    let i = 1;
    const allowed = ['date','fuel_type','liters','price_per_l','total','mileage','driver_id','station','notes','is_full'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key}=$${i++}`); vals.push(req.body[key]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE refuels SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
};
const remove = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM refuels WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) { next(err); }
};
module.exports = { getAll, getOne, create, update, remove };
