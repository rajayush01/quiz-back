const QuizAttempt = require("../models/QuizAttempt");
const Question = require("../models/Question");
const submitQuiz = async (req, res) => {
  try {
    const {
      attemptId,
      answers
    } = req.body;

    const attempt =
      await QuizAttempt.findById(
        attemptId
      )
        .populate("quiz")
        .populate("user");

    if (!attempt) {
      return res.status(404).json({
        message: "Attempt not found"
      });
    }

    if (
      attempt.status === "submitted"
    ) {
      return res.status(400).json({
        message:
          "Quiz already submitted"
      });
    }

    const quizEndTime =
      new Date(
        attempt.startedAt
      ).getTime() +
      attempt.quiz.durationMinutes *
        60 *
        1000;

    let status = "submitted";

    if (
      Date.now() > quizEndTime
    ) {
      status = "expired";
    }

    let score = 0;

    const questions =
      await Question.find({
        _id: {
          $in: attempt.quiz.questions
        }
      });

    const totalMarks =
      questions.reduce(
        (sum, q) =>
          sum + q.marks,
        0
      );

    const processedAnswers = [];

    for (const userAnswer of answers) {
      const question =
        questions.find(
          (item) =>
            item._id.toString() ===
            userAnswer.questionId
        );

      if (!question) continue;

      let isCorrect = false;
      let marksAwarded = 0;

      if (
        question.type === "mcq"
      ) {
        isCorrect =
          userAnswer.answer ===
          question.correctAnswer;

        marksAwarded = isCorrect
          ? question.marks
          : 0;
      }

      if (
        question.type === "text"
      ) {
        isCorrect =
          userAnswer.answer
            ?.trim()
            .toLowerCase() ===
          question.correctAnswer
            ?.trim()
            .toLowerCase();

        marksAwarded = isCorrect
          ? question.marks
          : 0;
      }

      score += marksAwarded;

      processedAnswers.push({
        question: question._id,
        answer: userAnswer.answer,
        isCorrect,
        marksAwarded
      });
    }

    const percentage =
      totalMarks === 0
        ? 0
        : (
            (score /
              totalMarks) *
            100
          ).toFixed(2);

    attempt.answers =
      processedAnswers;

    attempt.score = score;

    attempt.totalMarks =
      totalMarks;

    attempt.percentage =
      percentage;

    attempt.status = status;

    attempt.submittedAt =
      new Date();

    await attempt.save();

    res.json({
      success: true,
      score,
      totalMarks,
      percentage,
      status
    });
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

const getResult = async (
  req,
  res
) => {
  try {
    const attempt =
      await QuizAttempt.findById(
        req.params.id
      )
        .populate("user")
        .populate({
          path: "answers.question",
          select:
            "question options correctAnswer marks"
        });

    if (!attempt) {
      return res.status(404).json({
        message: "Result not found"
      });
    }

    res.json(attempt);
  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

module.exports = {
  submitQuiz,
  getResult
};
