const express = require("express");
const router = express.Router();

const adminAuth =
  require("../middleware/adminAuth");

const {
  getAllResults,
  getResultByAttempt,
  getLeaderboard,
  getQuizStats,
} = require(
  "../controllers/adminResultController"
);

router.use(adminAuth);

router.get("/results", getAllResults);

router.get(
  "/results/leaderboard",
  getLeaderboard
);

router.get(
  "/results/stats",
  getQuizStats
);

router.get(
  "/results/:attemptId",
  getResultByAttempt
);

module.exports = router;