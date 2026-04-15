import express from "express";
import Groq from "groq-sdk";
import Meal from "../models/Meal.js";
import { attachCurrentUser } from "../middleware/webAuth.js";

const router = express.Router();
router.use(attachCurrentUser);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post("/", async (req, res) => {
  try {
    const message = (req.body.message || "").trim();
    if (!message) return res.json({ reply: "Please type a message." });

    const user = req.currentUser || null;

    // ── Build context from real DB data ──────────────────────────────────────
    const mealCount = await Meal.countDocuments();

    // Sample meals relevant to user's condition (or just recent meals)
    const conditionFilter = user?.profile?.primaryCondition && user.profile.primaryCondition !== "None"
      ? { disease_type: user.profile.primaryCondition }
      : {};
    const sampleMeals = await Meal.find(conditionFilter)
      .limit(8)
      .select("meal_name calories protein price disease_type sugar_level salt_level")
      .lean();

    const mealSummary = sampleMeals
      .map(m => `${m.meal_name} (${m.calories} kcal, ${m.protein}g protein, $${(Number(m.price)||0).toFixed(2)}, condition: ${m.disease_type}, sugar: ${m.sugar_level}, salt: ${m.salt_level})`)
      .join("\n");

    // ── Build user profile context ────────────────────────────────────────────
    const userContext = user ? `
The user is logged in:
- Name: ${user.profile?.firstName || user.username}
- Health condition: ${user.profile?.primaryCondition || "None"}
- Fitness goal: ${user.profile?.fitnessGoal || "Not set"}
- Wellness goal: ${user.profile?.wellnessGoal || "Not set"}
- Calorie goal: ${user.profile?.calorieGoal || 2000} kcal/day
- Weekly budget: $${user.profile?.weeklyBudget || "Not set"}
- Allergies: ${user.profile?.allergies?.join(", ") || "None"}
- Cook Mode: ${user.profile?.cookMode ? "On (prefers cooking)" : "Off (prefers ordering)"}
` : "The user is not logged in.";

    // ── System prompt ─────────────────────────────────────────────────────────
    const systemPrompt = `You are NutriFlow's friendly nutrition assistant, embedded in a health-focused meal planning web app.

About NutriFlow:
- A personalised meal planning platform with ${mealCount} meals in the database
- Features: Browse meals, weekly planner, grocery list, prescription/drug interaction checker, cook mode (recipes) vs order mode (cart), nutrition tracking, compliance reports
- Meals are filtered by: health condition (Diabetes, Hypertension, Heart Disease), sugar level, salt level, temperature, allergens, price

${userContext}

Sample meals from the database${user?.profile?.primaryCondition ? ` (filtered for ${user.profile.primaryCondition})` : ""}:
${mealSummary}

Your role:
- Answer nutrition and meal-related questions using the context above
- Suggest specific meals from the database when relevant
- Give practical dietary advice tailored to the user's health condition
- Help with NutriFlow features (planner, grocery list, prescription page, etc.)
- Keep answers concise, friendly, and under 150 words
- Use bullet points for lists
- Never make up meal names — only reference meals from the database above
- If asked something unrelated to food/nutrition/the app, politely redirect`;

    // ── Call Groq API ─────────────────────────────────────────────────────────
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: message }
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content?.trim()
      || "I couldn't generate a response. Please try again.";

    return res.json({ reply });

  } catch (err) {
    console.error("Chat error:", err.message);
    // Fall back to a helpful static message if Groq fails
    return res.json({ reply: "I'm having trouble connecting right now. Try asking about meals for your condition, low-calorie options, or budget-friendly picks!" });
  }
});

export default router;
