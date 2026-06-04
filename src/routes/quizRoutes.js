const express = require("express");

const router = express.Router();

const adminAuth =
  require("../middleware/adminAuth");

const {
  createQuiz,
  getQuizzes,
  getQuizById,
  updateQuiz,
  deleteQuiz,
  activateQuiz,
  getActiveQuiz,
  startQuiz,
} = require(
  "../controllers/quizController"
);

router.get("/active", getActiveQuiz);

router.post("/start", startQuiz);

router.use(adminAuth);

router.post("/", createQuiz);

router.get("/", getQuizzes);

router.get("/:id", getQuizById);

router.put("/:id", updateQuiz);

router.delete("/:id", deleteQuiz);

router.patch(
  "/:id/activate",
  activateQuiz
);

module.exports = router;
