// ─────────────────────────────────────────────────────────────────────────────
// models/Meal.js — MongoDB schema for a single meal
//
// A Meal document represents one food item in the catalogue. It stores both
// nutritional/medical metadata (used for filtering and personalisation) and
// Cook Mode data (ingredients, instructions, cook/prep time).
//
// Meals are seeded from data/meals.csv on first server start. Admins can
// create, edit, and delete meals via /admin/meals.
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const mealSchema = new mongoose.Schema(
  {
    // Display name shown throughout the UI
    meal_name: {
      type: String,
      required: [true, "Meal name is required"],
      trim: true,
      minlength: [2, "Meal name must be at least 2 characters"],
      maxlength: [100, "Meal name must not exceed 100 characters"]
    },

    // Medical condition this meal is designed for.
    // Used to match meals to users' primaryCondition profile field.
    disease_type: {
      type: String,
      enum: ["Diabetes", "Hypertension", "Heart Disease", "None", "Other"],
      default: "None"
    },

    // Nutritional level enums — used for filtering and the scoring algorithm
    sugar_level: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
    salt_level:  { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },

    // Serving temperature — matched against user's preferredTemperature
    temperature: { type: String, enum: ["Cold", "Warm", "Hot"], default: "Warm" },

    // How many days the meal stays fresh (informational, shown on detail page)
    expiry_days: {
      type: Number,
      min: [0, "Expiry days cannot be negative"],
      max: [365, "Expiry days must be less than or equal to 365"]
    },

    // Macros — used in calorie goal tracking, daily suggestions, and scoring
    calories: { type: Number, min: 0 },
    protein:  { type: Number, min: 0 },

    // Price in USD — used for cart totals, budget filtering, and scoring
    price: {
      type: Number,
      min: [0, "Price cannot be negative"],
      required: [true, "Price is required"]
    },

    // Which meal slot this is suited for. "Any" means it can appear in all slots.
    // Used by the planner picker and daily suggestions banner.
    mealType: {
      type: String,
      enum: ["Breakfast", "Lunch", "Dinner", "Any"],
      default: "Any"
    },

    // Allergens present in this meal — matched against user's declared allergies.
    // Meals with a matching allergen are hidden site-wide for that user.
    allergens: {
      type: [String],
      default: [],
      enum: ["Gluten", "Dairy", "Eggs", "Nuts", "Shellfish", "Soy", "Fish", "Peanuts"]
    },

    // Optional Pexels or external image URL. If empty, getMealVisual() derives
    // one automatically from the meal name.
    imageUrl: { type: String, trim: true, maxlength: 500 },

    // Short marketing description shown on meal cards and detail page
    description: { type: String, maxlength: 500 },

    // ── Cook Mode fields ──────────────────────────────────────────────────────
    // These are shown on the meal detail page and used to build the grocery list.

    // List of ingredient strings e.g. ["200g chicken breast", "1 tbsp olive oil"]
    ingredients: { type: [String], default: [] },

    // Step-by-step cooking instructions
    instructions: { type: [String], default: [] },

    // Cook and prep time in minutes — shown on grocery list cards and detail page
    cookTime: { type: Number, min: 0 },
    prepTime: { type: Number, min: 0 },

    // Number of portions the recipe makes
    servings: { type: Number, min: 1, default: 1 },

    // Mongoose timestamps option below adds createdAt/updatedAt automatically
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Compound text index enables the $text search operator used in buildMealQuery
mealSchema.index({ meal_name: "text", description: "text" });
// Single-field indexes speed up the most common filter queries
mealSchema.index({ disease_type: 1 });
mealSchema.index({ createdAt: -1 });

export default mongoose.model("Meal", mealSchema);
