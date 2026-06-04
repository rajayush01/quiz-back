const mongoose = require("mongoose");

const quizAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
    },

    answers: [
      {
        question: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
          required: true,
        },

        answer: {
          type: String,
          default: "",
        },

        isCorrect: Boolean,

        marksAwarded: {
          type: Number,
          default: 0,
        }
      }
    ],

    startedAt: {
      type: Date,
      default: Date.now,
    },

    submittedAt: Date,

    status: {
      type: String,
      enum: [
        "started",
        "submitted",
        "expired"
      ],
      default: "started"
    },

    score: {
      type: Number,
      default: 0
    },

    totalMarks: {
      type: Number,
      default: 0
    },

    percentage: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model(
  "QuizAttempt",
  quizAttemptSchema
);