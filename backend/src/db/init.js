const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Kolejnosc ma znaczenie: drivers PRZED refuels

      CREATE TABLE IF NOT EXISTS drivers (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        active      BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        plate       VARCHAR(20)  NOT NULL UNIQUE,
        year        INTEGER,
        fuel_type   VARCHAR(10)  DEFAULT 'ON',
        mileage     INTEGER      DEFAULT 0,
        vin         VARCHAR(50),
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refuels (
        id            SERIAL PRIMARY KEY,
        vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
        date          DATE    NOT NULL,
        fuel_type     VARCHAR(10) DEFAULT 'ON',
        liters        NUMERIC(8,3) NOT NULL,
        price_per_l   NUMERIC(8,4),
        total         NUMERIC(10,2),
        mileage       INTEGER,
        station       VARCHAR(100),
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS fuel_suppliers (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(50) NOT NULL,
        country     VARCHAR(5)  DEFAULT 'PL',
        currency    VARCHAR(5)  DEFAULT 'PLN',
        active      BOOLEAN     DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id            SERIAL PRIMARY KEY,
        supplier_id   INTEGER NOT NULL REFERENCES fuel_suppliers(id),
        invoice_no    VARCHAR(100),
        month         VARCHAR(7)   NOT NULL,
        currency      VARCHAR(5)   DEFAULT 'EUR',
        eur_rate      NUMERIC(8,4),
        gbp_rate      NUMERIC(8,4),
        uploaded_at   TIMESTAMPTZ  DEFAULT NOW(),
        notes         TEXT
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id            SERIAL PRIMARY KEY,
        invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        vehicle_id    INTEGER REFERENCES vehicles(id),
        plate         VARCHAR(20),
        liters        NUMERIC(10,3),
        net_amount    NUMERIC(10,2),
        gross_amount  NUMERIC(10,2),
        price_per_l   NUMERIC(8,4),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        sid    VARCHAR NOT NULL COLLATE "default",
        sess   JSON    NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      );

      -- Indeksy
      CREATE INDEX IF NOT EXISTS idx_refuels_vehicle_id ON refuels(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_refuels_date ON refuels(date);
      CREATE INDEX IF NOT EXISTS idx_refuels_driver_id ON refuels(driver_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_items_vehicle ON invoice_items(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_month ON invoices(month);
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions(expire);

      -- Domyslni dostawcy
      INSERT INTO fuel_suppliers (name, country, currency)
        SELECT * FROM (VALUES
          ('Citronex', 'PL', 'PLN'),
          ('Tankpool', 'DE', 'EUR'),
          ('AS24',     'FR', 'EUR'),
          ('TFC',      'DE', 'EUR'),
          ('CRT',      'DE', 'EUR')
        ) AS v(name, country, currency)
      WHERE NOT EXISTS (SELECT 1 FROM fuel_suppliers LIMIT 1);

      -- Migracje dla istniejacych baz
      DO $$ BEGIN
        ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'EUR';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TABLE refuels ADD COLUMN IF NOT EXISTS driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
