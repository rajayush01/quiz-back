const express = require("express");

const router =
  express.Router();

const {
  submitQuiz,
  getResult
} = require(
  "../controllers/submissionController"
);

router.post(
  "/submit",
  submitQuiz
);

router.get(
  "/result/:id",
  getResult
);

module.exports = router;