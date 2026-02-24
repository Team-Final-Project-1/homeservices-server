import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const serviceRouter = Router();
// เก็บไฟล์รูปภาพในแรมของเซิร์ฟเวอร์ เช็คขนาดและประเภทไฟล์ก่อนอัปโหลดไปยัง Supabase Storage
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and WebP images are allowed"), false);
    }
  },
});

const imageFileUpload = multerUpload.fields([
  { name: "imageFile", maxCount: 1 },
]);

// GET /api/services - ดึงข้อมูลบริการทั้งหมด
serviceRouter.get("/", async (req, res) => {
  try {
    const {
      search,
      category_id,
      min_price,
      max_price,
      sort_by,
      order,
      filter,
    } = req.query;

    let query = `
      SELECT
        services.*,
        categories.name AS category_name,
        categories.name_th AS category_name_th,
        COALESCE(AVG(reviews.rating), 0) AS avg_rating,
        COUNT(DISTINCT order_items.id) AS order_count
      FROM services
      LEFT JOIN categories ON services.category_id = categories.id
      LEFT JOIN reviews ON reviews.service_id = services.id
      LEFT JOIN order_items ON order_items.service_id = services.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (services.name ILIKE $${paramIndex} OR services.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category_id) {
      query += ` AND services.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }

    if (min_price) {
      query += ` AND services.price >= $${paramIndex}`;
      params.push(min_price);
      paramIndex++;
    }

    if (max_price) {
      query += ` AND services.price <= $${paramIndex}`;
      params.push(max_price);
      paramIndex++;
    }

    // GROUP BY ต้องใส่เพราะมี AVG และ COUNT
    query += ` GROUP BY services.id, categories.name, categories.name_th`;

    // 🌟 คัดกรองตาม filter พิเศษ
    if (filter === "recommended") {
      // rating เฉลี่ย >= 4 ถือว่าแนะนำ
      query += ` HAVING COALESCE(AVG(reviews.rating), 0) >= 4`;
    }

    // 🔤 Sort
    const allowedSortBy = ["name", "price", "created_at"];
    const allowedOrder = ["ASC", "DESC"];

    let sortColumn;
    let sortOrder;

    if (filter === "popular") {
      // ยอดนิยม = เรียงตามจำนวน order มากสุด
      sortColumn = "order_count";
      sortOrder = "DESC";
    } else if (filter === "recommended") {
      // แนะนำ = เรียงตาม rating สูงสุด
      sortColumn = "avg_rating";
      sortOrder = "DESC";
    } else {
      sortColumn = allowedSortBy.includes(sort_by)
        ? `services.${sort_by}`
        : "services.created_at";
      sortOrder = allowedOrder.includes(order?.toUpperCase())
        ? order.toUpperCase()
        : "ASC";
    }

    query += ` ORDER BY ${sortColumn} ${sortOrder}`;

    const response = await connectionPool.query(query, params);
    res.status(200).json(response.rows);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/services/:id - ดึงข้อมูลบริการตาม ID
serviceRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await connectionPool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (response.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }
    res.status(200).json(response.rows[0]);
  } catch (error) {
    console.error("Error fetching service:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/services - เพิ่มบริการใหม่
serviceRouter.post("/", imageFileUpload, async (req, res) => {
  try {
    // 1) รับข้อมูลจาก request body และไฟล์ที่อัปโหลด
    const newPost = req.body;
    const file = req.files.imageFile[0];
    // 2) กำหนด bucket และ path ที่จะเก็บไฟล์ใน Supabase
    const bucketName = "services-image";
    const filePath = `posts/${Date.now()}_${file.originalname}`; // สร้าง path ที่ไม่ซ้ำกัน
    // 3) อัปโหลดไฟล์ไปยัง Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false, // ป้องกันการเขียนทับไฟล์เดิม
      });
    if (error) {
      throw error;
    }
    // 4) ดึง URL สาธารณะของไฟล์ที่อัปโหลด
    const {
      data: { publicUrl },
    } = supabase.storage.from(bucketName).getPublicUrl(data.path);
    // 5) บันทึกข้อมูลโพสต์ลงในฐานข้อมูล
   
    // 6) ส่งผลลัพธ์กลับไปยัง client

  } catch (error) {
    console.error("Error creating service:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT /api/services/:id - อัปเดตบริการตาม ID
serviceRouter.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, description, price, category_id } = req.body;
  try {
    const response = await connectionPool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (response.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }
    const updateResponse = await connectionPool.query(
      "UPDATE services SET name = $1, description = $2, price = $3, category_id = $4 WHERE id = $5 RETURNING *",
      [name, description, price, category_id, id],
    );
    res.status(200).json(updateResponse.rows[0]);
  } catch (error) {
    console.error("Error updating service:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// DELETE /api/services/:id - ลบบริการตาม ID
serviceRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await connectionPool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (response.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }
    await connectionPool.query("DELETE FROM services WHERE id = $1", [id]);
    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default serviceRouter;
