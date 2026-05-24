const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
});

pool.query('SELECT NOW()')
  .then(r => console.log('✅ DB connected:', r.rows[0]))
  .catch(e => console.log('❌ Error:', e.message));

pool.query('SELECT NOW()')
  .then(r => console.log('✅ DB connected:', r.rows[0]))
  .catch(async e => {
    console.log('❌ First attempt failed:', e.message);
    console.log('Retrying in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
    pool.query('SELECT NOW()')
      .then(r => console.log('✅ DB connected on retry:', r.rows[0]))
      .catch(e2 => console.log('❌ Retry failed:', e2.message));
  });