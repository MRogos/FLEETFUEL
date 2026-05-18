const { pool } = require('../db/init');

const dashboard = async (req, res, next) => {
  try {
    const [vehicles, refuels, costs] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM vehicles'),
      pool.query('SELECT COUNT(*)::int AS count FROM refuels'),
      pool.query('SELECT COALESCE(SUM(liters),0) AS total_liters, COALESCE(SUM(total),0) AS total_cost FROM refuels'),
    ]);
    res.json({
      vehicle_count: vehicles.rows[0].count,
      refuel_count: refuels.rows[0].count,
      total_liters: parseFloat(costs.rows[0].total_liters),
      total_cost: parseFloat(costs.rows[0].total_cost),
    });
  } catch (err) { next(err); }
};

const monthly = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(date, 'YYYY-MM') AS month,
        COALESCE(SUM(liters), 0)::float  AS total_liters,
        COALESCE(SUM(total),  0)::float  AS total_cost,
        COUNT(*)::int                    AS refuel_count
      FROM refuels
      WHERE date >= NOW() - INTERVAL '12 months'
      GROUP BY month
      ORDER BY month
    `);
    res.json(rows);
  } catch (err) { next(err); }
};

const perVehicle = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        v.id, v.name, v.plate, v.fuel_type,
        COUNT(r.id)::int                      AS refuel_count,
        COALESCE(SUM(r.liters),0)::float      AS total_liters,
        COALESCE(SUM(r.total),0)::float       AS total_cost,
        CASE WHEN SUM(r.liters) > 0 AND SUM(r.total) > 0
             THEN (SUM(r.total)/SUM(r.liters))::numeric(8,4)
             ELSE NULL END                    AS avg_price_per_l,
        MIN(r.mileage)                        AS min_mileage,
        MAX(r.mileage)                        AS max_mileage
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
      GROUP BY v.id
      ORDER BY v.name
    `);

    // Calculate average consumption per vehicle using ordered refuels
    for (const row of rows) {
      const { rows: vr } = await pool.query(
        `SELECT liters, mileage FROM refuels WHERE vehicle_id=$1 AND mileage IS NOT NULL ORDER BY mileage`,
        [row.id]
      );
      if (vr.length >= 2) {
        const segs = [];
        for (let i = 1; i < vr.length; i++) {
          const dist = vr[i].mileage - vr[i-1].mileage;
          if (dist > 0) segs.push(parseFloat(vr[i].liters) / dist * 100);
        }
        row.avg_consumption = segs.length ? (segs.reduce((a,b)=>a+b)/segs.length).toFixed(2) : null;
      } else {
        row.avg_consumption = null;
      }
      row.km_range = row.min_mileage && row.max_mileage ? row.max_mileage - row.min_mileage : null;
    }

    res.json(rows);
  } catch (err) { next(err); }
};

module.exports = { dashboard, monthly, perVehicle };
