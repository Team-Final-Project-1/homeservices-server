import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log('✅ เชื่อมต่อ Supabase สำเร็จ!'))
  .catch(err => console.error('❌ เชื่อมต่อ Database ล้มเหลว:', err));

export default pool;