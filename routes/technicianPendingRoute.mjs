import express from "express";
import protectTechnician from "../middlewares/protectTechnician.mjs";
import * as technicianPendingService from "../services/technicianPendingService.mjs";

const router = express.Router();



/* =========================================================
   GET Pending Jobs
========================================================= */

router.get("/pending", protectTechnician, async (req, res) => {

  try {

    const technicianId = req.user.id;

    const jobs = await technicianPendingService.getPendingJobs(technicianId);

    res.json(jobs);

  } catch (error) {

    console.error("GET PENDING JOBS ERROR:", error);

    res.status(500).json({
      error: "Internal Server Error"
    });

  }

});



/* =========================================================
   GET Job Detail
========================================================= */

router.get("/job/:orderId", protectTechnician, async (req, res) => {

  try {

    const orderId = Number(req.params.orderId);
    const technicianId = req.user.id;

    if (!orderId) {

      return res.status(400).json({
        error: "Invalid orderId"
      });

    }

    const job = await technicianPendingService.getJobDetail(
      orderId,
      technicianId
    );

    if (!job) {

      return res.status(404).json({
        error: "Job not found"
      });

    }

    res.json(job);

  } catch (error) {

    console.error("GET JOB DETAIL ERROR:", error);

    res.status(500).json({
      error: "Internal Server Error"
    });

  }

});



/* =========================================================
   COMPLETE JOB
========================================================= */

router.patch("/complete/:orderId", protectTechnician, async (req, res) => {

  try {

    const orderId = Number(req.params.orderId);
    const technicianId = req.user.id;

    if (!orderId) {

      return res.status(400).json({
        error: "Invalid orderId"
      });

    }

    const result = await technicianPendingService.completeJob(
      orderId,
      technicianId
    );

    res.json({
      message: "Job completed successfully",
      result
    });

  } catch (error) {

    console.error("COMPLETE JOB ERROR:", error);

    res.status(500).json({
      error: "Internal Server Error"
    });

  }

});



/* =========================================================
   GET Counters
========================================================= */

router.get("/counters", protectTechnician, async (req, res) => {

  try {

    const technicianId = req.user.id;

    const counters = await technicianPendingService.getCounters(technicianId);

    res.json(counters);

  } catch (error) {

    console.error("GET COUNTERS ERROR:", error);

    res.status(500).json({
      error: "Internal Server Error"
    });

  }

});



export default router;