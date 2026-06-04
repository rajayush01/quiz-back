const Quiz = require("../models/Quiz");
const Question = require("../models/Question");
const QuizAttempt =
require("../models/QuizAttempt");

const User =
require("../models/User");
const createQuiz = async (req, res) => {
  try {
    const {
      title,
      description,
      durationMinutes,
      questionIds,
    } = req.body;

    if (
      !title ||
      !durationMinutes ||
      !questionIds?.length
    ) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const questions = await Question.find({
      _id: { $in: questionIds },
    });

    if (
      questions.length !== questionIds.length
    ) {
      return res.status(400).json({
        message:
          "One or more question IDs are invalid",
      });
    }

    const quiz = await Quiz.create({
      title,
      description,
      durationMinutes,
      questions: questionIds,
      createdBy: req.admin._id,
    });

    res.status(201).json(quiz);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find()
      .populate("questions")
      .sort({ createdAt: -1 });

    res.json(quizzes);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getQuizById = async (req, res) => {
  try {
    const quiz = await Quiz.findById(
      req.params.id
    ).populate("questions");

    if (!quiz) {
      return res.status(404).json({
        message: "Quiz not found",
      });
    }

    res.json(quiz);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const updateQuiz = async (req, res) => {
  try {
    const updatedQuiz =
      await Quiz.findByIdAndUpdate(
        req.params.id,
        req.body,
        {
          new: true,
          runValidators: true,
        }
      );

    res.json(updatedQuiz);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const deleteQuiz = async (req, res) => {
  try {
    await Quiz.findByIdAndDelete(
      req.params.id
    );

    res.json({
      message: "Quiz deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const activateQuiz = async (
  req,
  res
) => {
  try {
    const quiz = await Quiz.findById(
      req.params.id
    );

    if (!quiz) {
      return res.status(404).json({
        message: "Quiz not found",
      });
    }

    await Quiz.updateMany(
      {},
      {
        isActive: false,
      }
    );

    quiz.isActive = true;

    await quiz.save();

    res.json({
      message: "Quiz activated",
      quiz,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

const getActiveQuiz = async (
  req,
  res
) => {
  try {
    const quiz = await Quiz.findOne({
      isActive: true,
    }).populate("questions");

    if (!quiz) {
      return res.status(404).json({
        message:
          "No active quiz available",
      });
    }

    res.json(quiz);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
const startQuiz = async (
  req,
  res
) => {
  try {
    const { userId } = req.body;

    const user =
      await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const quiz = await Quiz.findOne({
      isActive: true,
    }).populate({
      path: "questions",
      select: "-correctAnswer",
    });

    if (!quiz) {
      return res.status(404).json({
        message:
          "No active quiz available",
      });
    }

    const existingAttempt =
      await QuizAttempt.findOne({
        user: userId,
        quiz: quiz._id,
      });

    if (existingAttempt) {
      return res.status(400).json({
        message:
          "Quiz already started",
      });
    }

    const attempt =
      await QuizAttempt.create({
        user: userId,
        quiz: quiz._id,
      });

    res.json({
      attemptId: attempt._id,
      durationMinutes:
        quiz.durationMinutes,
      questions: quiz.questions,
      startedAt:
        attempt.startedAt,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  createQuiz,
  getQuizzes,
  getQuizById,
  updateQuiz,
  deleteQuiz,
  activateQuiz,
  getActiveQuiz,
  startQuiz,
};