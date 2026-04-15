import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route   POST /api/orders
 * @desc    Create order from cart
 * @access  Private
 */
router.post("/", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ user: userId }).populate("items.meal").session(session);
    if (!cart || cart.items.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Cart is empty" });
    }

    const order = new Order({
      user: userId,
      items: cart.items,
      totalPrice: cart.totalPrice,
      status: "pending"
    });

    await order.save({ session });

    cart.items = [];
    cart.totalPrice = 0;
    await cart.save({ session });

    await session.commitTransaction();
    session.endSession();

    await order.populate("items.meal", "meal_name price");

    res.status(201).json({ message: "Order created successfully", order });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Create order error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   GET /api/orders
 * @desc    Get user's order history
 * @access  Private
 */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Order.find({ user: userId })
      .populate('items.meal', 'meal_name price')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get specific order details
 * @access  Private
 */
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await Order.findOne({ _id: id, user: userId })
      .populate('items.meal', 'meal_name price description');

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(order);
  } catch (error) {
    console.error("Get order error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @route   PUT /api/orders/:id/status
 * @desc    Update order status (admin only)
 * @access  Admin
 */
router.put("/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["pending", "confirmed", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.status = status;
    await order.save();

    res.json({ message: "Order status updated", order });
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
