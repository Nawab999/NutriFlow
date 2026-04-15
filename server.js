// ─────────────────────────────────────────────────────────────────────────────
// server.js — NutriFlow application entry point
//
// Responsibilities:
//   1. Connect to MongoDB
//   2. Configure Express (middleware, view engine, static files)
//   3. Register all route modules
//   4. Import seed data from CSV on first run
//   5. Handle 404 and global error pages
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config"; // Load .env variables into process.env before anything else
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser"; // Parse HTTP-only cookies (used for JWT auth)
import cors from "cors";                  // Allow cross-origin requests from the frontend
import csv from "csv-parser";             // Stream-parse the meals.csv seed file
import express from "express";
import mongoose from "mongoose";

import Meal from "./models/Meal.js";
import User from "./models/User.js";
import { deriveFallbackPrice, getMealVisual } from "./utils/mealUtils.js";

// Route modules — each handles a distinct concern
import webRoutes   from "./routes/web.js";    // EJS page rendering and form POST handlers
import authRoutes  from "./routes/auth.js";   // /api/auth — register, login, logout
import mealRoutes  from "./routes/meals.js";  // /api/meals — CRUD (admin-gated writes)
import userRoutes  from "./routes/users.js";  // /api/users — profile, favourites, history
import cartRoutes  from "./routes/cart.js";   // /api/cart  — cart management
import orderRoutes from "./routes/orders.js"; // /api/orders — checkout and order history
import chatRoutes  from "./routes/chat.js";   // /api/chat  — nutrition assistant chatbot

// ── Environment validation ────────────────────────────────────────────────────
// Fail fast on startup if critical variables are missing, rather than silently
// falling back to localhost values that will break in production.
if (!process.env.MONGODB_URI) {
  console.error("FATAL: MONGODB_URI is not set. Add it to your .env or Render environment.");
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "your_super_secret_jwt_key_change_this_in_production") {
  console.error("FATAL: JWT_SECRET is not set or is still the default placeholder. Set a strong random value.");
  process.exit(1);
}

const app = express();

// ES module replacement for __dirname (not available in ESM by default)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── View engine ───────────────────────────────────────────────────────────────
// Use EJS to render HTML from /views/pages/*.ejs templates
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Template helpers ──────────────────────────────────────────────────────────
// These are available in every EJS template via app.locals / res.locals.
// They avoid duplicating formatting logic inside individual templates.

// formatCurrency(9.5) → "$9.50"
app.locals.formatCurrency = value => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
}).format(Number(value || 0));

// formatDate(date) → "Apr 14, 2026"
app.locals.formatDate = value => new Date(value).toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

// isSelected(current, value) — returns "selected" if the two values match,
// used in <select> dropdowns to pre-select the current profile value
app.locals.isSelected = (current, value) =>
  String(current || "") === String(value) ? "selected" : "";

// buildQueryString(req.query, { page: 2 }) — merges the current query params
// with overrides and returns a URL query string, used for pagination links
app.locals.buildQueryString = (query = {}, overrides = {}) => {
  const params = new URLSearchParams();
  const merged = { ...query, ...overrides };
  Object.entries(merged).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  return params.toString();
};

// getMealVisual(meal) — derives a background colour and image URL for a meal
// card, falling back to a colour based on the meal name when no image exists
app.locals.getMealVisual = getMealVisual;

// Mirror app.locals into res.locals so they're accessible inside includes/partials
app.use((req, res, next) => {
  res.locals.getMealVisual    = getMealVisual;
  res.locals.formatCurrency   = app.locals.formatCurrency;
  res.locals.formatDate       = app.locals.formatDate;
  res.locals.isSelected       = app.locals.isSelected;
  res.locals.buildQueryString = app.locals.buildQueryString;
  next();
});

// ── Core middleware ───────────────────────────────────────────────────────────

// Allow the EJS frontend origin to send credentialed requests (cookie auth).
// In production FRONTEND_URL should be your Render app URL.
app.use(cors({
  origin: process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? false : "http://localhost:3000"),
  credentials: true
}));

app.use(cookieParser());                                 // Parse cookie header → req.cookies
app.use(express.json({ limit: "10mb" }));               // Parse application/json bodies
app.use(express.urlencoded({ limit: "10mb", extended: true })); // Parse HTML form POST bodies
app.use(express.static("public", { index: false }));    // Serve /public/app.css etc. statically

// ── Request logger ────────────────────────────────────────────────────────────
// Logs every request as structured JSON to stdout.
// Level is derived from HTTP status code: ERROR ≥500, WARN ≥400, INFO otherwise.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "ERROR"
                : res.statusCode >= 400 ? "WARN"
                : "INFO";
    console.log(JSON.stringify({
      level,
      time:   new Date().toISOString(),
      method: req.method,
      path:   req.path,
      status: res.statusCode,
      ms:     duration,
      ip:     req.ip
    }));
  });
  next();
});

// ── Database connection ───────────────────────────────────────────────────────
// Connects to MongoDB using the URI from .env.
// Exits the process on failure — there is no point serving requests without a DB.
mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/mealDB")
  .then(() => console.log("MongoDB connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// ── CSV seed import ───────────────────────────────────────────────────────────
// Runs once on startup. If the Meal collection is already populated, it skips.
// This means production deploys don't need a separate seed step.
const importCSV = async () => {
  try {
    const mealCount = await Meal.countDocuments();
    if (mealCount > 0) {
      console.log(`Database already has ${mealCount} meals. Skipping CSV import.`);
      return;
    }

    console.log("Importing CSV data...");
    const rows = [];

    // Stream the CSV file row by row to avoid loading it all into memory
    await new Promise((resolve, reject) => {
      fs.createReadStream(path.join(__dirname, "data", "meals.csv"))
        .pipe(csv())
        .on("data", row => rows.push(row))
        .on("end", resolve)
        .on("error", reject);
    });

    for (const row of rows) {
      try {
        // Skip duplicates (safe for re-runs if import was interrupted)
        const exists = await Meal.findOne({ meal_name: row.meal_name });
        if (exists) continue;

        const calories = parseFloat(row.calories) || 0;
        const protein  = parseFloat(row.protein)  || 0;

        // Sanitise enum fields — CSV values may not match allowed enum values
        const safeMeal = {
          meal_name:    row.meal_name,
          disease_type: row.disease_type || "None",

          sugar_level: ["Low", "Medium", "High"].includes(row.sugar_level)
            ? row.sugar_level : "Medium",

          salt_level: ["Low", "Medium", "High"].includes(row.salt_level)
            ? row.salt_level : "Medium",

          temperature: ["Cold", "Warm", "Hot"].includes(row.temperature)
            ? row.temperature : "Warm",

          expiry_days: Math.min(parseInt(row.expiry_days, 10) || 7, 365),

          calories,
          protein,

          // Use CSV price if present; otherwise derive a realistic price from
          // calories and protein using the heuristic in mealUtils.deriveFallbackPrice
          price: parseFloat(row.price) ||
            deriveFallbackPrice(row.meal_name, calories, protein),

          description: row.description || ""
        };

        await Meal.create(safeMeal);
      } catch (err) {
        console.error("Error importing meal:", err);
      }
    }

    console.log("CSV data import complete");
  } catch (error) {
    console.error("CSV import error:", error);
  }
};

importCSV();

// ── Health check ──────────────────────────────────────────────────────────────
// Used by hosting platforms (Render, Railway) to verify the service is alive.
// Returns meal and user counts so you can confirm the DB is reachable.
app.get("/health", async (req, res) => {
  const mealCount = await Meal.countDocuments().catch(() => null);
  const userCount = await User.countDocuments().catch(() => null);

  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
    stats: { meals: mealCount, users: userCount }
  });
});

// ── Route registration ────────────────────────────────────────────────────────
// Web routes must be registered first — they handle all non-/api paths and
// render EJS pages. API routes are stateless JSON handlers.
app.use("/api/chat",   chatRoutes);  // Nutrition assistant chatbot
app.use("/",           webRoutes);   // EJS pages: /, /meals, /planner, /dashboard, etc.
app.use("/api/auth",   authRoutes);  // Register / login / logout
app.use("/api/meals",  mealRoutes);  // Meal CRUD
app.use("/api/users",  userRoutes);  // Profile, favourites, history
app.use("/api/cart",   cartRoutes);  // Cart management
app.use("/api/orders", orderRoutes); // Order placement and history

// ── 404 handler ───────────────────────────────────────────────────────────────
// Catches any request that didn't match a registered route.
// Renders an EJS 404 page for browser requests; returns JSON for API calls.
app.use((req, res) => {
  if (!req.path.startsWith("/api")) {
    return res.status(404).render("pages/not-found", {
      pageTitle:   "NutriFlow | Not Found",
      currentUser: null,
      errors:      [],
      formData:    {},
      flash:       null,
      currentPath: req.path,
      query:       req.query
    });
  }
  res.status(404).json({ success: false, message: "Route not found", path: req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Express calls this middleware when next(err) is invoked anywhere in the app.
// In development the full error object is included in API responses to aid debugging.
app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (!req.path.startsWith("/api")) {
    return res.status(err.status || 500).render("pages/error", {
      pageTitle:    "NutriFlow | Error",
      currentUser:  null,
      errors:       [],
      formData:     {},
      flash:        null,
      currentPath:  req.path,
      query:        req.query,
      errorMessage: err.message || "Internal server error"
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    error:   process.env.NODE_ENV === "development" ? err : undefined
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
