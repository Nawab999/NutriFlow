import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username must not exceed 30 characters"]
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, "Please provide a valid email"]
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    profile: {
      firstName: {
        type: String,
        trim: true,
        maxlength: 50
      },
      lastName: {
        type: String,
        trim: true,
        maxlength: 50
      },
      phone: {
        type: String,
        trim: true,
        match: [/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/, "Please provide a valid phone number"]
      },
      bio: {
        type: String,
        trim: true,
        maxlength: 500
      },
      avatar: String,
      primaryCondition: {
        type: String,
        enum: ["Diabetes", "Hypertension", "Heart Disease", "None", "Other"]
      },
      preferredSugarLevel: {
        type: String,
        enum: ["Low", "Medium", "High"]
      },
      preferredTemperature: {
        type: String,
        enum: ["Cold", "Warm", "Hot"]
      },
      wellnessGoal: {
        type: String,
        enum: [
          "Balanced nutrition",
          "Weight management",
          "Heart health",
          "Blood sugar control",
          "Lower sodium",
          "High protein"
        ]
      },
      // Primary fitness/body goal
      fitnessGoal: {
        type: String,
        enum: ["Weight Loss", "Weight Gain", "Build Muscle", "Maintain Weight", "Medical Diet"]
      },
      // Doctor-recommended dietary restrictions (avoid / include)
      dietaryRestrictions: {
        avoidIngredients: { type: [String], default: [] },  // e.g. ["sugar","sodium","gluten"]
        includeIngredients: { type: [String], default: [] } // e.g. ["fibre","omega-3"]
      },
      // Food allergies
      allergies: {
        type: [String],
        default: [],
        enum: ["Gluten", "Dairy", "Eggs", "Nuts", "Shellfish", "Soy", "Fish", "Peanuts", "None"]
      },
      dailyBudget: {
        type: Number,
        min: 0
      },
      dailyCalorieGoal: {
        type: Number,
        min: 0,
        default: 2000
      },
      dailyProteinGoal: {
        type: Number,
        min: 0,
        default: 50
      },
      cookMode: {
        type: Boolean,
        default: false   // false = Order Mode, true = Cook Mode
      },
      // Doctor prescription
      prescription: {
        rawText: { type: String, default: "" },          // full text entered by user
        extractedRestrictions: { type: [String], default: [] }, // parsed avoid keywords
        medications: { type: [String], default: [] },    // medication names listed
        uploadedAt: { type: Date }
      }
    },
    favoritesMeals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Meal"
      }
    ],
    groceryMeals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Meal"
      }
    ],
    mealHistory: [
      {
        meal: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Meal"
        },
        date: {
          type: Date,
          default: Date.now
        },
        rating: {
          type: Number,
          min: 1,
          max: 5
        },
        notes: String
      }
    ],
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

// Index for search and sorting
userSchema.index({ createdAt: -1 });

export default mongoose.model("User", userSchema);
