// routes/openQuestionRoutes.js

const express   = require("express");
const router    = express.Router();
const adminAuth = require("../middleware/adminAuth");

const {
  setOpenQuestion,
  getActiveOpenQuestion,
  getOpenResponses,
  deleteOpenQuestion,
  getCandidateOpenQuestion,
  submitOpenResponse,
} = require("../controllers/openQuestionController");

// ── Public (candidate) ────────────────────────────────────────────────────
// GET  /api/open-question         → fetch the current active open question
// POST /api/open-question/respond → submit a candidate answer
router.get("/",        getCandidateOpenQuestion);
router.post("/respond", submitOpenResponse);

// ── Admin-protected ───────────────────────────────────────────────────────
// POST   /api/open-question/admin          → set / replace the active question
// GET    /api/open-question/admin/responses → view all responses
// DELETE /api/open-question/admin          → delete question + its responses
router.post(  "/admin",            adminAuth, setOpenQuestion);
router.get(   "/admin/responses",  adminAuth, getOpenResponses);
router.delete("/admin",            adminAuth, deleteOpenQuestion);

// Admin can also GET the active question while authenticated
router.get("/admin", adminAuth, getActiveOpenQuestion);

module.exports = router;