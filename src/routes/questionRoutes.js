const express = require("express");

const router = express.Router();

const adminAuth =
  require("../middleware/adminAuth");

const {
  createQuestion,
  getQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
} = require(
  "../controllers/questionController"
);

router.use(adminAuth);

router.post("/", createQuestion);

router.get("/", getQuestions);

router.get("/:id", getQuestionById);

router.put("/:id", updateQuestion);

router.delete("/:id", deleteQuestion);

module.exports = router;