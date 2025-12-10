const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const authRoutes = require("../routes/auth");
const userRoutes = require("../routes/user");
const universeRoutes = require("../routes/universe");

dotenv.config();

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB error:", err);
  }
}

const app = express();

// middlewares
app.use(cors());
app.use(express.json());

//routes
app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/universe", universeRoutes);

app.get("/", (req, res) => {
  res.send("EternaVerseApp API running on Vercel");
});

// connect DB on every cold start
connectDB();

module.exports = serverless(app);
