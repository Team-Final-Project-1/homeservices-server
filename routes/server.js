import express from 'express';
import cors from 'cors'; 
import pool from './db.mjs'; 

const app = express();
app.use(express.json());

// 3. อนุญาตให้ Frontend พอร์ต 3000 เข้าถึงข้อมูลได้
app.use(cors({ origin: 'http://localhost:3000' }));

app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

app.listen(5000, () => console.log('Server is running on port 5000'));