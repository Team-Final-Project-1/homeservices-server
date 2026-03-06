import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import postServiceValidate from "../middlewares/postServiceValidate.mjs";

let supabase;

const getSupabase = () => {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );
  }
  return supabase;
};

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
        COUNT(DISTINCT order_items.id) AS order_count,
        MIN(service_items.price_per_unit) AS min_price,
        MAX(service_items.price_per_unit) AS max_price
      FROM services
      LEFT JOIN categories ON services.category_id = categories.id
      LEFT JOIN reviews ON reviews.service_id = services.id
      LEFT JOIN order_items ON order_items.service_id = services.id
      LEFT JOIN service_items ON service_items.service_id = services.id
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
      query += ` AND service_items.price_per_unit >= $${paramIndex}`;
      params.push(min_price);
      paramIndex++;
    }

    if (max_price) {
      query += ` AND service_items.price_per_unit <= $${paramIndex}`;
      params.push(max_price);
      paramIndex++;
    }

    // GROUP BY ต้องใส่เพราะมี AVG และ COUNT
    query += ` GROUP BY services.id, categories.name, categories.name_th`;

    // คัดกรองตาม filter พิเศษ
    if (filter === "recommended") {
      // rating เฉลี่ย >= 4 ถือว่าแนะนำ
      query += ` HAVING COALESCE(AVG(reviews.rating), 0) >= 4`;
    }

    // 🔤 Sort
    const allowedSortBy = ["name", "created_at"];
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
      sortColumn = (() => {
        if (sort_by === "price") return "min_price";
        if (allowedSortBy.includes(sort_by)) return `services.${sort_by}`;
        return "services.created_at";
      })();
      sortOrder = ["ASC", "DESC"].includes(order?.toUpperCase())
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

// GET /api/services/:id - ดึงข้อมูลบริการตาม ID พร้อม items
serviceRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const response = await connectionPool.query(
      `SELECT
        services.*,
        categories.name AS category_name,
        categories.name_th AS category_name_th,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', si.id,
              'name', si.name,
              'price_per_unit', si.price_per_unit,
              'unit', si.unit
            ) ORDER BY si.id
          ) FILTER (WHERE si.id IS NOT NULL),
          '[]'
        ) AS items
      FROM services
      LEFT JOIN categories ON services.category_id = categories.id
      LEFT JOIN service_items si ON si.service_id = services.id
      WHERE services.id = $1
      GROUP BY services.id, categories.name, categories.name_th`,
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
serviceRouter.post(
  "/",
  imageFileUpload,
  postServiceValidate,
  async (req, res) => {
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
  },
);

// PUT /api/services/:id - อัปเดตบริการตาม ID
serviceRouter.put("/:id", imageFileUpload, async (req, res) => {
  const { id } = req.params;
  const { name, description, price, category_id } = req.body;
  try {
    const response = await connectionPool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    // จัดการรูปภาพ
    // ถ้ามีไฟล์ใหม่ส่งมา → upload ใหม่, ถ้าไม่มี → ใช้รูปเดิม
    let imageUrl = existing.rows[0].image;

    if (req.files?.imageFile?.[0]) {
      const file = req.files.imageFile[0];
      const bucketName = "services-image";
      const fileExt = file.originalname.split(".").pop();
      const filePath = `services/${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucketName).getPublicUrl(uploadData.path);

      imageUrl = publicUrl;
    }

    // UPDATE ตาราง services
    const updateResponse = await connectionPool.query(
      `UPDATE services
       SET name = $1,
           description = $2,
           category_id = $3,
           image = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        name?.trim() ?? existing.rows[0].name,
        description ? description.trim() : existing.rows[0].description,
        category_id ? Number(category_id) : existing.rows[0].category_id,
        imageUrl,
        id,
      ],
    );

    const updatedService = updateResponse.rows[0];

    // UPDATE service_items
    // Strategy: ลบของเก่าทั้งหมด แล้ว insert ใหม่
    // เหตุผล: ง่ายกว่าการ diff ว่า item ไหนเพิ่ม/แก้/ลบ
    let updatedItems = [];

    if (parsedItems) {
      // ลบ items เดิมทั้งหมดของ service นี้
      await connectionPool.query(
        "DELETE FROM service_items WHERE service_id = $1",
        [id],
      );

      // Insert items ใหม่
      const values = [];
      const placeholders = parsedItems.map((item, index) => {
        const offset = index * 4;
        values.push(
          Number(id),
          item.name.trim(),
          Number(item.price_per_unit),
          item.unit.trim(),
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      });

      const itemsResult = await connectionPool.query(
        `INSERT INTO service_items (service_id, name, price_per_unit, unit)
         VALUES ${placeholders.join(", ")}
         RETURNING *`,
        values,
      );
      updatedItems = itemsResult.rows;
    } else {
      // ถ้าไม่ได้ส่ง items มา → ดึง items เดิมกลับไปให้ frontend
      const existingItems = await connectionPool.query(
        "SELECT * FROM service_items WHERE service_id = $1 ORDER BY id",
        [id],
      );
      updatedItems = existingItems.rows;
    }

    res.status(200).json({
      success: true,
      message: "อัปเดตบริการสำเร็จ",
      data: { ...updatedService, items: updatedItems },
    });
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
