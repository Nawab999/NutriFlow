// ─────────────────────────────────────────────────────────────────────────────
// models/MealPlan.js — Weekly meal plan for a single user
//
// Schema structure:
//   MealPlan
//     └── days  (one sub-doc per day of the week)
//           └── breakfast / lunch / dinner  (each is an array of slotItems)
//                 └── slotItem  { meal: ObjectId → Meal }
//
// Each user has at most one MealPlan document (enforced by unique: true on user).
// Slots are arrays so users can add multiple meals to a single slot (e.g. two
// items for lunch to hit their calorie target).
//
// The planner route (GET /planner) calls populatePlan() which chains .populate()
// across all 7 days × 3 slots to replace ObjectIds with full Meal documents.
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

// A single item in a meal slot — just a reference to a Meal document.
// _id: true so each slot entry has its own ID, used by the remove endpoint.
const slotItemSchema = new mongoose.Schema({
  meal: { type: mongoose.Schema.Types.ObjectId, ref: "Meal", required: true }
}, { _id: true });

// One day's three meal slots. _id: false because days are embedded sub-docs
// accessed by name (monday, tuesday, …) rather than by ID.
const daySchema = new mongoose.Schema({
  breakfast: { type: [slotItemSchema], default: [] },
  lunch:     { type: [slotItemSchema], default: [] },
  dinner:    { type: [slotItemSchema], default: [] }
}, { _id: false });

const mealPlanSchema = new mongoose.Schema({
  // One plan per user — unique index prevents duplicate documents
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },

  // The Monday of the week this plan was created for (used for display only)
  weekStart: {
    type: Date,
    required: true
  },

  // Seven named day sub-documents
  days: {
    monday:    { type: daySchema, default: () => ({}) },
    tuesday:   { type: daySchema, default: () => ({}) },
    wednesday: { type: daySchema, default: () => ({}) },
    thursday:  { type: daySchema, default: () => ({}) },
    friday:    { type: daySchema, default: () => ({}) },
    saturday:  { type: daySchema, default: () => ({}) },
    sunday:    { type: daySchema, default: () => ({}) }
  }
}, { timestamps: true });

export default mongoose.model("MealPlan", mealPlanSchema);
