import express from "express";
import protectTechnician from "../middlewares/protectTechnician.mjs";
import * as technicianPendingService from "../services/technicianPendingService.mjs";

const router = express.Router();


/* =========================================================
   GET Pending Jobs
========================================================= */

router.get("/pending", protectTechnician, async (req, res) => {
  try {

    const jobs = await technicianPendingService.getPendingJobs();

    res.json(jobs);

  } catch (error) {
    console.error("Error fetching pending jobs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/* =========================================================
   GET In Progress Jobs
========================================================= */

router.get("/in-progress", protectTechnician, async (req, res) => {
  try {

    const technicianId = req.user.id;

    const jobs = await technicianPendingService.getInProgressJobs(technicianId);

    res.json(jobs);

  } catch (error) {
    console.error("Error fetching in-progress jobs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/* =========================================================
   GET Job Detail
========================================================= */

router.get("/job/:orderId", protectTechnician, async (req, res) => {
  try {

    const { orderId } = req.params;

    const job = await technicianPendingService.getJobDetail(orderId);

    if (!job) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(job);

  } catch (error) {
    console.error("Error fetching job detail:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/* =========================================================
   ACCEPT JOB
========================================================= */

router.patch("/accept/:orderId", protectTechnician, async (req, res) => {
  try {

    const { orderId } = req.params;
    const technicianId = req.user.id;

    const order = await technicianPendingService.acceptJob(orderId, technicianId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      message: "Job accepted successfully",
      order
    });

  } catch (error) {
    console.error("Error accepting job:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/* =========================================================
   COMPLETE JOB
========================================================= */

router.patch("/complete/:orderId", protectTechnician, async (req, res) => {
  try {

    const { orderId } = req.params;
    const technicianId = req.user.id;

    const order = await technicianPendingService.completeJob(orderId, technicianId);

    if (!order) {
      return res.status(404).json({
        error: "Order not found or not your job"
      });
    }

    res.json({
      message: "Job completed successfully",
      order
    });

  } catch (error) {
    console.error("Error completing job:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


/* =========================================================
   GET Counters
========================================================= */

router.get("/counters", protectTechnician, async (req, res) => {
  try {

    

    const technicianId = req.user.id

    const counters = await technicianPendingService.getCounters(technicianId)


    res.json(counters)

  } catch (error) {

    console.error("COUNTERS ERROR:", error)

    res.status(500).json({ error: "Internal Server Error" })
  }
})
export default router;