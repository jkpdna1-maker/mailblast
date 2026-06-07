require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("DELETE FROM scheduled_jobs WHERE status='pending'")
  .then(r => { console.log('Deleted rows:', r.rowCount); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
