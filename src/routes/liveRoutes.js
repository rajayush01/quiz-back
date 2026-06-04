const express = require("express");
const router  = express.Router();
const adminAuth = require("../middleware/adminAuth");

const {
  sseConnect,
  startLiveSession,
  pushNextQuestion,
  endCurrentQuestion,
  getLiveLeaderboard,
  getSessionState,
  joinLiveSession,
  submitLiveAnswer,
} = require("../controllers/liveController");

// ── Public (candidate) ────────────────────────────────────────────────────
// SSE stream — candidates connect here to receive real-time events
router.get("/stream",       sseConnect);

// Candidate joins the session (creates QuizAttempt)
router.post("/join",        joinLiveSession);

// Candidate submits answer for the current live question
router.post("/answer",      submitLiveAnswer);

// Current session state (for late joiners / page refresh)
router.get("/state",        getSessionState);

// ── Admin-protected ───────────────────────────────────────────────────────
router.post("/start",       adminAuth, startLiveSession);
router.post("/next",        adminAuth, pushNextQuestion);
router.post("/end-question",adminAuth, endCurrentQuestion);
router.get("/leaderboard",  adminAuth, getLiveLeaderboard);

module.exports = router;