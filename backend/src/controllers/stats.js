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

// Spalanie per pojazd per miesiac (ostatnie 6 miesiecy)
const monthlyPerVehicle = async (req, res, next) => {
  try {
    // Pobierz wszystkie pojazdy
    const { rows: vehicles } = await pool.query('SELECT id, name, plate FROM vehicles ORDER BY name');

    // Pobierz ostatnie 6 miesiecy
    const { rows: months } = await pool.query(`
      SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') AS month
      FROM refuels
      WHERE date >= NOW() - INTERVAL '6 months'
      ORDER BY month
    `);

    // Pobierz litry per pojazd per miesiac
    const { rows: data } = await pool.query(`
      SELECT
        v.id AS vehicle_id,
        v.name AS vehicle_name,
        v.plate,
        TO_CHAR(r.date, 'YYYY-MM') AS month,
        COALESCE(SUM(r.liters), 0)::float AS total_liters,
        COALESCE(SUM(r.total), 0)::float  AS total_cost,
        COUNT(r.id)::int                  AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
        AND r.date >= NOW() - INTERVAL '6 months'
      GROUP BY v.id, v.name, v.plate, TO_CHAR(r.date, 'YYYY-MM')
      ORDER BY v.name, month
    `);

    // Aktualny miesiac - litry per pojazd
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { rows: currentData } = await pool.query(`
      SELECT
        v.id AS vehicle_id,
        v.name AS vehicle_name,
        v.plate,
        COALESCE(SUM(r.liters), 0)::float AS total_liters,
        COALESCE(SUM(r.total), 0)::float  AS total_cost,
        COUNT(r.id)::int                  AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id
        AND TO_CHAR(r.date, 'YYYY-MM') = $1
      GROUP BY v.id, v.name, v.plate
      ORDER BY total_liters DESC
    `, [currentMonth]);

    res.json({
      vehicles,
      months: months.map(m => m.month),
      data,
      current_month: currentMonth,
      current_data: currentData,
    });
  } catch (err) { next(err); }
};

module.exports = { dashboard, monthly, perVehicle, monthlyPerVehicle };
