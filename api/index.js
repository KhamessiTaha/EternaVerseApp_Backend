const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { inject } = require("@vercel/analytics");

dotenv.config();

let isConnected = false;

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB error:", err);
    throw err;
  }
}

const app = express();

// Initialize Vercel Analytics
try {
  inject();
} catch (err) {
  console.warn("Vercel Analytics initialization warning:", err.message);
}

app.use(cors());
app.use(express.json());

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.get("/", (req, res) => {
  res.send("EternaVerseApp API running on Vercel");
});

app.get("/api", (req, res) => {
  res.send("EternaVerseApp API running on Vercel");
});

const authRoutes = require("../routes/auth");
const userRoutes = require("../routes/user");
const universeRoutes = require("../routes/universe");

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/universe", universeRoutes);

module.exports = app;