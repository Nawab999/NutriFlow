import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Meal from "../models/Meal.js";
import User from "../models/User.js";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import MealPlan from "../models/MealPlan.js";
import { attachCurrentUser, requirePageAuth, requirePageAdmin, redirectWithMessage } from "../middleware/webAuth.js";
import { buildMealQuery, getRecommendedMeals, parseSort, getMealVisual, scoreMealForUser } from "../utils/mealUtils.js";

const router = express.Router();

const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 1000 * 60 * 60 * 24 * 7
};

router.use(attachCurrentUser);
router.use(async (req, res, next) => {
  res.locals.flash = req.query.message ? {
    text: req.query.message,
    type: req.query.type || "info"
  } : null;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.cartCount = 0;
  if (req.currentUser) {
    try {
      const cart = await Cart.findOne({ user: req.currentUser._id });
      res.locals.cartCount = cart?.items?.length || 0;
    } catch {}
  }
  next();
});

const renderPage = (res, page, locals = {}) => {
  res.render(`pages/${page}`, {
    pageTitle: "NutriFlow",
    errors: [],
    formData: {},
    getMealVisual,
    savedMeals: [],
    groceryMealIds: [],
    ...locals
  });
};

const getSafeRedirectPath = (redirectTo, fallback) => {
  if (!redirectTo || typeof redirectTo !== "string") {
    return fallback;
  }

  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    return fallback;
  }

  return redirectTo;
};

const createToken = user => jwt.sign(
  { id: user._id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRE }
);

const normalizeMealInput = body => ({
  meal_name: body.meal_name?.trim(),
  disease_type: body.disease_type || "None",
  sugar_level: body.sugar_level || "Medium",
  salt_level: body.salt_level || "Medium",
  temperature: body.temperature || "Warm",
  expiry_days: Number(body.expiry_days) || 7,
  calories: Number(body.calories) || 0,
  protein: Number(body.protein) || 0,
  price: Number(body.price) || 0,
  imageUrl: body.imageUrl?.trim() || "",
  description: body.description?.trim() || ""
});

const validateAuthForm = ({ username, email, password }, isRegister = false) => {
  const errors = [];

  if (isRegister && (!username || username.trim().length < 3)) {
    errors.push("Username must be at least 3 characters.");
  }

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.push("Please enter a valid email address.");
  }

  if (!password || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}/.test(password)) {
    errors.push("Password must contain uppercase, lowercase, and a number.");
  }

  return errors;
};

const validateMealForm = meal => {
  const errors = [];
  if (!meal.meal_name || meal.meal_name.length < 2) errors.push("Meal name is required.");
  if (meal.price < 0) errors.push("Price must be a positive number.");
  if (meal.calories < 0) errors.push("Calories must be a positive number.");
  if (meal.protein < 0) errors.push("Protein must be a positive number.");
  if (meal.imageUrl) {
    try {
      new URL(meal.imageUrl);
    } catch {
      errors.push("Image URL must be a valid full URL.");
    }
  }
  return errors;
};

const getDashboardData = async userId => {
  const user = await User.findById(userId)
    .select("-password")
    .populate("favoritesMeals")
    .populate("mealHistory.meal");
  const cart = await Cart.findOne({ user: userId }).populate("items.meal");
  const orders = await Order.find({ user: userId }).populate("items.meal").sort({ createdAt: -1 }).limit(6);
  const recommendations = await getRecommendedMeals(user, {}, 6);

  return { user, cart, orders, recommendations };
};

router.get("/", async (req, res, next) => {
  try {
    const featuredMeals = await Meal.find().sort({ createdAt: -1 }).limit(6);
    const mealCount = await Meal.countDocuments();
    const userCount = await User.countDocuments();

    renderPage(res, "home", {
      pageTitle: "NutriFlow | Home",
      featuredMeals,
      stats: { mealCount, userCount }
    });
  } catch (err) { next(err); }
});

router.get("/login", (req, res) => {
  if (req.currentUser) return res.redirect("/dashboard");
  renderPage(res, "login", { pageTitle: "NutriFlow | Login" });
});

router.post("/login", async (req, res, next) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const { password = "" } = req.body;
    const errors = validateAuthForm({ email, password });

    if (errors.length) {
      return renderPage(res, "login", { pageTitle: "NutriFlow | Login", errors, formData: { email } });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return renderPage(res, "login", {
        pageTitle: "NutriFlow | Login",
        errors: ["Invalid email or password."],
        formData: { email }
      });
    }

    res.cookie("authToken", createToken(user), authCookieOptions);
    res.redirect("/dashboard?message=Welcome back&type=success");
  } catch (err) { next(err); }
});

router.get("/register", (req, res) => {
  if (req.currentUser) return res.redirect("/dashboard");
  renderPage(res, "register", { pageTitle: "NutriFlow | Register" });
});

router.post("/register", async (req, res, next) => {
  try {
    const username = (req.body.username || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const { password = "" } = req.body;
    const errors = validateAuthForm({ username, email, password }, true);

    if (errors.length) {
      return renderPage(res, "register", { pageTitle: "NutriFlow | Register", errors, formData: { username, email } });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return renderPage(res, "register", {
        pageTitle: "NutriFlow | Register",
        errors: ["An account already exists with that email or username."],
        formData: { username, email }
      });
    }

    await User.create({
      username,
      email,
      password: await bcrypt.hash(password, 10),
      role: "user"
    });

    res.clearCookie("authToken");
    res.redirect("/login?message=Account created successfully. Please log in.&type=success");
  } catch (err) { next(err); }
});

router.post("/logout", (req, res) => {
  res.clearCookie("authToken");
  res.redirect("/login?message=You have been logged out&type=success");
});

// ── Prescription: drug-food interaction rules ─────────────────────────────────
// Maps medication keywords → foods/ingredients to flag
const DRUG_FOOD_INTERACTIONS = {
  // Statins
  statin:       { foods: ["grapefruit","pomelo"], reason: "Grapefruit interferes with statin metabolism and can increase side-effects." },
  simvastatin:  { foods: ["grapefruit","pomelo"], reason: "Grapefruit juice raises simvastatin blood levels significantly." },
  atorvastatin: { foods: ["grapefruit","pomelo"], reason: "Grapefruit can increase atorvastatin levels in blood." },
  lovastatin:   { foods: ["grapefruit","pomelo"], reason: "Grapefruit inhibits the enzyme that breaks down lovastatin." },
  // Warfarin / blood thinners
  warfarin:     { foods: ["spinach","kale","broccoli","cabbage","brussels sprouts","parsley","green tea"], reason: "High vitamin K foods reduce warfarin effectiveness." },
  coumadin:     { foods: ["spinach","kale","broccoli","cabbage","brussels sprouts","parsley","green tea"], reason: "Vitamin K-rich foods interfere with this blood thinner." },
  // MAOIs (antidepressants)
  maoi:         { foods: ["aged cheese","cured meat","salami","sausage","soy sauce","beer","wine","yeast"], reason: "Tyramine-rich foods with MAOIs can cause dangerous blood pressure spikes." },
  phenelzine:   { foods: ["aged cheese","cured meat","salami","sausage","soy sauce","beer","wine","yeast"], reason: "Avoid tyramine-rich foods with this antidepressant." },
  // ACE inhibitors / potassium-sparing diuretics
  lisinopril:   { foods: ["banana","orange","potato","spinach","avocado"], reason: "High-potassium foods may cause dangerous potassium build-up with ACE inhibitors." },
  spironolactone:{ foods: ["banana","orange","potato","spinach","avocado"], reason: "Potassium-sparing diuretics — avoid high-potassium foods." },
  // Antibiotics
  tetracycline: { foods: ["milk","dairy","cheese","yogurt","calcium"], reason: "Dairy binds to tetracycline and stops it being absorbed." },
  ciprofloxacin:{ foods: ["milk","dairy","cheese","yogurt","calcium","antacid"], reason: "Dairy and calcium reduce ciprofloxacin absorption." },
  // Thyroid medication
  levothyroxine:{ foods: ["soy","soya","tofu","kale","broccoli","cabbage","fiber","high-fibre"], reason: "These foods can interfere with levothyroxine absorption — take medication separately." },
  // Diabetes medications
  metformin:    { foods: ["alcohol","beer","wine","spirits"], reason: "Alcohol with metformin raises risk of lactic acidosis." },
  insulin:      { foods: ["alcohol","beer","wine","spirits"], reason: "Alcohol can cause dangerous blood sugar drops with insulin." }
};

// Parse prescription text → extract restriction keywords and medications
const parsePrescriptionText = (text) => {
  if (!text) return { restrictions: [], medications: [] };
  const lower = text.toLowerCase();

  // Extract avoid/restrict keywords
  const restrictPatterns = [
    /avoid\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /restrict\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /do not eat\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /no\s+([\w\s]+?)(?:\.|,|\n|and |in your|from your|$)/gi,
    /limit\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /reduce\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /cut out\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi,
    /eliminate\s+([\w\s,]+?)(?:\.|,|\n|and |$)/gi
  ];

  const restrictions = new Set();
  for (const pattern of restrictPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      match[1].split(/,|and /).map(s => s.trim()).filter(s => s.length > 2 && s.length < 40)
        .forEach(s => restrictions.add(s));
    }
  }

  // Extract medication names (look for known keywords + generic patterns)
  const knownMedications = Object.keys(DRUG_FOOD_INTERACTIONS);
  const medications = new Set();
  for (const med of knownMedications) {
    if (lower.includes(med)) medications.add(med);
  }
  // Also catch "prescribed: X" / "taking: X" / "medication: X" patterns
  const medPatterns = [
    /prescribed[:\s]+([\w\s,]+?)(?:\.|,|\n|$)/gi,
    /taking[:\s]+([\w\s,]+?)(?:\.|,|\n|$)/gi,
    /medication[s]?[:\s]+([\w\s,]+?)(?:\.|,|\n|$)/gi,
    /drug[s]?[:\s]+([\w\s,]+?)(?:\.|,|\n|$)/gi
  ];
  for (const pattern of medPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      match[1].split(/,|and /).map(s => s.trim()).filter(s => s.length > 2 && s.length < 40)
        .forEach(s => medications.add(s));
    }
  }

  return {
    restrictions: [...restrictions],
    medications: [...medications]
  };
};

// Check a meal against a user's prescription — returns array of conflict objects
const checkMealPrescriptionConflicts = (meal, prescriptionProfile) => {
  if (!prescriptionProfile) return [];
  const conflicts = [];
  const mealText = [
    meal.meal_name,
    meal.description || "",
    ...(meal.ingredients || [])
  ].join(" ").toLowerCase();

  // Check extracted dietary restrictions
  for (const restriction of (prescriptionProfile.extractedRestrictions || [])) {
    const r = restriction.toLowerCase().trim();
    if (r.length > 2 && mealText.includes(r)) {
      conflicts.push({
        type: "dietary",
        item: restriction,
        reason: `Your prescription says to avoid "${restriction}".`
      });
    }
  }

  // Check drug-food interactions
  for (const med of (prescriptionProfile.medications || [])) {
    const rule = DRUG_FOOD_INTERACTIONS[med.toLowerCase()];
    if (!rule) continue;
    for (const food of rule.foods) {
      if (mealText.includes(food.toLowerCase())) {
        conflicts.push({
          type: "drug-food",
          item: `${med} + ${food}`,
          reason: rule.reason
        });
      }
    }
  }

  return conflicts;
};

// ── Prescription page ─────────────────────────────────────────────────────────
router.get("/prescription", requirePageAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.currentUser._id).select("-password");
    const prescription = user?.profile?.prescription || {};
    const complianceReport = buildComplianceReport(user);

    renderPage(res, "prescription", {
      pageTitle: "NutriFlow | Prescription",
      prescription,
      complianceReport,
      drugInteractionRules: DRUG_FOOD_INTERACTIONS
    });
  } catch (err) { next(err); }
});

router.post("/prescription", requirePageAuth, async (req, res, next) => {
  try {
    const rawText = (req.body.prescriptionText || "").trim().slice(0, 3000);
    const { restrictions, medications } = parsePrescriptionText(rawText);

    const manualMeds = (req.body.medications || "").split(",")
      .map(s => s.trim().toLowerCase()).filter(Boolean);
    const allMeds = [...new Set([...medications, ...manualMeds])];

    const manualRestrictions = (req.body.manualRestrictions || "").split(",")
      .map(s => s.trim().toLowerCase()).filter(Boolean);
    const allRestrictions = [...new Set([...restrictions, ...manualRestrictions])];

    await User.updateOne({ _id: req.currentUser._id }, {
      $set: {
        "profile.prescription.rawText": rawText,
        "profile.prescription.extractedRestrictions": allRestrictions,
        "profile.prescription.medications": allMeds,
        "profile.prescription.uploadedAt": new Date()
      }
    });

    res.redirect("/prescription?message=Prescription saved and analysed&type=success");
  } catch (err) { next(err); }
});

router.post("/prescription/clear", requirePageAuth, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.currentUser._id }, {
      $set: {
        "profile.prescription.rawText": "",
        "profile.prescription.extractedRestrictions": [],
        "profile.prescription.medications": [],
        "profile.prescription.uploadedAt": null
      }
    });
    res.redirect("/prescription?message=Prescription cleared&type=success");
  } catch (err) { next(err); }
});

// Build 7-day compliance report for a user
const buildComplianceReport = (user) => {
  const prescription = user?.profile?.prescription;
  const hasRestrictions = prescription?.extractedRestrictions?.length || prescription?.medications?.length;
  if (!hasRestrictions) return null;

  const today = new Date(); today.setHours(23, 59, 59, 999);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);

  const recentHistory = (user.mealHistory || []).filter(h => {
    const d = new Date(h.date);
    return d >= weekAgo && d <= today && h.meal;
  });

  // Group by day — tracked=false until a meal is logged that day
  const dayMap = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    dayMap[d.toDateString()] = { date: new Date(d), compliant: true, tracked: false, violations: [] };
  }

  for (const entry of recentHistory) {
    const d = new Date(entry.date); d.setHours(0, 0, 0, 0);
    const key = d.toDateString();
    if (!dayMap[key]) continue;
    dayMap[key].tracked = true; // at least one meal logged this day
    const conflicts = checkMealPrescriptionConflicts(entry.meal, prescription);
    if (conflicts.length) {
      dayMap[key].compliant = false;
      dayMap[key].violations.push(...conflicts);
    }
  }

  const days = Object.values(dayMap).sort((a, b) => a.date - b.date);
  // Only count days where meals were actually logged AND no conflicts occurred
  const compliantDays = days.filter(d => d.tracked && d.compliant).length;
  const trackedDays = days.filter(d => d.tracked).length;

  return { days, compliantDays, totalDays: 7, trackedDays };
};

// Toggle Cook / Order mode
router.post("/toggle-cook-mode", requirePageAuth, async (req, res) => {
  try {
    const user = await User.findById(req.currentUser._id);
    const current = user?.profile?.cookMode || false;
    await User.updateOne({ _id: req.currentUser._id }, { $set: { "profile.cookMode": !current } });
    return res.json({ cookMode: !current });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/meals", async (req, res, next) => { try {
  const page      = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit     = 12;
  const mealType  = req.query.mealType || "All"; // "All" | "Breakfast" | "Lunch" | "Dinner"

  let favoritedIds = [];
  let userProfile  = null;
  let dailySuggestions = { breakfast: [], lunch: [], dinner: [] };
  let u = null;

  let groceryMealIds = [];
  if (req.currentUser) {
    u = await User.findById(req.currentUser._id).select("favoritesMeals groceryMeals profile");
    favoritedIds   = (u?.favoritesMeals || []).map(id => id.toString());
    groceryMealIds = (u?.groceryMeals   || []).map(id => id.toString());
    userProfile    = u?.profile || null;
  }

  // Build hard-exclude query from profile (allergies + avoid list)
  const profileExclude = {};
  if (userProfile) {
    const allergies = (userProfile.allergies || []).filter(a => a !== "None");
    if (allergies.length) profileExclude.allergens = { $nin: allergies };

    const avoidList = (userProfile.dietaryRestrictions?.avoidIngredients || [])
      .map(s => s.trim()).filter(Boolean);
    if (avoidList.length) {
      profileExclude.$and = avoidList.map(ingredient => ({
        meal_name: { $not: new RegExp(ingredient, "i") }
      }));
    }
  }

  // Meal type filter
  const typeQuery = {};
  if (mealType !== "All") {
    typeQuery.mealType = { $in: [mealType, "Any"] };
  }

  const baseQuery = { ...profileExclude, ...typeQuery };

  // Fetch more than page limit so we can score+sort by profile relevance
  const fetchLimit = limit * 5;
  const skip = (page - 1) * limit;

  let allMeals = await Meal.find(baseQuery).sort({ createdAt: -1 }).limit(fetchLimit + skip);

  // Score by profile if user is logged in
  if (userProfile) {
    const prefProfile = {
      condition:          userProfile.primaryCondition || "",
      sugar:              userProfile.preferredSugarLevel || "",
      temperature:        userProfile.preferredTemperature || "",
      goal:               userProfile.wellnessGoal || "",
      fitnessGoal:        userProfile.fitnessGoal || "",
      dailyBudget:        userProfile.dailyBudget || null,
      allergies:          (userProfile.allergies || []).filter(a => a !== "None"),
      avoidIngredients:   userProfile.dietaryRestrictions?.avoidIngredients || [],
      includeIngredients: userProfile.dietaryRestrictions?.includeIngredients || []
    };

    allMeals = allMeals
      .map(meal => {
        const { score } = scoreMealForUser(meal.toObject ? meal.toObject() : meal, prefProfile);
        return { meal, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ meal }) => meal);
  }

  const total = await Meal.countDocuments(baseQuery);
  const meals = allMeals.slice(skip, skip + limit);

  // Daily suggestions banner (logged-in only)
  if (userProfile) {
    const fitnessGoal = userProfile.fitnessGoal || "";
    const calorieGoal = userProfile.dailyCalorieGoal || 2000;
    let goalCalorie   = calorieGoal;
    if (fitnessGoal === "Weight Loss")  goalCalorie = Math.min(calorieGoal, 1600);
    if (fitnessGoal === "Weight Gain")  goalCalorie = Math.max(calorieGoal, 2500);
    if (fitnessGoal === "Build Muscle") goalCalorie = Math.max(calorieGoal, 2200);

    const bCal = Math.round(goalCalorie * 0.25);
    const lCal = Math.round(goalCalorie * 0.40);
    const dCal = Math.round(goalCalorie * 0.35);

    const profQ = { ...profileExclude };
    if (userProfile.primaryCondition && userProfile.primaryCondition !== "None")
      profQ.disease_type = userProfile.primaryCondition;

    const [bMeals, lMeals, dMeals] = await Promise.all([
      Meal.find({ ...profQ, mealType: { $in: ["Breakfast","Any"] }, calories: { $lte: bCal + 150 } }).limit(4),
      Meal.find({ ...profQ, mealType: { $in: ["Lunch","Any"] },     calories: { $lte: lCal + 200 } }).limit(4),
      Meal.find({ ...profQ, mealType: { $in: ["Dinner","Any"] },    calories: { $lte: dCal + 200 } }).limit(4),
    ]);
    dailySuggestions = { breakfast: bMeals, lunch: lMeals, dinner: dMeals };
  }

  const cookMode = req.currentUser?.profile?.cookMode || false;
  const userPrescription = u?.profile?.prescription || null;

  // Build conflict map: mealId → true/false
  const prescriptionConflictIds = new Set();
  if (userPrescription) {
    for (const meal of meals) {
      const conflicts = checkMealPrescriptionConflicts(meal, userPrescription);
      if (conflicts.length) prescriptionConflictIds.add(meal._id.toString());
    }
  }

  renderPage(res, "meals", {
    pageTitle: "NutriFlow | Meals",
    meals,
    mealType,
    favoritedIds,
    groceryMealIds,
    userProfile,
    userPrescription,
    prescriptionConflictIds: [...prescriptionConflictIds],
    dailySuggestions,
    cookMode,
    pagination: {
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      total,
      limit
    }
  });
  } catch (err) { next(err); }
});

router.get("/meals/:id", async (req, res, next) => {
  try {
    const meal = await Meal.findById(req.params.id);
    if (!meal) return redirectWithMessage(res, "/meals", "Meal not found.");

    const relatedMeals = await Meal.find({
      _id: { $ne: meal._id },
      disease_type: meal.disease_type
    }).limit(4);

    let isFavorited = false;
    let cookMode = false;
    let prescriptionConflicts = [];
    if (req.currentUser) {
      const u = await User.findById(req.currentUser._id).select("favoritesMeals profile.cookMode profile.prescription");
      isFavorited = (u?.favoritesMeals || []).map(id => id.toString()).includes(meal._id.toString());
      cookMode = u?.profile?.cookMode || false;
      prescriptionConflicts = checkMealPrescriptionConflicts(meal, u?.profile?.prescription);
    }

    renderPage(res, "meal-detail", {
      pageTitle: `NutriFlow | ${meal.meal_name}`,
      meal,
      relatedMeals,
      isFavorited,
      cookMode,
      prescriptionConflicts
    });
  } catch (err) { next(err); }
});

router.post("/meals/:id/favorite", requirePageAuth, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.currentUser._id, { $addToSet: { favoritesMeals: req.params.id } });
    res.redirect(getSafeRedirectPath(req.body.redirectTo, "/dashboard?message=Meal saved to favorites&type=success"));
  } catch (err) { next(err); }
});

router.post("/meals/:id/unfavorite", requirePageAuth, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.currentUser._id, { $pull: { favoritesMeals: req.params.id } });
    res.redirect(getSafeRedirectPath(req.body.redirectTo, "/dashboard?message=Meal removed from favorites&type=success"));
  } catch (err) { next(err); }
});

router.post("/history", requirePageAuth, async (req, res, next) => {
  try {
    const { mealId, rating, notes, redirectTo } = req.body;
    await User.findByIdAndUpdate(req.currentUser._id, {
      $push: {
        mealHistory: {
          meal: mealId,
          rating: Number(rating) || undefined,
          notes: notes?.trim() || "",
          date: new Date()
        }
      }
    });
    res.redirect(getSafeRedirectPath(redirectTo, "/dashboard?message=Meal added to history&type=success"));
  } catch (err) { next(err); }
});

// ── Meal Planner ────────────────────────────────────────────────────────────

const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const SLOTS = ["breakfast","lunch","dinner"];

// Get start of the week (Monday) for a given date
const getWeekStart = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
};

// ── Helper: populate all slots in a plan ─────────────────────────────────────
const populatePlan = (planQuery) =>
  planQuery
    .populate("days.monday.breakfast.meal days.monday.lunch.meal days.monday.dinner.meal")
    .populate("days.tuesday.breakfast.meal days.tuesday.lunch.meal days.tuesday.dinner.meal")
    .populate("days.wednesday.breakfast.meal days.wednesday.lunch.meal days.wednesday.dinner.meal")
    .populate("days.thursday.breakfast.meal days.thursday.lunch.meal days.thursday.dinner.meal")
    .populate("days.friday.breakfast.meal days.friday.lunch.meal days.friday.dinner.meal")
    .populate("days.saturday.breakfast.meal days.saturday.lunch.meal days.saturday.dinner.meal")
    .populate("days.sunday.breakfast.meal days.sunday.lunch.meal days.sunday.dinner.meal");

router.get("/planner", requirePageAuth, async (req, res) => {
  const weekOffset = parseInt(req.query.week || "0", 10);
  const weekStart = getWeekStart();
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);

  let plan = await populatePlan(MealPlan.findOne({ user: req.currentUser._id }));
  if (!plan) {
    plan = await MealPlan.create({ user: req.currentUser._id, weekStart });
    plan = await populatePlan(MealPlan.findOne({ user: req.currentUser._id }));
  }

  const weekDates = DAYS.map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Nutrition totals per day — iterate arrays
  const dayTotals = {};
  for (const day of DAYS) {
    let cal = 0, pro = 0, price = 0;
    for (const slot of SLOTS) {
      const items = plan.days[day]?.[slot] || [];
      for (const item of items) {
        const m = item.meal;
        if (m) { cal += m.calories || 0; pro += m.protein || 0; price += m.price || 0; }
      }
    }
    dayTotals[day] = { calories: cal, protein: pro, price };
  }

  const weekTotals = Object.values(dayTotals).reduce((acc, t) => ({
    calories: acc.calories + t.calories,
    protein:  acc.protein  + t.protein,
    price:    acc.price    + t.price
  }), { calories: 0, protein: 0, price: 0 });

  // Fetch user profile
  const plannerUser = await User.findById(req.currentUser._id).select("profile");
  const userProfile = plannerUser?.profile || {};
  const calorieGoal = userProfile.dailyCalorieGoal || 2000;

  // Picker query
  const search     = req.query.search?.trim() || "";
  const pickerSlot = req.query.pickerSlot || "";

  const pickerQuery = {};
  if (search) {
    pickerQuery.$or = [
      { meal_name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];
  }
  if (pickerSlot && SLOTS.includes(pickerSlot)) {
    const slotType = pickerSlot.charAt(0).toUpperCase() + pickerSlot.slice(1);
    pickerQuery.mealType = { $in: [slotType, "Any"] };
  }
  const userAllergies = (userProfile.allergies || []).filter(a => a !== "None");
  if (userAllergies.length) pickerQuery.allergens = { $nin: userAllergies };

  const avoidList = (userProfile.dietaryRestrictions?.avoidIngredients || [])
    .map(s => s.trim()).filter(Boolean);
  if (avoidList.length) {
    pickerQuery.$and = pickerQuery.$and || [];
    avoidList.forEach(ingredient => {
      pickerQuery.$and.push({ meal_name: { $not: new RegExp(ingredient, "i") } });
    });
  }

  const conditionFilter = userProfile.primaryCondition && userProfile.primaryCondition !== "None"
    ? userProfile.primaryCondition : null;

  let pickerMeals = await Meal.find(pickerQuery).sort({ meal_name: 1 }).limit(80);
  if (conditionFilter) {
    pickerMeals = [
      ...pickerMeals.filter(m => m.disease_type === conditionFilter),
      ...pickerMeals.filter(m => m.disease_type !== conditionFilter)
    ].slice(0, 50);
  } else {
    pickerMeals = pickerMeals.slice(0, 50);
  }

  renderPage(res, "planner", {
    pageTitle: "NutriFlow | Weekly Planner",
    plan, weekStart, weekDates, weekOffset,
    DAYS, SLOTS, dayTotals, weekTotals,
    pickerMeals, search, pickerSlot,
    calorieGoal, userProfile
  });
});

// Add a meal to a slot (array push)
router.post("/planner/set", requirePageAuth, async (req, res) => {
  const { day, slot, mealId, weekOffset } = req.body;
  if (!DAYS.includes(day) || !SLOTS.includes(slot) || !mealId) {
    return res.redirect("/planner?message=Invalid+slot&type=error");
  }
  const weekStart = getWeekStart();
  let plan = await MealPlan.findOne({ user: req.currentUser._id });
  if (!plan) plan = await MealPlan.create({ user: req.currentUser._id, weekStart });

  // Push meal into the slot array
  await MealPlan.updateOne(
    { user: req.currentUser._id },
    { $push: { [`days.${day}.${slot}`]: { meal: mealId } } }
  );
  res.redirect(`/planner?week=${weekOffset || 0}&message=Meal+added+to+planner&type=success`);
});

// Remove a specific item from a slot by its _id
router.post("/planner/clear", requirePageAuth, async (req, res) => {
  try {
    const { day, slot, itemId, weekOffset } = req.body;

    if (!DAYS.includes(day) || !SLOTS.includes(slot) || !itemId) {
      return res.redirect(`/planner?week=${weekOffset||0}&message=Invalid+request&type=error`);
    }

    const plan = await MealPlan.findOne({ user: req.currentUser._id });
    if (plan) {
      const arr = plan.days[day]?.[slot];
      if (Array.isArray(arr)) {
        const idx = arr.findIndex(i => i._id.toString() === itemId);
        if (idx !== -1) {
          arr.splice(idx, 1);
          plan.markModified(`days.${day}.${slot}`);
          await plan.save();
        }
      }
    }

    res.redirect(`/planner?week=${weekOffset || 0}`);
  } catch(err) {
    console.error("planner/clear error:", err);
    res.redirect("/planner?message=Something+went+wrong&type=error");
  }
});

// Clear all items in a single day
router.post("/planner/clear-day", requirePageAuth, async (req, res) => {
  const { day, weekOffset } = req.body;
  if (!DAYS.includes(day)) return res.redirect("/planner?message=Invalid+day&type=error");
  const update = {};
  for (const s of SLOTS) update[`days.${day}.${s}`] = [];
  await MealPlan.updateOne({ user: req.currentUser._id }, { $set: update });
  res.redirect(`/planner?week=${weekOffset || 0}&message=Day+cleared&type=success`);
});

// Clear entire week
router.post("/planner/clear-all", requirePageAuth, async (req, res) => {
  const emptyDays = {};
  for (const d of DAYS) for (const s of SLOTS) emptyDays[`days.${d}.${s}`] = [];
  await MealPlan.updateOne({ user: req.currentUser._id }, { $set: emptyDays });
  res.redirect("/planner?message=Week+cleared&type=success");
});

// Add a single day's meals to cart
router.post("/planner/add-day-to-cart", requirePageAuth, async (req, res) => {
  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
  const { day, weekOffset } = req.body;
  if (!DAYS.includes(day)) {
    if (isAjax) return res.status(400).json({ error: "Invalid day" });
    return res.redirect("/planner?message=Invalid+day&type=error");
  }

  const plan = await MealPlan.findOne({ user: req.currentUser._id });
  if (!plan) {
    if (isAjax) return res.status(404).json({ error: "No plan found" });
    return res.redirect("/planner?message=No+plan+found&type=error");
  }

  const mealIds = [];
  for (const s of SLOTS) {
    const items = plan.days[day]?.[s] || [];
    items.forEach(item => { if (item.meal) mealIds.push(item.meal.toString()); });
  }
  if (!mealIds.length) {
    if (isAjax) return res.json({ ok: true, added: 0, message: "No meals for this day" });
    return res.redirect(`/planner?week=${weekOffset||0}&message=No+meals+for+this+day&type=info`);
  }

  let cart = await Cart.findOne({ user: req.currentUser._id });
  if (!cart) cart = await Cart.create({ user: req.currentUser._id, items: [], totalPrice: 0 });

  for (const mealId of mealIds) {
    const existing = cart.items.find(i => i.meal.toString() === mealId);
    if (existing) existing.quantity += 1;
    else cart.items.push({ meal: mealId, quantity: 1 });
  }

  const meals = await Meal.find({ _id: { $in: cart.items.map(i => i.meal) } });
  cart.totalPrice = cart.items.reduce((sum, item) => {
    const m = meals.find(m => m._id.toString() === item.meal.toString());
    return sum + (m?.price || 0) * item.quantity;
  }, 0);
  await cart.save();

  const cartCount = cart.items.length;
  if (isAjax) return res.json({ ok: true, added: mealIds.length, cartCount });
  res.redirect(`/planner?week=${weekOffset||0}&message=${encodeURIComponent(day.charAt(0).toUpperCase()+day.slice(1))}%27s+meals+added+to+cart&type=success`);
});

// Legacy: add ALL planned meals to cart (kept for backward compat)
router.post("/planner/add-all-to-cart", requirePageAuth, async (req, res) => {
  const plan = await MealPlan.findOne({ user: req.currentUser._id });
  if (!plan) return res.redirect("/planner?message=No+plan+found&type=error");

  const mealIds = [];
  for (const d of DAYS) {
    for (const s of SLOTS) {
      const items = plan.days[d]?.[s] || [];
      items.forEach(item => { if (item.meal) mealIds.push(item.meal.toString()); });
    }
  }

  if (!mealIds.length) return res.redirect("/planner?message=No+meals+in+plan&type=info");

  let cart = await Cart.findOne({ user: req.currentUser._id });
  if (!cart) cart = await Cart.create({ user: req.currentUser._id, items: [], totalPrice: 0 });

  for (const mealId of mealIds) {
    const existing = cart.items.find(i => i.meal.toString() === mealId);
    if (existing) existing.quantity += 1;
    else cart.items.push({ meal: mealId, quantity: 1 });
  }

  const meals = await Meal.find({ _id: { $in: cart.items.map(i => i.meal) } });
  cart.totalPrice = cart.items.reduce((sum, item) => {
    const m = meals.find(m => m._id.toString() === item.meal.toString());
    return sum + (m?.price || 0) * item.quantity;
  }, 0);

  await cart.save();
  res.redirect("/cart?message=All+planned+meals+added+to+cart&type=success");
});

// ── Grocery List ─────────────────────────────────────────────────────────────
router.post("/grocery-list/add", requirePageAuth, async (req, res) => {
  const { mealId, redirectTo } = req.body;
  if (!mealId) return res.redirect(redirectTo || "/meals");
  await User.findByIdAndUpdate(req.currentUser._id, {
    $addToSet: { groceryMeals: mealId }
  });
  const base = redirectTo || "/meals";
  const sep  = base.includes("?") ? "&" : "?";
  res.redirect(`${base}${sep}message=Added+to+grocery+list&type=success`);
});

router.post("/grocery-list/remove", requirePageAuth, async (req, res) => {
  const { mealId } = req.body;
  if (mealId) {
    await User.findByIdAndUpdate(req.currentUser._id, {
      $pull: { groceryMeals: mealId }
    });
  }
  res.redirect("/grocery-list");
});

router.get("/grocery-list", requirePageAuth, async (req, res) => {
  const [plan, userDoc] = await Promise.all([
    populatePlan(MealPlan.findOne({ user: req.currentUser._id })),
    User.findById(req.currentUser._id).populate("groceryMeals").select("groceryMeals")
  ]);

  // Build per-meal cards: { meal, ingredients: [], source: 'planner'|'saved' }
  const mealCards = [];
  const seenIds   = new Set();

  if (plan) {
    for (const day of DAYS) {
      for (const slot of SLOTS) {
        const items = plan.days[day]?.[slot] || [];
        for (const item of items) {
          const m = item.meal;
          if (!m) continue;
          const key = m._id.toString();
          if (!seenIds.has(key)) {
            seenIds.add(key);
            mealCards.push({ meal: m, ingredients: m.ingredients || [], source: "planner" });
          }
        }
      }
    }
  }

  const savedMeals = userDoc?.groceryMeals || [];
  for (const m of savedMeals) {
    const key = m._id.toString();
    if (!seenIds.has(key)) {
      seenIds.add(key);
      mealCards.push({ meal: m, ingredients: m.ingredients || [], source: "saved" });
    }
  }

  renderPage(res, "grocery-list", {
    pageTitle: "NutriFlow | Grocery List",
    mealCards,
    savedMeals,
    hasPlan: mealCards.length > 0
  });
});

router.get("/dashboard", requirePageAuth, async (req, res, next) => {
  try {
  const data = await getDashboardData(req.currentUser._id);
  const user = data.user;

  // ── Daily nutrition (today) ──────────────────────────────────────────────
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
  const todayHistory = user.mealHistory.filter(h => {
    const d = new Date(h.date);
    return d >= todayStart && d <= todayEnd;
  });
  const todayCalories = todayHistory.reduce((s,h) => s + (h.meal?.calories||0), 0);
  const todayProtein  = todayHistory.reduce((s,h) => s + (h.meal?.protein||0), 0);
  const calorieGoal   = user.profile?.dailyCalorieGoal || 2000;
  const proteinGoal   = user.profile?.dailyProteinGoal || 50;

  // ── Weekly chart data (last 7 days) ──────────────────────────────────────
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const dEnd = new Date(d); dEnd.setHours(23,59,59,999);
    const dayItems = user.mealHistory.filter(h => {
      const hd = new Date(h.date); return hd >= d && hd <= dEnd;
    });
    weeklyData.push({
      label: d.toLocaleDateString("en-US",{weekday:"short"}),
      calories: dayItems.reduce((s,h) => s+(h.meal?.calories||0),0),
      protein:  dayItems.reduce((s,h) => s+(h.meal?.protein||0),0)
    });
  }

  // ── Streak ────────────────────────────────────────────────────────────────
  let streak = 0;
  const historyDates = [...new Set(
    user.mealHistory.map(h => new Date(h.date).toDateString())
  )].sort((a,b) => new Date(b)-new Date(a));
  for (let i = 0; i < historyDates.length; i++) {
    const expected = new Date(); expected.setDate(expected.getDate() - i);
    if (historyDates[i] === expected.toDateString()) streak++;
    else break;
  }

  // ── Budget (this week) ────────────────────────────────────────────────────
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0);
  const weekOrders = data.orders.filter(o => new Date(o.createdAt) >= weekStart);
  const weekSpend  = weekOrders.reduce((s,o) => s + (o.totalPrice||0), 0);
  const weekBudget = (user.profile?.dailyBudget || 0) * 7;

  // ── Health tips (by condition) ────────────────────────────────────────────
  const TIPS = {
    Diabetes: [
      "Aim for under 45g of carbs per meal to manage blood sugar.",
      "Choose low-glycaemic foods like legumes, oats and vegetables.",
      "Eating at regular intervals helps maintain stable glucose levels.",
      "Stay hydrated — dehydration raises blood sugar.",
      "Low-sugar meals twice a day can reduce HbA1c significantly."
    ],
    Hypertension: [
      "Keep sodium under 1,500mg per day to lower blood pressure.",
      "Potassium-rich foods like bananas and spinach support heart health.",
      "Limit processed foods — they contain hidden sodium.",
      "Regular small meals are better for blood pressure than large ones.",
      "The DASH diet emphasises fruits, vegetables and low-fat dairy."
    ],
    "Heart Disease": [
      "Choose meals high in omega-3 fatty acids for heart protection.",
      "Limit saturated fats — opt for grilled over fried meals.",
      "Soluble fibre (oats, beans) helps lower LDL cholesterol.",
      "Avoid trans fats found in packaged and fast foods.",
      "Small, frequent meals reduce the workload on your heart."
    ],
    default: [
      "Eating a rainbow of vegetables ensures a wide range of nutrients.",
      "Protein with every meal keeps you satiated and supports muscle.",
      "Drink at least 8 glasses of water a day.",
      "Plan your meals for the week to avoid impulsive unhealthy choices.",
      "Mindful eating — slow down, chew well, enjoy your food."
    ]
  };
  const condition = user.profile?.primaryCondition || "default";
  const tipList = TIPS[condition] || TIPS.default;
  const todayTip = tipList[new Date().getDay() % tipList.length];

  // ── What to eat today ─────────────────────────────────────────────────────
  const alreadyEatenIds = todayHistory.map(h => h.meal?._id?.toString()).filter(Boolean);
  const conditionFilter = condition !== "default" && condition !== "None"
    ? { disease_type: condition } : {};
  const sugarFilter = user.profile?.preferredSugarLevel
    ? { sugar_level: user.profile.preferredSugarLevel } : {};
  const tempFilter = user.profile?.preferredTemperature
    ? { temperature: user.profile.preferredTemperature } : {};

  const suggestQuery = { ...conditionFilter, ...sugarFilter, ...tempFilter,
    _id: { $nin: alreadyEatenIds } };

  const [suggestBreakfast, suggestLunch, suggestDinner] = await Promise.all([
    Meal.findOne(suggestQuery).skip(0).limit(1),
    Meal.findOne(suggestQuery).skip(1).limit(1),
    Meal.findOne(suggestQuery).skip(2).limit(1)
  ]);

  // ── Mini plan preview ──────────────────────────────────────────────────────
  const miniPlan = await populatePlan(MealPlan.findOne({ user: req.currentUser._id }));

  // ── Prescription compliance report ────────────────────────────────────────
  const complianceReport = buildComplianceReport(user);

  renderPage(res, "dashboard", {
    pageTitle: "NutriFlow | Dashboard",
    dashboardUser: user,
    cart: data.cart,
    orders: data.orders,
    recommendations: data.recommendations,
    todayCalories, todayProtein, calorieGoal, proteinGoal,
    weeklyData,
    streak,
    weekSpend, weekBudget,
    todayTip,
    suggestBreakfast, suggestLunch, suggestDinner,
    miniPlan,
    complianceReport
  });
  } catch (err) { next(err); }
});

router.get("/profile", requirePageAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.currentUser._id).select("-password");
    renderPage(res, "profile", { pageTitle: "NutriFlow | Profile", profileUser: user });
  } catch (err) { next(err); }
});

router.post("/profile", requirePageAuth, async (req, res) => {
  const user = await User.findById(req.currentUser._id).select("-password");
  const errors = [];
  const phone = String(req.body.phone ?? "").trim();
  const bio = String(req.body.bio ?? "").trim();
  const dailyBudget = req.body.dailyBudget === undefined ? "" : String(req.body.dailyBudget).trim();

  if (phone && !/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(phone)) {
    errors.push("Please enter a valid phone number.");
  }

  if (dailyBudget && Number(dailyBudget) < 0) {
    errors.push("Daily budget must be a positive number.");
  }

  if (bio.length > 500) {
    errors.push("Bio must not exceed 500 characters.");
  }

  if (errors.length) {
    return renderPage(res, "profile", {
      pageTitle: "NutriFlow | Profile",
      errors,
      profileUser: {
        ...user.toObject(),
        profile: {
          ...(user.profile || {}),
          ...req.body
        }
      }
    });
  }

  // Parse allergies checkboxes (may arrive as string or array)
  const rawAllergies = req.body.allergies
    ? (Array.isArray(req.body.allergies) ? req.body.allergies : [req.body.allergies])
    : [];
  const allergies = rawAllergies.filter(Boolean);

  // Parse avoid / include ingredient lists (comma-separated text fields)
  const avoidIngredients = (req.body.avoidIngredients || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const includeIngredients = (req.body.includeIngredients || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  try {
    await User.findByIdAndUpdate(req.currentUser._id, {
      profile: {
        ...(user.profile?.toObject?.() || user.profile || {}),
        firstName: req.body.firstName?.trim() || "",
        lastName: req.body.lastName?.trim() || "",
        phone,
        bio,
        primaryCondition: req.body.primaryCondition || undefined,
        preferredSugarLevel: req.body.preferredSugarLevel || undefined,
        preferredTemperature: req.body.preferredTemperature || undefined,
        wellnessGoal: req.body.wellnessGoal || undefined,
        fitnessGoal: req.body.fitnessGoal || undefined,
        allergies,
        dietaryRestrictions: { avoidIngredients, includeIngredients },
        dailyBudget: dailyBudget ? Number(dailyBudget) : undefined,
        dailyCalorieGoal: req.body.dailyCalorieGoal ? Number(req.body.dailyCalorieGoal) : 2000,
        dailyProteinGoal: req.body.dailyProteinGoal ? Number(req.body.dailyProteinGoal) : 50
      }
    }, { runValidators: true });
  } catch (error) {
    return renderPage(res, "profile", {
      pageTitle: "NutriFlow | Profile",
      errors: [error.message],
      profileUser: {
        ...user.toObject(),
        profile: {
          ...(user.profile || {}),
          ...req.body
        }
      }
    });
  }

  res.redirect("/profile?message=Profile updated successfully&type=success");
});

router.get("/cart", requirePageAuth, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.currentUser._id }).populate("items.meal");
    renderPage(res, "cart", { pageTitle: "NutriFlow | Cart", cart });
  } catch (err) { next(err); }
});

router.get("/checkout", requirePageAuth, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.currentUser._id }).populate("items.meal");
    if (!cart || !cart.items.length) return redirectWithMessage(res, "/cart", "Your cart is empty.");
    const checkoutUser = await User.findById(req.currentUser._id).select("-password");
    renderPage(res, "checkout", { pageTitle: "NutriFlow | Checkout", cart, checkoutUser });
  } catch (err) { next(err); }
});

router.post("/cart/add", requirePageAuth, async (req, res, next) => {
  try {
    const { mealId, redirectTo } = req.body;
    const quantity = Math.max(Number(req.body.quantity) || 1, 1);
    const meal = await Meal.findById(mealId);
    if (!meal) return redirectWithMessage(res, "/meals", "Meal not found.");

    let cart = await Cart.findOne({ user: req.currentUser._id });
    if (!cart) cart = await Cart.create({ user: req.currentUser._id, items: [], totalPrice: 0 });

    const existingItem = cart.items.find(item => item.meal.toString() === mealId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ meal: mealId, quantity });
    }

    await cart.populate("items.meal");
    cart.totalPrice = cart.items.reduce((sum, item) => sum + ((item.meal?.price || 0) * item.quantity), 0);
    await cart.save();

    res.redirect(getSafeRedirectPath(redirectTo, "/cart?message=Meal added to cart&type=success"));
  } catch (err) { next(err); }
});

router.post("/cart/:mealId/update", requirePageAuth, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.currentUser._id });
    if (!cart) return redirectWithMessage(res, "/cart", "Cart not found.");

    const item = cart.items.find(entry => entry.meal.toString() === req.params.mealId);
    const quantity = Number(req.body.quantity);

    if (!item) return redirectWithMessage(res, "/cart", "Cart item not found.");
    if (quantity <= 0) {
      cart.items = cart.items.filter(entry => entry.meal.toString() !== req.params.mealId);
    } else {
      item.quantity = quantity;
    }

    await cart.populate("items.meal");
    cart.totalPrice = cart.items.reduce((sum, entry) => sum + ((entry.meal?.price || 0) * entry.quantity), 0);
    await cart.save();

    res.redirect("/cart?message=Cart updated&type=success");
  } catch (err) { next(err); }
});

router.post("/cart/:mealId/remove", requirePageAuth, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.currentUser._id });
    if (!cart) return redirectWithMessage(res, "/cart", "Cart not found.");

    cart.items = cart.items.filter(entry => entry.meal.toString() !== req.params.mealId);
    await cart.populate("items.meal");
    cart.totalPrice = cart.items.reduce((sum, entry) => sum + ((entry.meal?.price || 0) * entry.quantity), 0);
    await cart.save();

    res.redirect("/cart?message=Item removed from cart&type=success");
  } catch (err) { next(err); }
});

router.post("/orders", requirePageAuth, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.currentUser._id }).populate("items.meal");
    if (!cart || !cart.items.length) return redirectWithMessage(res, "/cart", "Your cart is empty.");

    await Order.create({
      user: req.currentUser._id,
      items: cart.items,
      totalPrice: cart.totalPrice,
      status: "pending"
    });

    cart.items = [];
    cart.totalPrice = 0;
    await cart.save();

    res.redirect("/dashboard?message=Order placed successfully&type=success");
  } catch (err) { next(err); }
});

router.get("/admin/meals", requirePageAdmin, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = 12;
    const query = buildMealQuery(req.query);
    const total = await Meal.countDocuments(query);
    const meals = await Meal.find(query)
      .sort(parseSort(req.query.sort || "-createdAt"))
      .skip((page - 1) * limit)
      .limit(limit);

    renderPage(res, "admin-meals", {
      pageTitle: "NutriFlow | Admin Meals",
      meals,
      filters: req.query,
      pagination: {
        page,
        pages: Math.max(Math.ceil(total / limit), 1),
        total,
        limit
      }
    });
  } catch (err) { next(err); }
});

router.get("/admin/meals/new", requirePageAdmin, (req, res) => {
  renderPage(res, "meal-form", { pageTitle: "NutriFlow | New Meal", meal: null });
});

router.post("/admin/meals", requirePageAdmin, async (req, res, next) => {
  try {
    const meal = normalizeMealInput(req.body);
    const errors = validateMealForm(meal);
    if (errors.length) return renderPage(res, "meal-form", { pageTitle: "NutriFlow | New Meal", errors, meal });

    await Meal.create(meal);
    res.redirect("/admin/meals?message=Meal created successfully&type=success#admin-meal-results");
  } catch (err) { next(err); }
});

router.get("/admin/meals/:id/edit", requirePageAdmin, async (req, res, next) => {
  try {
    const meal = await Meal.findById(req.params.id);
    if (!meal) return redirectWithMessage(res, "/admin/meals", "Meal not found.");
    renderPage(res, "meal-form", { pageTitle: "NutriFlow | Edit Meal", meal });
  } catch (err) { next(err); }
});

router.post("/admin/meals/:id", requirePageAdmin, async (req, res, next) => {
  try {
    const meal = normalizeMealInput(req.body);
    const errors = validateMealForm(meal);
    if (errors.length) {
      return renderPage(res, "meal-form", { pageTitle: "NutriFlow | Edit Meal", errors, meal: { ...meal, _id: req.params.id } });
    }
    await Meal.findByIdAndUpdate(req.params.id, meal, { runValidators: true });
    res.redirect("/admin/meals?message=Meal updated successfully&type=success#admin-meal-results");
  } catch (err) { next(err); }
});

router.post("/admin/meals/:id/delete", requirePageAdmin, async (req, res, next) => {
  try {
    await Meal.findByIdAndDelete(req.params.id);
    res.redirect("/admin/meals?message=Meal deleted successfully&type=success#admin-meal-results");
  } catch (err) { next(err); }
});

export default router;
