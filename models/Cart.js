import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      unique: true // One cart per user
    },
    items: [
      {
        meal: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Meal",
          required: [true, "Meal is required"]
        },
        quantity: {
          type: Number,
          min: [1, "Quantity must be at least 1"],
          required: [true, "Quantity is required"]
        }
      }
    ],
    totalPrice: {
      type: Number,
      min: [0, "Total price cannot be negative"],
      default: 0
    }
  },
  { timestamps: true }
);

// Index for efficient queries
// Note: user field has unique: true, so index is automatic

export default mongoose.model("Cart", cartSchema);
