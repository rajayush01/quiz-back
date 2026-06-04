const Question = require("../models/Question");

const createQuestion = async (req, res) => {
  try {
    const {
      question,
      type,
      options,
      correctAnswer,
      marks,
    } = req.body;

    if (!question || !type || !correctAnswer) {
      return res.status(400).json({
        message: "Missing fields",
      });
    }

    if (
      type === "mcq" &&
      (!options || options.length < 2)
    ) {
      return res.status(400).json({
        message: "MCQ requires options",
      });
    }

    const newQuestion =
      await Question.create({
        question,
        type,
        options,
        correctAnswer,
        marks,
        createdBy: req.admin._id,
      });

    res.status(201).json(newQuestion);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getQuestions = async (req, res) => {
  try {
    const questions =
      await Question.find()
        .sort({ createdAt: -1 });

    res.json(questions);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getQuestionById = async (
  req,
  res
) => {
  try {
    const question =
      await Question.findById(
        req.params.id
      );

    if (!question) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    res.json(question);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const updateQuestion = async (
  req,
  res
) => {
  try {
    const updated =
      await Question.findByIdAndUpdate(
        req.params.id,
        req.body,
        {
          new: true,
          runValidators: true,
        }
      );

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const deleteQuestion = async (
  req,
  res
) => {
  try {
    await Question.findByIdAndDelete(
      req.params.id
    );

    res.json({
      message: "Question deleted",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createQuestion,
  getQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
};