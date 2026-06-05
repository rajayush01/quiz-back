// models/OpenResponse.js
// Stores one free-text response per user per open question.

const mongoose = require("mongoose");

const openResponseSchema = new mongoose.Schema(
  {
    openQuestion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpenQuestion",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

// One response per user per question
openResponseSchema.index({ openQuestion: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("OpenResponse", openResponseSchema);