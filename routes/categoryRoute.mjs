import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";

const categoryRouter = Router();

// GET /api/categories - ดึงข้อมูลหมวดหมู่ทั้งหมด
categoryRouter.get("/", async (req, res) => {
  try {
    const result = await connectionPool.query("SELECT * FROM categories");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/categories/:id - ดึงข้อมูลหมวดหมู่ตาม ID
categoryRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await connectionPool.query(
      "SELECT * FROM categories WHERE id = $1",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/categories - สร้างหมวดหมู่ใหม่
categoryRouter.post("/", protectAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = await connectionPool.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING *",
      [name],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT /api/categories/:id - อัปเดตหมวดหมู่ตาม ID
categoryRouter.put("/:id", protectAdmin, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = await connectionPool.query(
      "UPDATE categories SET name = $1 WHERE id = $2 RETURNING *",
      [name, id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// DELETE /api/categories/:id - ลบหมวดหมู่ตาม ID
categoryRouter.delete("/:id", protectAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await connectionPool.query(
      "DELETE FROM categories WHERE id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default categoryRouter;
