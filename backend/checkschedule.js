require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("SELECT scheduled_at, NOW() as now_val FROM scheduled_jobs WHERE status='pending'")
  .then(r => { console.log(r.rows); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
