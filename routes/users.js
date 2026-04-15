import express from "express";
import User from "../models/User.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { validateUpdateProfile } from "../middleware/validators.js";

const router = express.Router();

/**
 * @route   GET /api/users/profile
 * @desc    Get logged-in user's profile
 * @access  Private
 */
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("favoritesMeals", "meal_name description calories")
      .populate("mealHistory.meal", "meal_name disease_type sugar_level");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      data: user
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving profile",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Update logged-in user's profile
 * @access  Private
 */
router.put("/profile", authMiddleware, validateUpdateProfile, async (req, res) => {
  try {
    const { profile } = req.body;
    const existingUser = await User.findById(req.user.id);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = await User.findByIdAndUpdate(req.user.id, {
      profile: {
        ...(existingUser.profile?.toObject?.() || existingUser.profile || {}),
        ...(profile || {})
      },
      updatedAt: new Date()
    }, { new: true, runValidators: true });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating profile",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/users/favorites/:mealId
 * @desc    Add meal to favorites
 * @access  Private
 */
router.post("/favorites/:mealId", authMiddleware, async (req, res) => {
  try {
    const { mealId } = req.params;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $addToSet: { favoritesMeals: mealId }
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Meal added to favorites",
      data: user.favoritesMeals
    });
  } catch (error) {
    console.error("Add favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding to favorites",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   DELETE /api/users/favorites/:mealId
 * @desc    Remove meal from favorites
 * @access  Private
 */
router.delete("/favorites/:mealId", authMiddleware, async (req, res) => {
  try {
    const { mealId } = req.params;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $pull: { favoritesMeals: mealId }
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Meal removed from favorites",
      data: user.favoritesMeals
    });
  } catch (error) {
    console.error("Remove favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Error removing from favorites",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/users/favorites
 * @desc    Get user's favorite meals
 * @access  Private
 */
router.get("/favorites", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("favoritesMeals");

    res.status(200).json({
      success: true,
      message: "Favorites retrieved successfully",
      data: user.favoritesMeals
    });
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving favorites",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/users/meal-history
 * @desc    Add meal to user's meal history
 * @access  Private
 */
router.post("/meal-history", authMiddleware, async (req, res) => {
  try {
    const { mealId, rating, notes } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $push: {
          mealHistory: {
            meal: mealId,
            rating: rating || null,
            notes: notes || null,
            date: new Date()
          }
        }
      },
      { new: true }
    ).populate("mealHistory.meal");

    res.status(200).json({
      success: true,
      message: "Meal added to history",
      data: user.mealHistory
    });
  } catch (error) {
    console.error("Add meal history error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding to meal history",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/users/meal-history
 * @desc    Get user's meal history
 * @access  Private
 */
router.get("/meal-history", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const user = await User.findById(req.user.id)
      .populate({
        path: "mealHistory.meal",
        select: "meal_name disease_type sugar_level calories"
      });

    const totalHistory = user.mealHistory.length;
    const history = user.mealHistory
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      message: "Meal history retrieved successfully",
      data: history,
      pagination: {
        total: totalHistory,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalHistory / limitNum)
      }
    });
  } catch (error) {
    console.error("Get meal history error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving meal history",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/users (Admin only)
 * @desc    Get all users
 * @access  Private/Admin
 */
router.get("/", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, sort = "-createdAt" } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Parse sort
    const sortObj = {};
    if (sort) {
      const fields = sort.split(",");
      fields.forEach(field => {
        if (field.startsWith("-")) {
          sortObj[field.substring(1)] = -1;
        } else {
          sortObj[field] = 1;
        }
      });
    }

    const users = await User.find()
      .select("-password")
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);

    const total = await User.countDocuments();

    res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      data: users,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

export default router;
