const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const adminRoutes = require("./routes/adminRoutes");
const adminResultRoutes =
require("./routes/adminResultRoutes");
const questionRoutes =
require("./routes/questionRoutes");
const quizRoutes =
require("./routes/quizRoutes");
const userRoutes =
require("./routes/userRoutes");
const submissionRoutes =
require(
  "./routes/submissionRoutes"
);
const liveRoutes       = require("./routes/liveRoutes");





const app = express();

app.use(cors());

app.use(express.json());

app.use(morgan("dev"));

app.use("/api/admin", adminRoutes);
app.use(
  "/api/admin",
  adminResultRoutes
);
app.use(
  "/api/admin/questions",
  questionRoutes
);

app.use(
  "/api/quizzes",
  quizRoutes
);

app.use(
  "/api/users",
  userRoutes
);

app.use(
  "/api/submissions",
  submissionRoutes
);

app.use("/api/live", liveRoutes);
module.exports = app;
