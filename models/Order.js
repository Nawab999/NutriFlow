import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"]
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
      required: [true, "Total price is required"]
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "delivered", "cancelled"],
      default: "pending"
    }
  },
  { timestamps: true }
);

// Index for efficient queries
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

export default mongoose.model("Order", orderSchema);
