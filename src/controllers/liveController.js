/**
 * liveController.js
 *
 * Mentimeter-style live quiz flow:
 *  - Admin pushes one question at a time.
 *  - Candidates answer; speed-based bonus added on top of base marks.
 *  - Admin clicks "Next Question" to advance; candidates wait between questions.
 *  - After every question timer expires (or admin ends it), leaderboard broadcasts.
 */

const Quiz        = require("../models/Quiz");
const Question    = require("../models/Question");
const QuizAttempt = require("../models/QuizAttempt");
const User        = require("../models/User");

// ─── In-memory live state ──────────────────────────────────────────────────
// One active session at a time.
let liveState = {
  quizId:          null,
  quiz:            null,          // populated Quiz doc
  questions:       [],            // ordered Question docs (no correctAnswer exposed)
  currentIndex:    -1,            // which question is live (-1 = lobby / finished)
  currentQuestion: null,          // Question doc (with correctAnswer, for grading)
  questionStartedAt: null,        // Date — when current question was pushed
  phase:           "idle",        // "idle" | "question" | "leaderboard" | "finished"
  answers:         {},            // { userId: { answer, answeredAt, isCorrect, speedBonus, total } }
  timerHandle:     null,
};

// SSE client registry: Map<clientId, { res, userId? }>
const clients = new Map();
let clientSeq = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of clients) {
    try { client.res.write(msg); } catch (_) {}
  }
}

/**
 * Speed bonus: first answerer in a question window gets full question.marks
 * as bonus; last gets 0. Linear interpolation between.
 * durationMs = quiz.durationMinutes * 60 * 1000  BUT per-question timer is
 * always TIME_LIMIT_SECS seconds.
 */
const TIME_LIMIT_SECS = 20;

function calcSpeedBonus(answeredAt, startedAt, maxBonus) {
  const elapsed = (answeredAt - startedAt) / 1000; // seconds
  const ratio   = Math.max(0, 1 - elapsed / TIME_LIMIT_SECS);
  return Math.round(ratio * maxBonus);
}

function buildLeaderboard() {
  const rows = Object.entries(liveState.answers).map(([userId, info]) => {
    // lastAnsweredAt = timestamp of most recent answer across all questions
    const lastAnsweredAt = info.lastAnsweredAt || null;
    return {
      userId,
      name:          info.name || "???",
      totalScore:    info.totalScore || 0,
      lastAnsweredAt,                          // ISO string, shown in UI
    };
  });
  // Sort: higher score first; tie-break = earlier lastAnsweredAt wins
  rows.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (!a.lastAnsweredAt) return 1;
    if (!b.lastAnsweredAt) return -1;
    return new Date(a.lastAnsweredAt) - new Date(b.lastAnsweredAt);
  });
  return rows;
}

function clearTimer() {
  if (liveState.timerHandle) {
    clearTimeout(liveState.timerHandle);
    liveState.timerHandle = null;
  }
}

async function endQuestion() {
  clearTimer();
  liveState.phase = "leaderboard";

  // Persist answers for users who didn't answer (mark blank)
  const blankUsers = Object.entries(liveState.answers)
    .filter(([, info]) => !info.answeredQuestions?.includes(liveState.currentQuestion._id.toString()));

  // Update QuizAttempt documents for all who answered this question
  const qId     = liveState.currentQuestion._id;
  const correct = liveState.currentQuestion.correctAnswer;

  for (const [userId, info] of Object.entries(liveState.answers)) {
    const alreadySaved = info.savedQuestions?.includes(qId.toString());
    if (alreadySaved) continue;

    const thisAns = info.lastAnswer || { answer: "", isCorrect: false, marksAwarded: 0 };

    try {
      await QuizAttempt.findOneAndUpdate(
        { user: userId, quiz: liveState.quizId },
        {
          $push: {
            answers: {
              question:     qId,
              answer:       thisAns.answer,
              isCorrect:    thisAns.isCorrect,
              marksAwarded: thisAns.marksAwarded,
            },
          },
          $inc: { score: thisAns.marksAwarded },
        }
      );

      if (!info.savedQuestions) info.savedQuestions = [];
      info.savedQuestions.push(qId.toString());
    } catch (_) {}
  }

  broadcast("leaderboard", {
    leaderboard: buildLeaderboard(),
    questionIndex: liveState.currentIndex,
    totalQuestions: liveState.questions.length,
  });
}

// ─── SSE endpoint ─────────────────────────────────────────────────────────

exports.sseConnect = (req, res) => {
  res.set({
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    Connection:      "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const id = ++clientSeq;
  const userId = req.query.userId || null;
  clients.set(id, { res, userId });

  // Send current state immediately so late joiners sync up
  res.write(`event: sync\ndata: ${JSON.stringify(buildSyncPayload())}\n\n`);

  // Heartbeat every 20s
  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch (_) {}
  }, 20000);

  req.on("close", () => {
    clearInterval(hb);
    clients.delete(id);
  });
};

function buildSyncPayload() {
  const base = {
    phase:         liveState.phase,
    currentIndex:  liveState.currentIndex,
    totalQuestions: liveState.questions.length,
    quizTitle:     liveState.quiz?.title || null,
  };

  if (liveState.phase === "question" && liveState.currentQuestion) {
    const q = liveState.currentQuestion;
    base.question = {
      _id:    q._id,
      question: q.question,
      type:   q.type,
      options: q.options,
      marks:  q.marks,
    };
    base.questionStartedAt = liveState.questionStartedAt;
    base.timeLimitSecs     = TIME_LIMIT_SECS;
  }

  if (liveState.phase === "leaderboard") {
    base.leaderboard   = buildLeaderboard();
    base.questionIndex = liveState.currentIndex;
  }

  return base;
}

// ─── Admin: start a live session ──────────────────────────────────────────

exports.startLiveSession = async (req, res) => {
  try {
    const { quizId } = req.body;
    const quiz = await Quiz.findById(quizId).populate("questions");
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    if (!quiz.isActive) return res.status(400).json({ message: "Quiz is not active" });

    clearTimer();

    liveState = {
      quizId:          quizId,
      quiz:            quiz,
      questions:       quiz.questions,
      currentIndex:    -1,
      currentQuestion: null,
      questionStartedAt: null,
      phase:           "lobby",
      answers:         {},
      timerHandle:     null,
    };

    broadcast("session_started", {
      quizId,
      quizTitle:      quiz.title,
      totalQuestions: quiz.questions.length,
      phase:          "lobby",
    });

    res.json({ message: "Live session started", totalQuestions: quiz.questions.length });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Admin: push next question ────────────────────────────────────────────

exports.pushNextQuestion = async (req, res) => {
  try {
    if (!liveState.quiz) return res.status(400).json({ message: "No active session" });
    if (liveState.phase === "question") {
      // Force-end current question first
      await endQuestion();
    }

    const nextIndex = liveState.currentIndex + 1;
    if (nextIndex >= liveState.questions.length) {
      // Session finished
      liveState.phase = "finished";
      clearTimer();

      // Finalize all QuizAttempt docs
      await finalizeAttempts();

      broadcast("session_finished", { leaderboard: buildLeaderboard() });
      return res.json({ message: "Quiz finished", leaderboard: buildLeaderboard() });
    }

    liveState.currentIndex    = nextIndex;
    liveState.currentQuestion = liveState.questions[nextIndex];
    liveState.questionStartedAt = new Date();
    liveState.phase           = "question";

    // Strip correctAnswer before broadcasting to candidates
    const q = liveState.currentQuestion;
    broadcast("question", {
      question: {
        _id:     q._id,
        question: q.question,
        type:    q.type,
        options: q.options,
        marks:   q.marks,
      },
      questionIndex:  nextIndex,
      totalQuestions: liveState.questions.length,
      startedAt:      liveState.questionStartedAt,
      timeLimitSecs:  TIME_LIMIT_SECS,
    });

    // Auto-end after TIME_LIMIT_SECS
    liveState.timerHandle = setTimeout(async () => {
      await endQuestion();
    }, TIME_LIMIT_SECS * 1000);

    res.json({ message: `Question ${nextIndex + 1} pushed`, questionIndex: nextIndex });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Admin: manually end current question ────────────────────────────────

exports.endCurrentQuestion = async (req, res) => {
  try {
    if (liveState.phase !== "question") return res.status(400).json({ message: "No question in progress" });
    await endQuestion();
    res.json({ message: "Question ended", leaderboard: buildLeaderboard() });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Admin: get live leaderboard ──────────────────────────────────────────

exports.getLiveLeaderboard = (req, res) => {
  res.json({
    phase:          liveState.phase,
    currentIndex:   liveState.currentIndex,
    totalQuestions: liveState.questions.length,
    leaderboard:    buildLeaderboard(),
  });
};

// ─── Admin: get session state ─────────────────────────────────────────────

exports.getSessionState = (req, res) => {
  res.json(buildSyncPayload());
};

// ─── Candidate: register for live session ────────────────────────────────

exports.joinLiveSession = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!liveState.quiz) return res.status(404).json({ message: "No active session" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Create or find attempt
    let attempt = await QuizAttempt.findOne({ user: userId, quiz: liveState.quizId });
    if (!attempt) {
      attempt = await QuizAttempt.create({ user: userId, quiz: liveState.quizId, status: "started" });
    }

    // Register in answers map
    if (!liveState.answers[userId]) {
      liveState.answers[userId] = {
        name:           user.name,
        totalScore:     0,
        savedQuestions: [],
        answeredQuestions: [],
      };
    }

    res.json({
      attemptId:      attempt._id,
      quizTitle:      liveState.quiz.title,
      totalQuestions: liveState.questions.length,
      phase:          liveState.phase,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Candidate: submit answer for current question ────────────────────────

exports.submitLiveAnswer = async (req, res) => {
  try {
    const { userId, questionId, answer } = req.body;

    if (liveState.phase !== "question") {
      return res.status(400).json({ message: "No question in progress" });
    }

    const q = liveState.currentQuestion;
    if (q._id.toString() !== questionId) {
      return res.status(400).json({ message: "Wrong question" });
    }

    const userState = liveState.answers[userId];
    if (!userState) return res.status(400).json({ message: "Not joined" });

    if (userState.answeredQuestions?.includes(questionId)) {
      return res.status(400).json({ message: "Already answered" });
    }

    const answeredAt = new Date();
    const isCorrect =
      q.type === "mcq"
        ? answer === q.correctAnswer
        : answer?.trim().toLowerCase() === q.correctAnswer?.trim().toLowerCase();

    const baseMark   = isCorrect ? q.marks : 0;
    const speedBonus = isCorrect
      ? calcSpeedBonus(answeredAt, liveState.questionStartedAt, q.marks)
      : 0;
    const pointsEarned = baseMark + speedBonus;

    userState.totalScore    = (userState.totalScore || 0) + pointsEarned;
    userState.lastAnswer    = { answer, isCorrect, marksAwarded: baseMark };
    userState.lastAnsweredAt = answeredAt.toISOString();   // ← store timestamp
    if (!userState.answeredQuestions) userState.answeredQuestions = [];
    userState.answeredQuestions.push(questionId);

    // Broadcast live answer count + real-time leaderboard to EVERYONE
    const answeredCount = Object.values(liveState.answers)
      .filter(u => u.answeredQuestions?.includes(questionId)).length;
    broadcast("answer_count", { answeredCount, total: Object.keys(liveState.answers).length });
    broadcast("live_leaderboard", {           // ← new: real-time leaderboard event
      leaderboard:    buildLeaderboard(),
      answeredCount,
      total:          Object.keys(liveState.answers).length,
      questionIndex:  liveState.currentIndex,
    });

    res.json({
      isCorrect,
      baseMark,
      speedBonus,
      pointsEarned,
      totalScore: userState.totalScore,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─── Finalize attempts at session end ─────────────────────────────────────

async function finalizeAttempts() {
  for (const [userId, info] of Object.entries(liveState.answers)) {
    try {
      const attempt = await QuizAttempt.findOne({ user: userId, quiz: liveState.quizId });
      if (!attempt) continue;

      const allQ = liveState.questions;
      const totalMarks = allQ.reduce((s, q) => s + q.marks, 0);
      const pct = totalMarks ? ((info.totalScore / (totalMarks * 2)) * 100).toFixed(2) : 0;

      attempt.score      = info.totalScore;
      attempt.totalMarks = totalMarks;
      attempt.percentage = pct;
      attempt.status     = "submitted";
      attempt.submittedAt = new Date();
      await attempt.save();
    } catch (_) {}
  }
}