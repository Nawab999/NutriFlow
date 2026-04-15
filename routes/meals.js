import express from "express";
import Meal from "../models/Meal.js";
import User from "../models/User.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { validateCreateMeal, validateUpdateMeal, validateMealQuery } from "../middleware/validators.js";
import { parseSort, getMostFrequentValue, scoreMealForUser } from "../utils/mealUtils.js";

const router = express.Router();

/**
 * @route   GET /api/meals
 * @desc    Get all meals with search, filter, sort, and pagination
 * @access  Public
 * @query   page, limit, q (search), sort, sugar_level, salt_level, disease_type, temperature
 */
router.get("/", validateMealQuery, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      q,
      sort = "-createdAt",
      maxPrice,
      maxCalories,
      minProtein,
      ...filters
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Build search query
    let query = {};

    // ✅ SEARCH: Search by meal_name or description
    if (q) {
      query.$or = [
        { meal_name: { $regex: q, $options: "i" } }, // Case-insensitive regex
        { description: { $regex: q, $options: "i" } }
      ];
    }

    // ✅ FILTER: Filter by specific fields
    const validFilterFields = ["disease_type", "sugar_level", "salt_level", "temperature"];
    validFilterFields.forEach(field => {
      if (filters[field]) {
        query[field] = filters[field];
      }
    });

    // Handle numeric filters (e.g., expiry_days[gte]=10)
    if (filters.expiry_days) {
      const expiryFilter = filters.expiry_days;
      if (typeof expiryFilter === "object") {
        query.expiry_days = expiryFilter;
      } else {
        query.expiry_days = parseInt(expiryFilter);
      }
    }

    if (maxPrice) {
      query.price = {
        ...(query.price || {}),
        $lte: parseFloat(maxPrice)
      };
    }

    if (maxCalories) {
      query.calories = {
        ...(query.calories || {}),
        $lte: parseFloat(maxCalories)
      };
    }

    if (minProtein) {
      query.protein = {
        ...(query.protein || {}),
        $gte: parseFloat(minProtein)
      };
    }

    // Get total count for pagination
    const total = await Meal.countDocuments(query);

    // ✅ SORT: Parse sort parameter
    const sortObj = parseSort(sort);

    // ✅ PAGINATION: Calculate skip
    const skip = (pageNum - 1) * limitNum;

    // Execute query
    const meals = await Meal.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .exec();

    res.status(200).json({
      success: true,
      message: "Meals retrieved successfully",
      data: meals,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error("Get meals error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving meals",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/meals/recommendations
 * @desc    Get personalized meal recommendations for the logged-in user
 * @access  Private
 */
router.get("/recommendations", authMiddleware, async (req, res) => {
  try {
    const requestedLimit = parseInt(req.query.limit || "6", 10);
    const limit = Number.isNaN(requestedLimit) ? 6 : Math.min(requestedLimit, 12);
    const user = await User.findById(req.user.id)
      .populate("favoritesMeals", "disease_type sugar_level temperature")
      .populate("mealHistory.meal", "disease_type sugar_level temperature");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const recentMeals = user.mealHistory
      .map(entry => entry.meal)
      .filter(Boolean)
      .slice(-12);

    const favoriteMeals = user.favoritesMeals || [];
    const preferenceProfile = {
      condition:
        req.query.disease_type ||
        user.profile?.primaryCondition ||
        getMostFrequentValue([
          ...recentMeals.map(meal => meal.disease_type),
          ...favoriteMeals.map(meal => meal.disease_type)
        ]),
      sugar:
        req.query.sugar_level ||
        user.profile?.preferredSugarLevel ||
        getMostFrequentValue([
          ...recentMeals.map(meal => meal.sugar_level),
          ...favoriteMeals.map(meal => meal.sugar_level)
        ]),
      temperature:
        req.query.temperature ||
        user.profile?.preferredTemperature ||
        getMostFrequentValue([
          ...recentMeals.map(meal => meal.temperature),
          ...favoriteMeals.map(meal => meal.temperature)
        ]),
      goal: user.profile?.wellnessGoal || "",
      dailyBudget: user.profile?.dailyBudget || null
    };

    const mealQuery = {};

    if (req.query.maxPrice) {
      mealQuery.price = { $lte: parseFloat(req.query.maxPrice) };
    }

    if (req.query.maxCalories) {
      mealQuery.calories = {
        ...(mealQuery.calories || {}),
        $lte: parseFloat(req.query.maxCalories)
      };
    }

    if (req.query.minProtein) {
      mealQuery.protein = {
        ...(mealQuery.protein || {}),
        $gte: parseFloat(req.query.minProtein)
      };
    }

    const candidateMeals = await Meal.find(mealQuery)
      .limit(50)
      .sort(parseSort(req.query.sort || "-createdAt"));

    const recommendations = candidateMeals
      .map(meal => {
        const { score, reasons } = scoreMealForUser(meal, preferenceProfile);
        return {
          ...meal.toObject(),
          recommendationScore: score,
          recommendationReason: reasons.join(" - ")
        };
      })
      .sort((a, b) => {
        if (b.recommendationScore !== a.recommendationScore) {
          return b.recommendationScore - a.recommendationScore;
        }

        return (a.price || 0) - (b.price || 0);
      })
      .slice(0, limit);

    res.status(200).json({
      success: true,
      message: "Recommendations retrieved successfully",
      data: recommendations,
      preferencesUsed: preferenceProfile
    });
  } catch (error) {
    console.error("Get recommendations error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving recommendations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/meals/search
 * @desc    Advanced search endpoint
 * @access  Public
 * @query   q (search query), page, limit
 */
router.get("/search", validateMealQuery, async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query (q) is required"
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Use text search
    const meals = await Meal.find(
      { $text: { $search: q } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limitNum);

    const total = await Meal.countDocuments({
      $text: { $search: q }
    });

    res.status(200).json({
      success: true,
      message: "Search results retrieved",
      data: meals,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({
      success: false,
      message: "Error performing search",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/meals/:id
 * @desc    Get single meal by ID
 * @access  Public
 */
router.get("/:id", async (req, res) => {
  try {
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.status(404).json({
        success: false,
        message: "Meal not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Meal retrieved successfully",
      data: meal
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid meal ID format"
      });
    }
    console.error("Get meal error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving meal",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/meals
 * @desc    Create a new meal (Admin only)
 * @access  Private/Admin
 */
router.post("/", authMiddleware, adminMiddleware, validateCreateMeal, async (req, res) => {
  try {
    const mealData = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const meal = await Meal.create(mealData);

    res.status(201).json({
      success: true,
      message: "Meal created successfully",
      data: meal
    });
  } catch (error) {
    console.error("Create meal error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating meal",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   PUT /api/meals/:id
 * @desc    Update a meal (Admin only)
 * @access  Private/Admin
 */
router.put("/:id", authMiddleware, adminMiddleware, validateUpdateMeal, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if meal exists
    let meal = await Meal.findById(id);
    if (!meal) {
      return res.status(404).json({
        success: false,
        message: "Meal not found"
      });
    }

    // Update meal
    meal = await Meal.findByIdAndUpdate(
      id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Meal updated successfully",
      data: meal
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid meal ID format"
      });
    }
    console.error("Update meal error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating meal",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   DELETE /api/meals/:id
 * @desc    Delete a meal (Admin only)
 * @access  Private/Admin
 */
router.delete("/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const meal = await Meal.findByIdAndDelete(id);

    if (!meal) {
      return res.status(404).json({
        success: false,
        message: "Meal not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Meal deleted successfully",
      data: meal
    });
  } catch (error) {
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid meal ID format"
      });
    }
    console.error("Delete meal error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting meal",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

export default router;
