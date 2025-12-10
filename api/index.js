const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

// Remove the global connectDB call
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
app.use(cors());
app.use(express.json());

// Middleware to connect to DB on each request
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

// Load routes after app is defined
const authRoutes = require("../routes/auth");
const userRoutes = require("../routes/user");
const universeRoutes = require("../routes/universe");

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/universe", universeRoutes);

module.exports = serverless(app);
module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const handler = serverless(app);
  return handler(event, context);
};