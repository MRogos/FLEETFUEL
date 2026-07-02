const { pool } = require('../db/init');

const dashboard = async (req, res, next) => {
  try {
    const { month } = req.query;
    const where = month ? `WHERE TO_CHAR(date,'YYYY-MM') = '${month}'` : '';
    const [vehicles, refuels, costs] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM vehicles'),
      pool.query(`SELECT COUNT(*)::int AS count FROM refuels ${where}`),
      pool.query(`SELECT COALESCE(SUM(liters),0) AS total_liters, COALESCE(SUM(total),0) AS total_cost FROM refuels ${where}`),
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
      SELECT TO_CHAR(date,'YYYY-MM') AS month,
        COALESCE(SUM(liters),0)::float AS total_liters,
        COALESCE(SUM(total),0)::float AS total_cost,
        COUNT(*)::int AS refuel_count
      FROM refuels
      WHERE date >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `);
    res.json(rows);
  } catch (err) { next(err); }
};

const perVehicle = async (req, res, next) => {
  try {
    const { month } = req.query;
    const having = month ? `AND TO_CHAR(r.date,'YYYY-MM') = '${month}'` : '';
    const { rows } = await pool.query(`
      SELECT v.id, v.name, v.plate, v.fuel_type,
        COUNT(r.id)::int AS refuel_count,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost,
        CASE WHEN SUM(r.liters)>0 AND SUM(r.total)>0
             THEN (SUM(r.total)/SUM(r.liters))::numeric(8,4) ELSE NULL END AS avg_price_per_l,
        MIN(r.mileage) AS min_mileage,
        MAX(r.mileage) AS max_mileage
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id = v.id ${having}
      GROUP BY v.id ORDER BY v.plate
    `);
    // Spalanie zawsze z wszystkich danych (nie filtrowane po miesiacu)
    for (const row of rows) {
      const { rows: vr } = await pool.query(
        'SELECT liters, mileage, is_full FROM refuels WHERE vehicle_id=$1 AND mileage IS NOT NULL ORDER BY mileage',
        [row.id]
      );
      if (vr.length >= 2) {
        const segs = [];
        for (let i = 1; i < vr.length; i++) {
          if (vr[i].is_full === false || vr[i-1].is_full === false) continue;
          const hasPartial = vr.some((x,j) => j > i-1 && j < i && x.is_full === false);
          if (hasPartial) continue;
          const dist = vr[i].mileage - vr[i-1].mileage;
          if (dist > 0 && dist < 5000) segs.push(parseFloat(vr[i].liters) / dist * 100);
        }
        row.avg_consumption = segs.length ? (segs.reduce((a,b)=>a+b)/segs.length).toFixed(2) : null;
      } else { row.avg_consumption = null; }
      row.km_range = row.min_mileage && row.max_mileage ? row.max_mileage - row.min_mileage : null;
    }
    res.json(rows);
  } catch (err) { next(err); }
};

const monthlyMileage = async (req, res, next) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0,7);

    const { rows: months } = await pool.query(`
      SELECT DISTINCT TO_CHAR(date,'YYYY-MM') AS month
      FROM refuels WHERE mileage IS NOT NULL
      ORDER BY month DESC LIMIT 24
    `);

    const { rows } = await pool.query(`
      SELECT
        v.id, v.name, v.plate,
        MIN(r.mileage) AS mileage_start,
        MAX(r.mileage) AS mileage_end,
        (MAX(r.mileage) - MIN(r.mileage)) AS km_driven,
        COUNT(r.id)::int AS refuel_count,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost
      FROM vehicles v
      JOIN refuels r ON r.vehicle_id = v.id
        AND r.mileage IS NOT NULL
        AND TO_CHAR(r.date,'YYYY-MM') = $1
      GROUP BY v.id, v.name, v.plate
      ORDER BY v.plate
    `, [currentMonth]);

    // Dla pojazdu z 1 tankowaniem - znajdz poprzedni przebieg
    for (const row of rows) {
      if (!row.km_driven || row.km_driven === 0) {
        const { rows: prev } = await pool.query(`
          SELECT mileage FROM refuels
          WHERE vehicle_id=$1 AND mileage IS NOT NULL
            AND TO_CHAR(date,'YYYY-MM') < $2
          ORDER BY mileage DESC LIMIT 1
        `, [row.id, currentMonth]);
        if (prev.length && prev[0].mileage) {
          row.mileage_start = prev[0].mileage;
          row.km_driven = row.mileage_end - prev[0].mileage;
        }
      }
    }

    res.json({ month: currentMonth, data: rows, available_months: months.map(m => m.month) });
  } catch (err) { next(err); }
};

const perDriver = async (req, res, next) => {
  try {
    const { month } = req.query;
    const dateFilter = month ? `AND TO_CHAR(r.date,'YYYY-MM') = '${month}'` : '';

    const { rows } = await pool.query(`
      SELECT d.id, d.name AS driver_name,
        COUNT(r.id)::int AS refuel_count,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost,
        COUNT(DISTINCT r.vehicle_id)::int AS vehicle_count,
        CASE WHEN SUM(r.liters)>0 AND SUM(r.total)>0
             THEN (SUM(r.total)/SUM(r.liters))::numeric(8,4) ELSE NULL END AS avg_price_per_l
      FROM drivers d
      LEFT JOIN refuels r ON r.driver_id = d.id ${dateFilter}
      WHERE d.active = true
      GROUP BY d.id, d.name
      ORDER BY total_liters DESC
    `);

    for (const row of rows) {
      const { rows: vr } = await pool.query(`
        SELECT r.liters, r.mileage, r.vehicle_id, r.is_full
        FROM refuels r
        WHERE r.driver_id=$1 AND r.mileage IS NOT NULL
        ORDER BY r.vehicle_id, r.mileage
      `, [row.id]);
      const byVehicle = {};
      vr.forEach(r => { (byVehicle[r.vehicle_id]=byVehicle[r.vehicle_id]||[]).push(r); });
      const segs = [];
      Object.values(byVehicle).forEach(arr => {
        for (let i = 1; i < arr.length; i++) {
          if (arr[i].is_full===false||arr[i-1].is_full===false) continue;
          const hasPartial = arr.some((x,j)=>j>i-1&&j<i&&x.is_full===false);
          if (hasPartial) continue;
          const dist = arr[i].mileage - arr[i-1].mileage;
          if (dist>0&&dist<5000) segs.push(parseFloat(arr[i].liters)/dist*100);
        }
      });
      row.avg_consumption = segs.length ? (segs.reduce((a,b)=>a+b)/segs.length).toFixed(2) : null;
    }
    res.json(rows);
  } catch (err) { next(err); }
};

const monthlyPerVehicle = async (req, res, next) => {
  try {
    const { rows: vehicles } = await pool.query('SELECT id, name, plate FROM vehicles ORDER BY plate');
    const { rows: months } = await pool.query(`
      SELECT DISTINCT TO_CHAR(date,'YYYY-MM') AS month
      FROM refuels WHERE date >= NOW() - INTERVAL '6 months'
      ORDER BY month
    `);
    const { rows: data } = await pool.query(`
      SELECT v.id AS vehicle_id, v.name AS vehicle_name, v.plate,
        TO_CHAR(r.date,'YYYY-MM') AS month,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost,
        COUNT(r.id)::int AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id=v.id AND r.date>=NOW()-INTERVAL '6 months'
      GROUP BY v.id, v.name, v.plate, TO_CHAR(r.date,'YYYY-MM')
      ORDER BY v.plate, month
    `);
    const currentMonth = new Date().toISOString().slice(0,7);
    const { rows: currentData } = await pool.query(`
      SELECT v.id AS vehicle_id, v.name AS vehicle_name, v.plate,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost,
        COUNT(r.id)::int AS refuel_count
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id=v.id AND TO_CHAR(r.date,'YYYY-MM')=$1
      GROUP BY v.id, v.name, v.plate ORDER BY total_liters DESC
    `, [currentMonth]);
    res.json({ vehicles, months: months.map(m=>m.month), data, current_month: currentMonth, current_data: currentData });
  } catch (err) { next(err); }
};

// Koszty per pojazd per miesiac (dla Porownania)
const costsPerVehicleMonth = async (req, res, next) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0,7);

    const { rows: months } = await pool.query(`
      SELECT DISTINCT TO_CHAR(date,'YYYY-MM') AS month
      FROM refuels ORDER BY month DESC LIMIT 24
    `);

    const { rows } = await pool.query(`
      SELECT
        v.id, v.plate, v.name,
        COUNT(r.id)::int AS refuel_count,
        COALESCE(SUM(r.liters),0)::float AS total_liters,
        COALESCE(SUM(r.total),0)::float AS total_cost,
        CASE WHEN SUM(r.liters)>0 AND SUM(r.total)>0
             THEN (SUM(r.total)/SUM(r.liters))::numeric(8,4) ELSE NULL END AS avg_price_per_l,
        MIN(r.mileage) AS mileage_start,
        MAX(r.mileage) AS mileage_end,
        (MAX(r.mileage)-MIN(r.mileage)) AS km_driven
      FROM vehicles v
      LEFT JOIN refuels r ON r.vehicle_id=v.id
        AND TO_CHAR(r.date,'YYYY-MM')=$1
      GROUP BY v.id, v.plate, v.name
      ORDER BY v.plate
    `, [currentMonth]);

    const totalCost = rows.reduce((s,r)=>s+(r.total_cost||0),0);
    const totalLiters = rows.reduce((s,r)=>s+(r.total_liters||0),0);

    res.json({
      month: currentMonth,
      data: rows,
      summary: { total_cost: totalCost, total_liters: totalLiters, vehicle_count: rows.filter(r=>r.refuel_count>0).length },
      available_months: months.map(m=>m.month),
    });
  } catch (err) { next(err); }
};

module.exports = { dashboard, monthly, perVehicle, monthlyMileage, perDriver, monthlyPerVehicle, costsPerVehicleMonth };
