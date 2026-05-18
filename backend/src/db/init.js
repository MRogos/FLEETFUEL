const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        plate       VARCHAR(20)  NOT NULL UNIQUE,
        year        INTEGER,
        fuel_type   VARCHAR(10)  DEFAULT 'PB95',
        mileage     INTEGER      DEFAULT 0,
        vin         VARCHAR(50),
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refuels (
        id            SERIAL PRIMARY KEY,
        vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        date          DATE    NOT NULL,
        fuel_type     VARCHAR(10) DEFAULT 'PB95',
        liters        NUMERIC(8,3) NOT NULL,
        price_per_l   NUMERIC(8,4),
        total         NUMERIC(10,2),
        mileage       INTEGER,
        station       VARCHAR(100),
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_refuels_vehicle_id ON refuels(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_refuels_date ON refuels(date);
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
