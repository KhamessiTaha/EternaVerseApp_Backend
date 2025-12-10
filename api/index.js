const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB error:", err);
  }
}

connectDB();

const authRoutes = require("../routes/auth");
const userRoutes = require("../routes/user");
const universeRoutes = require("../routes/universe");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("EternaVerseApp API running on Vercel");
});

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/universe", universeRoutes);

module.exports = serverless(app);
