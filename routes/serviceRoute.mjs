import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import postServiceValidate from "../middlewares/postServiceValidate.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const serviceRouter = Router();
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

    query += ` GROUP BY services.id, categories.name, categories.name_th`;

    const havingConditions = [];

    if (filter === "recommended") {
      havingConditions.push("COALESCE(AVG(reviews.rating), 0) >= 4");
    }

    if (min_price) {
      havingConditions.push(
        `MIN(service_items.price_per_unit) >= $${paramIndex}`,
      );
      params.push(Number(min_price));
      paramIndex++;
    }

    if (max_price) {
      havingConditions.push(
        `MAX(service_items.price_per_unit) <= $${paramIndex}`,
      );
      params.push(Number(max_price));
      paramIndex++;
    }

    if (havingConditions.length > 0) {
      query += ` HAVING ${havingConditions.join(" AND ")}`;
    }

    const sortMap = {
      price: "min_price",
      name: "services.name",
      created_at: "services.created_at",
      order_count: "order_count",
      avg_rating: "avg_rating",
    };

    let sortColumn;
    let sortOrder;

    if (filter === "popular") {
      sortColumn = sortMap["order_count"];
      sortOrder = "DESC";
    } else if (filter === "recommended") {
      sortColumn = sortMap["avg_rating"];
      sortOrder = "DESC";
    } else {
      sortColumn = sortMap[sort_by] ?? "services.created_at";
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

serviceRouter.get("/price-range", async (req, res) => {
  try {
    const { rows } = await connectionPool.query(`
      SELECT 
        FLOOR(MIN(price_per_unit)) AS min_price,
        CEIL(MAX(price_per_unit))  AS max_price
      FROM service_items
    `);
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error("Error fetching price range:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

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

serviceRouter.post(
  "/",
  protectAdmin,
  imageFileUpload,
  postServiceValidate,

  async (req, res) => {
    let createdServiceId = null;
    const bucketName = "services-image";
    let filePath;

    try {
      const { name, category_id, description } = req.body;
      const items = req.parsedItems;
      if (!req.files?.imageFile?.[0]) {
        return res.status(400).json({ error: "กรุณาอัปโหลดรูปภาพ" });
      }
      const file = req.files.imageFile[0];

      const fileExt = file.originalname.split(".").pop();
      filePath = `services/${Date.now()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (uploadError) {
        throw uploadError;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucketName).getPublicUrl(uploadData.path);
      const serviceResult = await connectionPool.query(
        `INSERT INTO services (name, category_id, description, image) VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          name.trim(),
          Number(category_id),
          description ? description.trim() : null,
          publicUrl,
        ],
      );
      const newService = serviceResult.rows[0];
      createdServiceId = newService.id;

      const values = [];
      const placeholders = items.map((item, index) => {
        const offset = index * 4;
        values.push(
          createdServiceId,
          item.name.trim(),
          Number(item.price_per_unit),
          item.unit.trim(),
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
      });
      try {
        const itemsResult = await connectionPool.query(
          `INSERT INTO service_items (service_id, name, price_per_unit, unit)
     VALUES ${placeholders.join(", ")}
     RETURNING *`,
          values,
        );
        res.status(201).json({
          success: true,
          message: "สร้างบริการสำเร็จ",
          data: {
            ...newService,
            items: itemsResult.rows,
          },
        });
      } catch (itemsError) {
        console.error(
          "Error inserting service items, rolling back:",
          itemsError,
        );
        await connectionPool.query(`DELETE FROM services WHERE id = $1`, [
          createdServiceId,
        ]);
        await supabase.storage.from(bucketName).remove([filePath]);
        throw itemsError;
      }
    } catch (error) {
      console.error("Error creating service:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

serviceRouter.put("/:id", protectAdmin, imageFileUpload, async (req, res) => {
  const { id } = req.params;
  let parsedItems = null;

  try {
    const { name, category_id, description, items } = req.body;
    if (items) {
      try {
        parsedItems = typeof items === "string" ? JSON.parse(items) : items;
      } catch {
        return res.status(400).json({ error: "items format invalid" });
      }

      if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
        return res
          .status(400)
          .json({ error: "ต้องมีรายการบริการย่อยอย่างน้อย 1 รายการ" });
      }
    }

    const existing = await connectionPool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

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

    let updatedItems = [];

    if (parsedItems) {
      await connectionPool.query(
        "DELETE FROM service_items WHERE service_id = $1",
        [id],
      );

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

serviceRouter.delete("/:id", protectAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await connectionPool.connect();

  try {
    const existing = await client.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    await client.query("BEGIN");

    await client.query("DELETE FROM service_items WHERE service_id = $1", [id]);
    await client.query(
      "DELETE FROM technician_services WHERE service_id = $1",
      [id],
    );
    await client.query("DELETE FROM reviews WHERE service_id = $1", [id]);
    await client.query("DELETE FROM services WHERE id = $1", [id]);

    await client.query("COMMIT");

    const imageUrl = existing.rows[0].image;
    if (imageUrl) {
      const filePath = imageUrl.split("/services-image/")[1];
      if (filePath) {
        try {
          await supabase.storage.from("services-image").remove([filePath]);
        } catch (storageError) {
          console.error("Failed to remove image from storage:", storageError);
        }
      }
    }

    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting service:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

export default serviceRouter;
