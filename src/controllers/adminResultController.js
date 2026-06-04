const QuizAttempt = require(
  "../models/QuizAttempt"
);

const getAllResults = async (
  req,
  res
) => {
  try {
    const results =
      await QuizAttempt.find({
        status: {
          $in: [
            "submitted",
            "expired",
          ],
        },
      })
        .populate(
          "user",
          "name"
        )
        .populate(
          "quiz",
          "title"
        )
        .sort({
          createdAt: -1,
        });

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message:
        error.message,
    });
  }
};

const getResultByAttempt =
  async (req, res) => {
    try {
      const result =
        await QuizAttempt.findById(
          req.params
            .attemptId
        )
          .populate(
            "user"
          )
          .populate(
            "quiz"
          )
          .populate(
            "answers.question"
          );

      if (!result) {
        return res
          .status(404)
          .json({
            message:
              "Result not found",
          });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        message:
          error.message,
      });
    }
  };

  const getLeaderboard =
  async (req, res) => {
    try {
      const leaderboard =
        await QuizAttempt.find({
          status:
            "submitted",
        })
          .populate(
            "user",
            "name"
          )
          .sort({
            score: -1,
            submittedAt: 1,
          })
          .limit(50);

      res.json(
        leaderboard
      );
    } catch (error) {
      res.status(500).json({
        message:
          error.message,
      });
    }
  };

  const getQuizStats =
  async (req, res) => {
    try {
      const attempts =
        await QuizAttempt.find(
          {
            status: {
              $in: [
                "submitted",
                "expired",
              ],
            },
          }
        );

      const totalUsers =
        attempts.length;

      const highestScore =
        totalUsers
          ? Math.max(
              ...attempts.map(
                (a) =>
                  a.score
              )
            )
          : 0;

      const lowestScore =
        totalUsers
          ? Math.min(
              ...attempts.map(
                (a) =>
                  a.score
              )
            )
          : 0;

      const averageScore =
        totalUsers
          ? (
              attempts.reduce(
                (
                  sum,
                  a
                ) =>
                  sum +
                  a.score,
                0
              ) /
              totalUsers
            ).toFixed(2)
          : 0;

      res.json({
        totalUsers,

        highestScore,

        lowestScore,

        averageScore,
      });
    } catch (error) {
      res.status(500).json({
        message:
          error.message,
      });
    }
  };

  module.exports = {
  getAllResults,
  getResultByAttempt,
  getLeaderboard,
  getQuizStats,
};