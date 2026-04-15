import express from "express";
import Cart from "../models/Cart.js";
import Meal from "../models/Meal.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route   POST /api/cart/add
 * @desc    Add item to cart
 * @access  Private
 * @body    mealId, quantity
 */
router.post("/add", authMiddleware, async (req, res) => {
  try {
    const { mealId, quantity = 1 } = req.body;
    const userId = req.user.id;

    // Validate meal exists
    const meal = await Meal.findById(mealId);
    if (!meal) {
      return res.status(404).json({ message: "Meal not found" });
    }

    // Find or create cart
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [], totalPrice: 0 });
    }

    // Check if meal already in cart
    const existingItem = cart.items.find(item => item.meal.toString() === mealId);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      cart.items.push({ meal: mealId, quantity });
    }

    // Recalculate total price
    await cart.populate('items.meal');
    cart.totalPrice = cart.items.reduce((total, item) => total + (item.meal.price * item.quantity), 0);

    await cart.save();
    await cart.populate('items.meal', 'meal_name price');

    res.json({ message: "Item added to cart", cart });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   GET /api/cart
 * @desc    Get user's cart
 * @access  Private
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await Cart.findOne({ user: userId }).populate('items.meal', 'meal_name price description');

    if (!cart) {
      return res.json({ items: [], totalPrice: 0 });
    }

    res.json(cart);
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   PUT /api/cart/update
 * @desc    Update item quantity in cart
 * @access  Private
 * @body    mealId, quantity
 */
router.put("/update", authMiddleware, async (req, res) => {
  try {
    const { mealId, quantity } = req.body;
    const userId = req.user.id;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find(item => item.meal.toString() === mealId);
    if (!item) {
      return res.status(404).json({ message: "Item not in cart" });
    }

    if (quantity <= 0) {
      // Remove item if quantity 0
      cart.items = cart.items.filter(item => item.meal.toString() !== mealId);
    } else {
      item.quantity = quantity;
    }

    // Recalculate total
    await cart.populate('items.meal');
    cart.totalPrice = cart.items.reduce((total, item) => total + (item.meal.price * item.quantity), 0);

    await cart.save();
    await cart.populate('items.meal', 'meal_name price');

    res.json({ message: "Cart updated", cart });
  } catch (error) {
    console.error("Update cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   DELETE /api/cart/remove/:mealId
 * @desc    Remove item from cart
 * @access  Private
 */
router.delete("/remove/:mealId", authMiddleware, async (req, res) => {
  try {
    const { mealId } = req.params;
    const userId = req.user.id;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = cart.items.filter(item => item.meal.toString() !== mealId);

    // Recalculate total
    await cart.populate('items.meal');
    cart.totalPrice = cart.items.reduce((total, item) => total + (item.meal.price * item.quantity), 0);

    await cart.save();
    await cart.populate('items.meal', 'meal_name price');

    res.json({ message: "Item removed from cart", cart });
  } catch (error) {
    console.error("Remove from cart error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
