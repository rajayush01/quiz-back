// controllers/openQuestionController.js

const OpenQuestion = require("../models/OpenQuestion");
const OpenResponse = require("../models/OpenResponse");
const User         = require("../models/User");

// ── Admin: create / replace the active open question ─────────────────────
const setOpenQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ message: "Question text is required" });
    }

    // Deactivate any existing active questions
    await OpenQuestion.updateMany({ isActive: true }, { isActive: false });

    const newQ = await OpenQuestion.create({
      question: question.trim(),
      isActive: true,
      createdBy: req.admin._id,
    });

    res.status(201).json(newQ);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── Admin: get the current active open question ───────────────────────────
const getActiveOpenQuestion = async (req, res) => {
  try {
    const q = await OpenQuestion.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (!q) return res.status(404).json({ message: "No active open question" });
    res.json(q);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── Admin: get ALL responses for the active open question ─────────────────
const getOpenResponses = async (req, res) => {
  try {
    const q = await OpenQuestion.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (!q) return res.json({ question: null, responses: [] });

    const responses = await OpenResponse.find({ openQuestion: q._id })
      .populate("user", "name")
      .sort({ createdAt: 1 });

    res.json({ question: q, responses });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── Admin: delete the active open question (and its responses) ────────────
const deleteOpenQuestion = async (req, res) => {
  try {
    const q = await OpenQuestion.findOne({ isActive: true });
    if (!q) return res.status(404).json({ message: "No active open question" });

    await OpenResponse.deleteMany({ openQuestion: q._id });
    await OpenQuestion.findByIdAndDelete(q._id);

    res.json({ message: "Open question deleted" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── Public: candidate fetches the current open question ───────────────────
const getCandidateOpenQuestion = async (req, res) => {
  try {
    const q = await OpenQuestion.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (!q) return res.json({ question: null });
    res.json({ question: q });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ── Public: candidate submits their answer ────────────────────────────────
const submitOpenResponse = async (req, res) => {
  try {
    const { userId, openQuestionId, answer } = req.body;

    if (!userId || !openQuestionId || !answer?.trim()) {
      return res.status(400).json({ message: "userId, openQuestionId and answer are required" });
    }

    const q = await OpenQuestion.findById(openQuestionId);
    if (!q || !q.isActive) {
      return res.status(404).json({ message: "Open question not found or inactive" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Upsert: update if they re-submit, otherwise insert
    const response = await OpenResponse.findOneAndUpdate(
      { openQuestion: openQuestionId, user: userId },
      { answer: answer.trim() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, response });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

module.exports = {
  setOpenQuestion,
  getActiveOpenQuestion,
  getOpenResponses,
  deleteOpenQuestion,
  getCandidateOpenQuestion,
  submitOpenResponse,
};