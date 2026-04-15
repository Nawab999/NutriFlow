// ─────────────────────────────────────────────────────────────────────────────
// utils/mealUtils.js — Shared meal helpers used by routes and server.js
//
// Functions exported:
//   deriveFallbackPrice   — estimate a price when CSV has no price column
//   parseSort             — convert "-calories,name" string to Mongoose sort obj
//   buildMealQuery        — build a MongoDB query object from URL query params
//   scoreMealForUser      — score a single meal against a user preference profile
//   getRecommendedMeals   — fetch + rank meals for a given user
//   getMealVisual         — derive a Pexels image URL and bg colour for a meal card
//   getMostFrequentValue  — find the most common value in an array (used in recommendations)
// ─────────────────────────────────────────────────────────────────────────────

import Meal from "../models/Meal.js";

// deriveFallbackPrice — estimates a realistic meal price when the CSV row has
// no price value. Uses the meal name and nutritional content as signals.
// Salmon / fish are priced higher; salads lower; extra calories/protein add a
// small premium. Returns a number in USD.
const deriveFallbackPrice = (mealName = "", calories = 0, protein = 0) => {
  const normalizedName = mealName.toLowerCase();
  let basePrice = 8;

  if (normalizedName.includes("salmon") || normalizedName.includes("fish")) {
    basePrice += 4;
  } else if (normalizedName.includes("chicken") || normalizedName.includes("turkey")) {
    basePrice += 2;
  } else if (normalizedName.includes("salad") || normalizedName.includes("broccoli")) {
    basePrice += 1;
  }

  if (calories > 250) basePrice += 1;
  if (protein > 20)   basePrice += 1;

  return basePrice;
};

// parseSort — converts a comma-separated sort string (e.g. "-calories,name")
// into a Mongoose sort object (e.g. { calories: -1, name: 1 }).
// A leading "-" means descending; no prefix means ascending.
const parseSort = (sort = "-createdAt") => {
  const sortObj = {};
  (sort || "-createdAt").split(",").forEach(field => {
    if (!field) return;
    if (field.startsWith("-")) {
      sortObj[field.substring(1)] = -1;
    } else {
      sortObj[field] = 1;
    }
  });
  return sortObj;
};

// buildMealQuery — builds a MongoDB filter object from URL query parameters.
// Supports full-text search (q), enum filters (disease_type, sugar_level,
// salt_level, temperature, mealType), and range filters (maxPrice,
// maxCalories, minProtein).
const buildMealQuery = (params = {}) => {
  const query = {};
  const { q, disease_type, sugar_level, salt_level, temperature, maxPrice, maxCalories, minProtein, mealType } = params;

  // Full-text search across name and description
  if (q) {
    query.$or = [
      { meal_name:    { $regex: q, $options: "i" } },
      { description:  { $regex: q, $options: "i" } }
    ];
  }

  // Exact-match enum filters
  if (disease_type) query.disease_type = disease_type;
  if (sugar_level)  query.sugar_level  = sugar_level;
  if (salt_level)   query.salt_level   = salt_level;
  if (temperature)  query.temperature  = temperature;

  // mealType: match "Breakfast" OR "Any" so flexible meals always appear
  if (mealType && mealType !== "All") {
    query.mealType = { $in: [mealType, "Any"] };
  }

  // Range filters — merge with existing price/calorie/protein constraints
  if (maxPrice) {
    query.price = { ...(query.price || {}), $lte: parseFloat(maxPrice) };
  }
  if (maxCalories) {
    query.calories = { ...(query.calories || {}), $lte: parseFloat(maxCalories) };
  }
  if (minProtein) {
    query.protein = { ...(query.protein || {}), $gte: parseFloat(minProtein) };
  }

  return query;
};

// getMostFrequentValue — returns the most common non-falsy value in an array.
// Used to infer a user's implicit preferences from their meal history and
// favourites when they haven't explicitly set a profile preference.
const getMostFrequentValue = (values = []) => {
  const counts = values.reduce((acc, value) => {
    if (!value) return acc;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

// scoreMealForUser — scores a single meal (plain object) against a preference
// profile and returns { score, reasons, disqualified }.
//
// A disqualified meal (score -999) should be filtered out entirely — it either
// contains an allergen the user has declared or a doctor-restricted ingredient.
//
// Positive scores accumulate from: health condition match, sugar/temperature
// preference, wellness goal alignment, fitness goal alignment, included
// ingredients, and budget fit. The higher the score, the more relevant the meal.
const scoreMealForUser = (meal, preferenceProfile) => {
  const reasons = [];
  let score = 0;

  // ── Hard disqualifiers: allergens ─────────────────────────────────────────
  // If the meal contains any allergen the user has declared, disqualify it.
  // The meal is removed from results entirely rather than just ranked lower.
  const userAllergies = preferenceProfile.allergies || [];
  const mealAllergens = meal.allergens || [];
  if (userAllergies.length && userAllergies.some(a => a !== "None" && mealAllergens.includes(a))) {
    return { score: -999, reasons: ["contains allergen"], disqualified: true };
  }

  // ── Health condition match ────────────────────────────────────────────────
  // Meals designed for the user's condition (e.g. Diabetes) score highest.
  if (preferenceProfile.condition && meal.disease_type === preferenceProfile.condition) {
    score += 4;
    reasons.push(`${meal.disease_type} support`);
  }

  // ── Sugar preference ──────────────────────────────────────────────────────
  if (preferenceProfile.sugar && meal.sugar_level === preferenceProfile.sugar) {
    score += 3;
    reasons.push(`${meal.sugar_level.toLowerCase()} sugar match`);
  }

  // ── Temperature preference ────────────────────────────────────────────────
  if (preferenceProfile.temperature && meal.temperature === preferenceProfile.temperature) {
    score += 2;
    reasons.push(`${meal.temperature.toLowerCase()} serving preference`);
  }

  // ── Wellness goal ─────────────────────────────────────────────────────────
  // Each wellness goal maps to one or two meal attributes.
  if (preferenceProfile.goal === "Lower sodium"        && meal.salt_level === "Low")   { score += 2; reasons.push("lower sodium option"); }
  if (preferenceProfile.goal === "High protein"        && meal.protein >= 20)          { score += 2; reasons.push("high protein pick"); }
  if (preferenceProfile.goal === "Blood sugar control" && meal.sugar_level === "Low")  { score += 2; reasons.push("supports blood sugar control"); }
  if (preferenceProfile.goal === "Heart health"        && meal.salt_level === "Low")   { score += 2; reasons.push("heart-friendly sodium level"); }
  if (preferenceProfile.goal === "Weight management"   && meal.calories <= 450)        { score += 1; reasons.push("lighter calorie range"); }

  // ── Fitness goal ──────────────────────────────────────────────────────────
  // More granular scoring based on the user's body/fitness goal.
  const fitnessGoal = preferenceProfile.fitnessGoal || "";
  if (fitnessGoal === "Weight Loss") {
    if (meal.calories && meal.calories <= 400) { score += 3; reasons.push("low calorie for weight loss"); }
    if (meal.protein  && meal.protein  >= 20)  { score += 1; reasons.push("high protein keeps you full"); }
    if (meal.sugar_level === "Low")             { score += 1; reasons.push("low sugar supports fat loss"); }
  }
  if (fitnessGoal === "Weight Gain") {
    if (meal.calories && meal.calories >= 600) { score += 3; reasons.push("calorie-dense for weight gain"); }
    if (meal.protein  && meal.protein  >= 25)  { score += 1; reasons.push("supports muscle growth"); }
  }
  if (fitnessGoal === "Build Muscle") {
    if (meal.protein  && meal.protein  >= 25)  { score += 4; reasons.push("high protein builds muscle"); }
    if (meal.calories && meal.calories >= 450) { score += 1; reasons.push("calorie surplus supports growth"); }
    if (meal.sugar_level === "Low")            { score += 1; reasons.push("clean fuel for training"); }
  }
  if (fitnessGoal === "Maintain Weight") {
    if (meal.calories && meal.calories >= 300 && meal.calories <= 600) {
      score += 2; reasons.push("balanced calorie range");
    }
  }
  if (fitnessGoal === "Medical Diet") {
    // Condition match already scored above; reinforce low-sodium/sugar
    if (meal.salt_level === "Low")  { score += 1; reasons.push("low sodium (doctor-recommended)"); }
    if (meal.sugar_level === "Low") { score += 1; reasons.push("low sugar (doctor-recommended)"); }
  }

  // ── Doctor dietary restrictions ───────────────────────────────────────────
  // avoidIngredients: hard disqualify if the meal name/description contains any
  // of the ingredients the user's doctor said to avoid.
  // includeIngredients: boost if the meal contains recommended ingredients.
  const avoidList   = (preferenceProfile.avoidIngredients  || []).map(s => s.toLowerCase().trim());
  const includeList = (preferenceProfile.includeIngredients || []).map(s => s.toLowerCase().trim());
  const mealText    = (meal.meal_name + " " + (meal.description || "")).toLowerCase();

  if (avoidList.length && avoidList.some(a => mealText.includes(a))) {
    return { score: -999, reasons: ["contains restricted ingredient"], disqualified: true };
  }
  for (const inc of includeList) {
    if (mealText.includes(inc)) { score += 2; reasons.push(`contains recommended ${inc}`); }
  }

  // ── Budget fit ────────────────────────────────────────────────────────────
  // A daily budget is split roughly 3 ways (breakfast/lunch/dinner).
  if (preferenceProfile.dailyBudget && meal.price <= Math.max(preferenceProfile.dailyBudget / 3, 12)) {
    score += 1;
    reasons.push("fits your budget");
  }

  if (!reasons.length) reasons.push("balanced everyday option");

  return { score, reasons, disqualified: false };
};

// getRecommendedMeals — fetches up to `limit` meals from the database and ranks
// them for a specific user using scoreMealForUser.
//
// The preference profile is built by combining:
//   1. Explicit query params (e.g. disease_type from URL)
//   2. User profile settings (primaryCondition, fitnessGoal, etc.)
//   3. Inferred preferences from meal history and favourites (most frequent value)
//
// Disqualified meals are removed. Ties in score are broken by lower price.
const getRecommendedMeals = async (user, params = {}, limit = 6) => {
  // Use the last 12 history entries and all favourites to infer implicit prefs
  const recentMeals   = (user.mealHistory    || []).map(e => e.meal).filter(Boolean).slice(-12);
  const favoriteMeals = (user.favoritesMeals || []);

  const preferenceProfile = {
    condition: params.disease_type || user.profile?.primaryCondition ||
      getMostFrequentValue([...recentMeals.map(m => m.disease_type), ...favoriteMeals.map(m => m.disease_type)]),

    sugar: params.sugar_level || user.profile?.preferredSugarLevel ||
      getMostFrequentValue([...recentMeals.map(m => m.sugar_level), ...favoriteMeals.map(m => m.sugar_level)]),

    temperature: params.temperature || user.profile?.preferredTemperature ||
      getMostFrequentValue([...recentMeals.map(m => m.temperature), ...favoriteMeals.map(m => m.temperature)]),

    goal:               user.profile?.wellnessGoal || "",
    fitnessGoal:        user.profile?.fitnessGoal  || "",
    dailyBudget:        user.profile?.dailyBudget  || null,
    allergies:          user.profile?.allergies    || [],
    avoidIngredients:   user.profile?.dietaryRestrictions?.avoidIngredients  || [],
    includeIngredients: user.profile?.dietaryRestrictions?.includeIngredients || []
  };

  // Fetch a broad candidate set (up to 100) then score in memory
  const candidateMeals = await Meal.find(buildMealQuery(params))
    .limit(100)
    .sort(parseSort(params.sort || "-createdAt"));

  return candidateMeals
    .map(meal => {
      const { score, reasons, disqualified } = scoreMealForUser(meal, preferenceProfile);
      return { ...meal.toObject(), recommendationScore: score, recommendationReason: reasons.join(" · "), disqualified: !!disqualified };
    })
    .filter(m => !m.disqualified)
    .sort((a, b) => {
      // Primary: higher score first. Secondary: lower price first (tiebreak).
      if (b.recommendationScore !== a.recommendationScore) return b.recommendationScore - a.recommendationScore;
      return (a.price || 0) - (b.price || 0);
    })
    .slice(0, limit);
};

// ── Image / visual helpers ────────────────────────────────────────────────────

// MEAL_PHOTO_MAP — maps meal name keywords to verified Pexels photo IDs.
// The longest matching key wins so "grilled chicken breast" beats "chicken".
// All IDs have been verified as returning 200 OK from Pexels.
const MEAL_PHOTO_MAP = [
  { keys: ["grilled chicken breast", "chicken breast"], id: 1640777 },
  { keys: ["chicken wing", "buffalo chicken"], id: 2338407 },
  { keys: ["curry chicken", "stew chicken", "satay chicken"], id: 2474661 },
  { keys: ["soup chicken", "broth chicken"], id: 1860195 },
  { keys: ["taco chicken", "sandwich chicken", "burger chicken"], id: 461198 },
  { keys: ["chicken"], id: 1640777 },
  { keys: ["beef tenderloin", "bison steak", "steak"], id: 1639562 },
  { keys: ["burger beef", "burger turkey", "burger veggie"], id: 1639565 },
  { keys: ["stew beef", "braise beef", "chili meat"], id: 1640777 },
  { keys: ["kebab", "shawarma", "skewer beef"], id: 1640777 },
  { keys: ["lamb chops", "braise lamb"], id: 769289 },
  { keys: ["pork tenderloin", "braise pork"], id: 1860194 },
  { keys: ["turkey breast", "turkey ground", "sandwich turkey"], id: 1640777 },
  { keys: ["baked salmon", "salmon fillet", "salmon"], id: 3763847 },
  { keys: ["baked white fish", "cod fish", "halibut", "tilapia fillet"], id: 699953 },
  { keys: ["tuna in water", "sandwich tuna"], id: 1640777 },
  { keys: ["sushi roll", "nigiri", "sashimi"], id: 2098085 },
  { keys: ["shrimp", "appetizer shrimp"], id: 3655916 },
  { keys: ["taco fish", "fish taco"], id: 461198 },
  { keys: ["pho", "ramen bowl", "tonkotsu ramen", "soup ramen"], id: 1907228 },
  { keys: ["egg white omelet", "omelet", "omelette", "egg white"], id: 824635 },
  { keys: ["egg whole", "fried egg", "deviled egg"], id: 824635 },
  { keys: ["french toast", "pancake", "waffle"], id: 376464 },
  { keys: ["yogurt greek", "greek yogurt", "yogurt plain", "yogurt"], id: 1099680 },
  { keys: ["cottage cheese", "cheese plate", "charcuterie"], id: 821365 },
  { keys: ["cheese mozzarella", "mozzarella", "cheese feta", "feta"], id: 4109111 },
  { keys: ["milk oat", "milk almond", "milk whole", "milk"], id: 1108117 },
  { keys: ["oatmeal", "barley porridge", "cereal granola", "granola"], id: 1640777 },
  { keys: ["brown rice", "white rice", "rice jasmine", "rice basmati", "rice"], id: 723198 },
  { keys: ["risotto", "rice arborio"], id: 1640777 },
  { keys: ["quinoa"], id: 1640777 },
  { keys: ["whole wheat bread", "bread wheat", "bread sourdough", "bagel", "bread"], id: 1775043 },
  { keys: ["carbonara", "cacio pepe", "spaghetti", "pasta wheat", "alfredo", "bolognese", "pasta"], id: 1279330 },
  { keys: ["lasagna", "baked ziti"], id: 1279330 },
  { keys: ["tortellini", "ravioli", "gnocchi"], id: 1279330 },
  { keys: ["pad thai", "lo mein", "chow mein", "udon", "yakisoba", "noodle"], id: 1907228 },
  { keys: ["lentil soup", "soup lentil", "lentils"], id: 1860195 },
  { keys: ["chickpea salad", "chickpeas", "falafel", "hummus", "chaat"], id: 1640777 },
  { keys: ["black beans", "kidney beans", "pinto beans", "white beans", "beans"], id: 1640777 },
  { keys: ["edamame"], id: 1640777 },
  { keys: ["tofu scramble", "tofu", "tempeh"], id: 1640777 },
  { keys: ["spinach salad", "arugula salad", "kale salad", "salad"], id: 1640777 },
  { keys: ["steamed broccoli", "broccoli"], id: 1580466 },
  { keys: ["asparagus"], id: 1375016 },
  { keys: ["sweet potato"], id: 4110152 },
  { keys: ["brussels sprouts"], id: 1640777 },
  { keys: ["bell pepper", "chili pepper"], id: 1435904 },
  { keys: ["eggplant"], id: 1640777 },
  { keys: ["mushroom soup", "soup mushroom", "mushroom"], id: 1860195 },
  { keys: ["avocado fuerte", "avocado green", "avocado hass", "avocado", "guacamole"], id: 1640777 },
  { keys: ["tomato cherry", "tomato beefsteak", "tomato red", "tomato"], id: 1327838 },
  { keys: ["zucchini noodles", "zucchini"], id: 1640777 },
  { keys: ["grilled vegetables", "stew vegetable", "curry vegetable", "vegetable"], id: 1640777 },
  { keys: ["carrot sticks", "carrot"], id: 143133 },
  { keys: ["butternut squash", "acorn squash", "squash"], id: 1640777 },
  { keys: ["beet root", "beet"], id: 1640777 },
  { keys: ["leafy greens", "swiss chard", "collard greens", "kale chips", "bok choy"], id: 1640777 },
  { keys: ["cauliflower rice", "cauliflower"], id: 1640777 },
  { keys: ["green beans", "steamed beans", "peas"], id: 1640777 },
  { keys: ["soup tomato", "soup minestrone", "soup onion", "soup butternut", "soup"], id: 1860195 },
  { keys: ["miso soup", "soup miso"], id: 1907228 },
  { keys: ["broth vegetable", "broth beef", "broth chicken", "broth"], id: 1860195 },
  { keys: ["smoothie green", "smoothie acai", "smoothie protein", "smoothie"], id: 775032 },
  { keys: ["acai berry", "acai"], id: 775032 },
  { keys: ["juice orange", "juice apple", "juice carrot", "juice lemonade", "juice"], id: 96974 },
  { keys: ["coconut water", "coconut juice"], id: 1640777 },
  { keys: ["tea green", "tea matcha", "tea chamomile", "tea herbal", "herb tea", "ginger tea", "tea"], id: 1417945 },
  { keys: ["coffee regular", "coffee decaf", "coffee"], id: 312418 },
  { keys: ["kombucha", "kefir"], id: 1640777 },
  { keys: ["water mineral", "water plain", "water sparkling", "water"], id: 327090 },
  { keys: ["energy drink", "sports drink", "soda"], id: 1640777 },
  { keys: ["almond raw", "almond roasted", "almonds mix", "almond"], id: 1295572 },
  { keys: ["walnut raw", "walnut"], id: 1295572 },
  { keys: ["cashew raw", "cashew"], id: 1295572 },
  { keys: ["peanut butter", "peanut"], id: 1295572 },
  { keys: ["pistachio", "pecan", "macadamia", "hazelnut", "nuts"], id: 1295572 },
  { keys: ["chia seed", "chia seeds", "flax seed", "sesame seed", "seeds"], id: 1640777 },
  { keys: ["apple fuji", "apple golden", "apple red", "apple honeycrisp", "apple"], id: 1453713 },
  { keys: ["banana yellow", "banana plantain", "banana"], id: 1093038 },
  { keys: ["strawberry fresh", "strawberry"], id: 1394652 },
  { keys: ["blueberry fresh", "blueberry"], id: 1120581 },
  { keys: ["blackberry fresh", "blackberry", "raspberry fresh", "raspberry"], id: 1120581 },
  { keys: ["mango ripe", "mango green", "mango"], id: 918643 },
  { keys: ["pineapple fresh", "pineapple"], id: 947885 },
  { keys: ["orange navel", "orange valencia", "orange", "tangerine", "mandarin"], id: 327098 },
  { keys: ["grapefruit pink", "grapefruit"], id: 327098 },
  { keys: ["lemon fresh", "lemon", "lime green", "lime"], id: 327098 },
  { keys: ["pear anjou", "pear bartlett", "pear"], id: 1640777 },
  { keys: ["pomegranate"], id: 1640777 },
  { keys: ["kiwi fruit", "kiwi"], id: 1640777 },
  { keys: ["dragon fruit"], id: 1640777 },
  { keys: ["watermelon", "melon"], id: 1105019 },
  { keys: ["coconut fresh", "coconut dried", "coconut"], id: 1640777 },
  { keys: ["dried fruit", "apricot dried", "date medjool", "date deglet", "prune", "raisin"], id: 1640777 },
  { keys: ["strawberry jam", "jam strawberry", "jam raspberry", "jam"], id: 1640777 },
  { keys: ["fruit plate", "fruit platter", "mixed fruit"], id: 1640777 },
  { keys: ["sandwich beef", "sandwich chicken", "sandwich tuna", "sandwich turkey", "sandwich veggie", "sandwich"], id: 1640777 },
  { keys: ["burrito beef", "burrito chicken", "burrito bean", "burrito"], id: 461198 },
  { keys: ["quesadilla", "fajita", "enchilada", "nachos", "taco beef", "taco vegetable", "taco"], id: 461198 },
  { keys: ["pizza margherita", "pizza pepperoni", "pizza"], id: 315755 },
  { keys: ["gyoza", "dumpling", "pot sticker", "wonton", "momos", "bao", "egg roll", "spring roll"], id: 1907228 },
  { keys: ["yakitori", "okonomiyaki", "takoyaki", "tempura"], id: 1907228 },
  { keys: ["curry red", "curry green", "curry yellow", "curry", "laksa"], id: 2474661 },
  { keys: ["kimchi", "sauerkraut"], id: 1640777 },
  { keys: ["dosa", "idli", "uttapam", "pakora", "samosa", "chaat"], id: 1640777 },
  { keys: ["paella", "risotto"], id: 1640777 },
  { keys: ["bruschetta", "crostini", "antipasto", "mezze", "tapas"], id: 1640777 },
  { keys: ["tiramisu", "gelato", "mousse chocolate", "custard", "flan", "pudding"], id: 1126359 },
  { keys: ["cake chocolate", "cake carrot", "cheesecake", "brownie", "muffin", "cookie", "donut", "scone", "croissant", "pie", "tart"], id: 1126359 },
  { keys: ["ice cream", "sorbet", "popsicle"], id: 1352278 },
  { keys: ["chocolate dark", "chocolate milk", "chocolate"], id: 918581 },
  { keys: ["honey raw", "maple syrup", "honey"], id: 1640777 },
  { keys: ["wine red", "wine white", "wine rose", "wine"], id: 1407846 },
  { keys: ["beer dark", "beer light", "beer stout", "beer"], id: 1640777 },
  { keys: ["olive oil", "oil olive"], id: 1640777 },
  { keys: ["salsa tomato", "salsa mango", "salsa", "ketchup", "mustard", "sauce"], id: 1640777 },
];

// BG_MAP — card placeholder background colours grouped by food category.
// Shown while the Pexels image loads, so the card always looks intentional.
const BG_MAP = [
  [["chicken", "turkey", "beef", "pork", "lamb", "steak", "burger"], "#3d2010"],
  [["salmon", "fish", "tuna", "seafood", "shrimp", "halibut", "tilapia", "cod"], "#0d3045"],
  [["salad", "broccoli", "spinach", "kale", "vegetable", "zucchini", "asparagus"], "#1a3320"],
  [["rice", "quinoa", "oatmeal", "bread", "pasta", "noodle", "ramen"], "#3d2e15"],
  [["smoothie", "juice", "berry", "fruit", "mango", "banana", "apple", "orange"], "#3d1a2e"],
  [["yogurt", "cottage", "cheese", "milk", "cream"], "#1e1a3d"],
  [["soup", "stew", "curry", "broth"], "#2e1a0a"],
  [["chocolate", "cake", "cookie", "brownie", "ice cream", "dessert"], "#1a0d05"],
  [["tea", "coffee", "matcha"], "#0d1a0d"],
  [["wine", "beer"], "#1a0d1a"],
  [["water", "mineral", "sparkling"], "#0a1020"],
];

// getMealVisual — returns { imageUrl, backgroundStyle } for a meal.
//
// If the meal has an imageUrl stored in the DB, that is used directly.
// Otherwise the meal name is matched against MEAL_PHOTO_MAP using longest-key
// matching to find the best Pexels photo. The background colour comes from
// BG_MAP and is displayed while the image loads (or as a fallback).
const getMealVisual = meal => {
  const name        = String(meal?.meal_name  || "").toLowerCase();
  const temperature = String(meal?.temperature || "").toLowerCase();
  const storedUrl   = meal?.imageUrl?.trim()  || "";

  // Use the stored image URL if one was set via the admin form
  if (storedUrl) {
    return { imageUrl: storedUrl, backgroundStyle: "background: #2a3a2a;" };
  }

  // Find the longest keyword match in MEAL_PHOTO_MAP
  let bestId     = 1640777; // generic healthy food fallback
  let bestKeyLen = 0;
  for (const entry of MEAL_PHOTO_MAP) {
    for (const key of entry.keys) {
      if (name.includes(key) && key.length > bestKeyLen) {
        bestId     = entry.id;
        bestKeyLen = key.length;
      }
    }
  }

  const imageUrl = `https://images.pexels.com/photos/${bestId}/pexels-photo-${bestId}.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop`;

  // Pick background colour: cold meals get a cool tone; others matched by category
  let bg = temperature === "cold" ? "#0a1520" : "#1e2a1e";
  for (const [keys, color] of BG_MAP) {
    if (keys.some(k => name.includes(k))) { bg = color; break; }
  }

  return { imageUrl, backgroundStyle: `background: ${bg};` };
};

export {
  buildMealQuery,
  deriveFallbackPrice,
  getMealVisual,
  getRecommendedMeals,
  getMostFrequentValue,
  parseSort,
  scoreMealForUser
};
