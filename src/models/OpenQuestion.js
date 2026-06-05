// models/OpenQuestion.js
// A single, global free-text question shown to every candidate who joins.
// Only one "active" open question exists at a time.

const mongoose = require("mongoose");

const openQuestionSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OpenQuestion", openQuestionSchema);