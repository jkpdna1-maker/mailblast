require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='scheduled_jobs'")
  .then(r => { console.log(r.rows); process.exit(); })
  .catch(e => { console.error(e.message); process.exit(1); });
