/**
 * liveController.js
 *
 * Mentimeter-style live quiz flow:
 *  - Admin pushes one question at a time.
 *  - Candidates answer; speed-based bonus added on top of base marks.
 *  - Admin clicks "Next Question" to advance; candidates wait between questions.
 *  - After every question timer expires (or admin ends it), leaderboard broadcasts.
 *  - Leaderboard updates in real-time as each answer comes in.
 *  - Tie-breaking: equal scores sorted by who answered the current question faster.
 */

const Quiz        = require("../models/Quiz");
const Question    = require("../models/Question");
const QuizAttempt = require("../models/QuizAttempt");
const User        = require("../models/User");

// ─── In-memory live state ──────────────────────────────────────────────────
let liveState = {
  quizId:            null,
  quiz:              null,
  questions:         [],
  currentIndex:      -1,
  currentQuestion:   null,
  questionStartedAt: null,
  phase:             "idle",   // "idle" | "lobby" | "question" | "leaderboard" | "finished"
  answers:           {},       // { userId: { name, totalScore, lastAnsweredAt, lastAnswerDuration, ... } }
  timerHandle:       null,
};

// SSE client registry
const clients = new Map();
let clientSeq = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of clients) {
    try { client.res.write(msg); } catch (_) {}
  }
}

const TIME_LIMIT_SECS = 20;

function calcSpeedBonus(answeredAt, startedAt, maxBonus) {
  const elapsed = (answeredAt - startedAt) / 1000;
  const ratio   = Math.max(0, 1 - elapsed / TIME_LIMIT_SECS);
  return Math.round(ratio * maxBonus);
}

/**
 * Build leaderboard sorted by:
 *  1. totalScore descending
 *  2. totalDurationMs ascending (faster total cumulative time = higher rank) — primary tie-breaker
 *  3. lastAnswerDuration ascending (faster on the last question) — secondary tie-breaker
 *  4. lastAnsweredAt ascending (answered earlier overall) — tertiary tie-breaker
 */
function buildLeaderboard() {
  const rows = Object.entries(liveState.answers).map(([userId, info]) => ({
    userId,
    name:               info.name || "???",
    totalScore:         info.totalScore || 0,
    totalDurationMs:    info.totalDurationMs || 0,   // cumulative ms across all answered questions
    lastAnsweredAt:     info.lastAnsweredAt ? info.lastAnsweredAt.toISOString() : null,
    lastAnswerDuration: info.lastAnswerDuration ?? null,
    questionsAnswered:  info.answeredQuestions?.length || 0,
    questionTimings:    info.questionTimings || [],   // [{ questionIndex, durationMs, isCorrect, pointsEarned }]
  }));

  rows.sort((a, b) => {
    // Primary: higher score wins
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;

    // Tie-break 1: lower cumulative duration wins
    if (a.totalDurationMs !== b.totalDurationMs) return a.totalDurationMs - b.totalDurationMs;

    // Tie-break 2: answered the latest question faster
    const aDur = a.lastAnswerDuration;
    const bDur = b.lastAnswerDuration;
    if (aDur !== null && bDur !== null) return aDur - bDur;
    if (aDur !== null) return -1;
    if (bDur !== null) return 1;

    // Tie-break 3: earlier overall timestamp
    if (a.lastAnsweredAt && b.lastAnsweredAt)
      return new Date(a.lastAnsweredAt) - new Date(b.lastAnsweredAt);

    return 0;
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

  const qId = liveState.currentQuestion._id;

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
    leaderboard:    buildLeaderboard(),
    questionIndex:  liveState.currentIndex,
    totalQuestions: liveState.questions.length,
  });
}

// ─── SSE endpoint ─────────────────────────────────────────────────────────

exports.sseConnect = (req, res) => {
  res.set({
    "Content-Type":      "text/event-stream",
    "Cache-Control":     "no-cache",
    "Connection":        "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const id     = ++clientSeq;
  const userId = req.query.userId || null;
  clients.set(id, { res, userId });

  res.write(`event: sync\ndata: ${JSON.stringify(buildSyncPayload())}\n\n`);

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
    phase:          liveState.phase,
    currentIndex:   liveState.currentIndex,
    totalQuestions: liveState.questions.length,
    quizTitle:      liveState.quiz?.title || null,
  };

  if (liveState.phase === "question" && liveState.currentQuestion) {
    const q = liveState.currentQuestion;
    base.question = {
      _id:      q._id,
      question: q.question,
      type:     q.type,
      options:  q.options,
      marks:    q.marks,
    };
    base.questionStartedAt = liveState.questionStartedAt;
    base.timeLimitSecs     = TIME_LIMIT_SECS;
    base.leaderboard       = buildLeaderboard(); // include current standings
  }

  if (liveState.phase === "leaderboard" || liveState.phase === "finished") {
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
    if (!quiz)       return res.status(404).json({ message: "Quiz not found" });
    if (!quiz.isActive) return res.status(400).json({ message: "Quiz is not active" });

    clearTimer();

    liveState = {
      quizId,
      quiz,
      questions:         quiz.questions,
      currentIndex:      -1,
      currentQuestion:   null,
      questionStartedAt: null,
      phase:             "lobby",
      answers:           {},
      timerHandle:       null,
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
      await endQuestion();
    }

    const nextIndex = liveState.currentIndex + 1;
    if (nextIndex >= liveState.questions.length) {
      liveState.phase = "finished";
      clearTimer();
      await finalizeAttempts();
      broadcast("session_finished", { leaderboard: buildLeaderboard() });
      return res.json({ message: "Quiz finished", leaderboard: buildLeaderboard() });
    }

    liveState.currentIndex      = nextIndex;
    liveState.currentQuestion   = liveState.questions[nextIndex];
    liveState.questionStartedAt = new Date();
    liveState.phase             = "question";

    // Reset per-question tie-break durations for everyone (keep cumulative totals)
    for (const info of Object.values(liveState.answers)) {
      info.lastAnswerDuration = null;
    }

    const q = liveState.currentQuestion;
    broadcast("question", {
      question: {
        _id:      q._id,
        question: q.question,
        type:     q.type,
        options:  q.options,
        marks:    q.marks,
      },
      questionIndex:  nextIndex,
      totalQuestions: liveState.questions.length,
      startedAt:      liveState.questionStartedAt,
      timeLimitSecs:  TIME_LIMIT_SECS,
      leaderboard:    buildLeaderboard(), // send current standings with new question
    });

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
    if (liveState.phase !== "question")
      return res.status(400).json({ message: "No question in progress" });
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

    let attempt = await QuizAttempt.findOne({ user: userId, quiz: liveState.quizId });
    if (!attempt) {
      attempt = await QuizAttempt.create({
        user:   userId,
        quiz:   liveState.quizId,
        status: "started",
      });
    }

    if (!liveState.answers[userId]) {
      liveState.answers[userId] = {
        name:               user.name,
        totalScore:         0,
        totalDurationMs:    0,
        lastAnsweredAt:     null,
        lastAnswerDuration: null,
        savedQuestions:     [],
        answeredQuestions:  [],
        questionTimings:    [],   // per-question timing log
      };
    }

    // Broadcast updated player count
    broadcast("player_joined", {
      totalPlayers: Object.keys(liveState.answers).length,
    });

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
    const durationMs = answeredAt - liveState.questionStartedAt; // ms since question started

    const isCorrect =
      q.type === "mcq"
        ? answer === q.correctAnswer
        : answer?.trim().toLowerCase() === q.correctAnswer?.trim().toLowerCase();

    const baseMark    = isCorrect ? q.marks : 0;
    const speedBonus  = isCorrect
      ? calcSpeedBonus(answeredAt, liveState.questionStartedAt, q.marks)
      : 0;
    const pointsEarned = baseMark + speedBonus;

    // Update user state
    userState.totalScore         = (userState.totalScore || 0) + pointsEarned;
    userState.totalDurationMs    = (userState.totalDurationMs || 0) + durationMs; // cumulative
    userState.lastAnsweredAt     = answeredAt;
    userState.lastAnswerDuration = durationMs; // used for tie-breaking
    userState.lastAnswer         = { answer, isCorrect, marksAwarded: baseMark };

    if (!userState.answeredQuestions) userState.answeredQuestions = [];
    userState.answeredQuestions.push(questionId);

    // Track per-question timing log
    if (!userState.questionTimings) userState.questionTimings = [];
    userState.questionTimings.push({
      questionIndex: liveState.currentIndex,
      durationMs,
      answeredAt:    answeredAt.toISOString(),
      isCorrect,
      pointsEarned,
    });

    // ── Real-time leaderboard broadcast ──────────────────────────────────
    const answeredCount = Object.values(liveState.answers)
      .filter(u => u.answeredQuestions?.includes(questionId)).length;

    broadcast("leaderboard_update", {
      leaderboard:    buildLeaderboard(),   // full sorted standings
      answeredCount,
      total:          Object.keys(liveState.answers).length,
      // Per-answer metadata so UI can show timestamps
      latestAnswer: {
        userId,
        name:        userState.name,
        answeredAt:  answeredAt.toISOString(),
        durationMs,
        isCorrect,
        pointsEarned,
      },
    });

    res.json({
      isCorrect,
      baseMark,
      speedBonus,
      pointsEarned,
      totalScore:       userState.totalScore,
      totalDurationMs:  userState.totalDurationMs,
      answeredAt:       answeredAt.toISOString(),
      durationMs,
      questionIndex:    liveState.currentIndex,
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

      const allQ       = liveState.questions;
      const totalMarks = allQ.reduce((s, q) => s + q.marks, 0);
      const pct        = totalMarks
        ? ((info.totalScore / (totalMarks * 2)) * 100).toFixed(2)
        : 0;

      attempt.score       = info.totalScore;
      attempt.totalMarks  = totalMarks;
      attempt.percentage  = pct;
      attempt.status      = "submitted";
      attempt.submittedAt = new Date();
      await attempt.save();
    } catch (_) {}
  }
}