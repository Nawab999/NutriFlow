import expressValidator from "express-validator";

const { validationResult, body, param, query } = expressValidator;

/**
 * Middleware to handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

// ✅ AUTHENTICATION VALIDATORS

const validateRegister = [
  body("username")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Username is required")
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be between 3 and 30 characters")
    .matches(/^[a-zA-Z0-9 _'-]+$/)
    .withMessage("Username can only contain letters, numbers, spaces, apostrophes, hyphens, and underscores"),
  body("email")
    .trim()
    .normalizeEmail()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isStrongPassword({
      minLength: 6,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0
    })
    .withMessage("Password must include uppercase, lowercase, and a number"),
  handleValidationErrors
];

const validateLogin = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email"),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
  handleValidationErrors
];

// ✅ MEAL VALIDATORS

const validateCreateMeal = [
  body("meal_name")
    .trim()
    .escape()
    .notEmpty()
    .withMessage("Meal name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Meal name must be between 2 and 100 characters"),
  body("disease_type")
    .optional()
    .isIn(["Diabetes", "Hypertension", "Heart Disease", "None", "Other"])
    .withMessage("Invalid disease type"),
  body("sugar_level")
    .optional()
    .isIn(["Low", "Medium", "High"])
    .withMessage("Invalid sugar level"),
  body("salt_level")
    .optional()
    .isIn(["Low", "Medium", "High"])
    .withMessage("Invalid salt level"),
  body("temperature")
    .optional()
    .isIn(["Cold", "Warm", "Hot"])
    .withMessage("Invalid temperature"),
  body("expiry_days")
    .optional()
    .isInt({ min: 0, max: 365 })
    .withMessage("Expiry days must be between 0 and 365"),
  body("calories")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Calories must be a positive number"),
  body("protein")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Protein must be a positive number"),
  body("price")
    .notEmpty()
    .withMessage("Price is required")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),
  body("description")
    .optional()
    .trim()
    .escape()
    .isLength({ max: 500 })
    .withMessage("Description must not exceed 500 characters"),
  handleValidationErrors
];

const validateUpdateMeal = validateCreateMeal;

// ✅ USER PROFILE VALIDATORS

const validateUpdateProfile = [
  body("profile.firstName")
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 })
    .withMessage("First name must not exceed 50 characters"),
  body("profile.lastName")
    .optional()
    .trim()
    .escape()
    .isLength({ max: 50 })
    .withMessage("Last name must not exceed 50 characters"),
  body("profile.phone")
    .optional()
    .matches(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/)
    .withMessage("Please provide a valid phone number"),
  body("profile.bio")
    .optional()
    .trim()
    .escape()
    .isLength({ max: 500 })
    .withMessage("Bio must not exceed 500 characters"),
  body("profile.primaryCondition")
    .optional()
    .isIn(["Diabetes", "Hypertension", "Heart Disease", "None", "Other"])
    .withMessage("Invalid primary condition"),
  body("profile.preferredSugarLevel")
    .optional()
    .isIn(["Low", "Medium", "High"])
    .withMessage("Invalid preferred sugar level"),
  body("profile.preferredTemperature")
    .optional()
    .isIn(["Cold", "Warm", "Hot"])
    .withMessage("Invalid preferred temperature"),
  body("profile.wellnessGoal")
    .optional()
    .isIn([
      "Balanced nutrition",
      "Weight management",
      "Heart health",
      "Blood sugar control",
      "Lower sodium",
      "High protein"
    ])
    .withMessage("Invalid wellness goal"),
  body("profile.dailyBudget")
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage("Daily budget must be between 0 and 1000"),
  handleValidationErrors
];

// ✅ QUERY VALIDATORS

const validateMealQuery = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),
  query("q")
    .optional()
    .trim()
    .escape()
    .isLength({ max: 200 })
    .withMessage("Search query must not exceed 200 characters"),
  query("sort")
    .optional()
    .matches(/^-?[a-zA-Z_]+(,-?[a-zA-Z_]+)*$/)
    .withMessage("Invalid sort parameter"),
  query("maxPrice")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("maxPrice must be a positive number"),
  query("maxCalories")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("maxCalories must be a positive number"),
  query("minProtein")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("minProtein must be a positive number"),
  handleValidationErrors
];

export {
  validateRegister,
  validateLogin,
  validateCreateMeal,
  validateUpdateMeal,
  validateUpdateProfile,
  validateMealQuery,
  handleValidationErrors
};
