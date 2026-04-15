# NutriFlow — Personalised Meal Planning Platform

> **Team:** The Risers — Shaik Ahmed Nawab · Abhishek · Arun Kumar · Surya Kumari

NutriFlow is a full-stack Node.js/MongoDB web application that helps users plan health-conscious meals tailored to their medical conditions, dietary goals, and prescriptions. Users can browse 586+ meals, build a weekly planner, manage a grocery list, track nutrition, and order or cook meals — all from a server-rendered EJS interface with an integrated AI nutrition assistant.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Folder and File Explanations](#folder-and-file-explanations)
- [Inline Code Documentation](#inline-code-documentation)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Key Web Pages](#key-web-pages)
- [Deployment](#deployment)
- [Team Contributions](#team-contributions)
- [Troubleshooting](#troubleshooting)

---

## Features

| Category | Details |
|---|---|
| Authentication | JWT via HTTP-only cookie, bcryptjs password hashing, protected routes |
| Meal Browsing | 586+ meals, search, filter by disease/sugar/temperature, personalised ranking |
| Weekly Planner | 7-day planner with per-day nutrition totals and grocery list generation |
| Grocery List | Auto-generated from planner + manually saved meals, per-meal ingredient cards |
| Cart & Orders | Add to cart, checkout, order history |
| Cook / Order Mode | Toggle per user — Cook Mode shows recipes, Order Mode shows cart actions |
| Prescription | Paste prescription text → auto-extract dietary restrictions and medications, drug-food interaction checker, weekly compliance report |
| AI Nutrition Assistant | Floating chat widget powered by Groq (Llama 3.3) — answers questions using real meal DB data and user profile |
| Profile | Fitness goal, wellness goal, health condition, allergies, budget, calorie goal |
| Admin Panel | Create, edit, delete meals; ingredient management |
| Allergen Filtering | Hides meals containing user's declared allergens site-wide |
| Nutrition Tracking | Daily calorie/protein goal progress on dashboard |

---

## Project Structure

```
nutriflow/
├── server.js                  # Express app entry point — middleware, routes, error handling
├── package.json               # Dependencies and npm scripts
├── .env                       # Secrets — never commit (git-ignored)
├── .env.example               # Safe template to share
│
├── models/
│   ├── Meal.js                # Meal schema: nutrition, allergens, ingredients, pricing
│   ├── User.js                # User schema: profile, health goals, prescription, grocery list
│   ├── Cart.js                # Cart schema: items per user with quantity
│   ├── Order.js               # Order schema: snapshot of cart at checkout, status tracking
│   └── MealPlan.js            # Weekly plan schema: 7 days × 3 slots, references Meal
│
├── routes/
│   ├── web.js                 # All EJS page GET/POST handlers (main app logic)
│   ├── auth.js                # POST /api/auth/register, /login, /logout
│   ├── meals.js               # REST CRUD for /api/meals (admin-gated writes)
│   ├── users.js               # /api/users/profile, favorites, meal history
│   ├── cart.js                # /api/cart — add/remove/clear
│   ├── orders.js              # /api/orders — create and list
│   └── chat.js                # /api/chat — AI nutrition assistant (Groq)
│
├── middleware/
│   ├── auth.js                # JWT authMiddleware, adminMiddleware, optionalAuthMiddleware
│   ├── webAuth.js             # Cookie-based: attachCurrentUser, requirePageAuth, requirePageAdmin
│   └── validators.js          # express-validator rules for all input forms
│
├── utils/
│   └── mealUtils.js           # Scoring, filtering, price derivation, getMealVisual helper
│
├── views/
│   ├── layouts/
│   │   ├── top.ejs            # <head>, CSS link, opening <body>
│   │   └── bottom.ejs         # Closing tags, shared JS, chat widget
│   ├── partials/
│   │   ├── nav.ejs            # Responsive top navigation bar
│   │   ├── alerts.ejs         # Flash message banner
│   │   └── footer.ejs         # Page footer
│   └── pages/
│       ├── home.ejs           # Landing page
│       ├── login.ejs          # Sign-in form
│       ├── register.ejs       # Sign-up form
│       ├── dashboard.ejs      # Personalised hub: nutrition, mini-plan, compliance
│       ├── meals.ejs          # Browse/search/filter catalogue
│       ├── meal-detail.ejs    # Single meal: nutrition, ingredients, prescription warnings
│       ├── planner.ejs        # Weekly meal planner
│       ├── grocery-list.ejs   # Per-meal ingredient cards with checkboxes
│       ├── prescription.ejs   # Prescription upload, drug interactions, compliance grid
│       ├── profile.ejs        # Health profile & preferences editor
│       ├── cart.ejs           # Shopping cart
│       ├── checkout.ejs       # Order placement
│       ├── admin-meals.ejs    # Admin meal table
│       ├── meal-form.ejs      # Admin create/edit meal form
│       ├── error.ejs          # 500 error page
│       └── not-found.ejs      # 404 page
│
├── public/
│   └── app.css                # Single stylesheet for all pages
│
└── data/
    └── meals.csv              # Seed data — imported once on first server start
```

---

## Folder and File Explanations

### `/models` — Database Schemas
Each file defines a Mongoose schema that maps to a MongoDB collection.

| File | Purpose |
|---|---|
| `Meal.js` | Stores meal name, calories, protein, price, disease type, allergens, ingredients, instructions. Indexed for full-text search. |
| `User.js` | Stores login credentials, health profile (condition, goals, allergies, budget), prescription, favourite meals, meal history, grocery list, and weekly plan reference. |
| `Cart.js` | Stores the current cart for a user — array of `{ meal, quantity }` items. One cart per user. |
| `Order.js` | Snapshot of a completed cart at checkout — stores item list, total price, and order status. |
| `MealPlan.js` | Weekly plan — 7 days × 3 slots (breakfast, lunch, dinner), each slot referencing a Meal document. |

### `/routes` — API Endpoints and Page Handlers
Each file is an Express router mounted in `server.js`.

| File | Mount Point | Purpose |
|---|---|---|
| `web.js` | `/` | Renders all EJS pages, handles form POST submissions (login, register, planner, profile, etc.) |
| `auth.js` | `/api/auth` | Register, login, logout — issues and clears JWT cookie |
| `meals.js` | `/api/meals` | Full CRUD for meals — public reads, admin-only writes |
| `users.js` | `/api/users` | Profile management, favourites, meal history |
| `cart.js` | `/api/cart` | Add, remove, and clear cart items |
| `orders.js` | `/api/orders` | Place orders from cart, retrieve order history |
| `chat.js` | `/api/chat` | AI nutrition assistant — queries Groq API with live meal DB context |

### `/middleware` — Request Guards and Validation
| File | Purpose |
|---|---|
| `auth.js` | Extracts and verifies JWT from `Authorization` header or cookie. Exports `authMiddleware` (requires login), `optionalAuthMiddleware` (attaches user if present), `adminMiddleware` (requires admin role). |
| `webAuth.js` | Cookie-based auth for EJS pages. `attachCurrentUser` decodes the cookie and attaches the user to `req.currentUser`. `requirePageAuth` redirects to `/login` if not authenticated. `requirePageAdmin` redirects if not admin. |
| `validators.js` | express-validator rule chains for register, login, and meal creation forms. |

### `/utils` — Shared Business Logic
| File | Purpose |
|---|---|
| `mealUtils.js` | `scoreMealForUser()` — multi-factor ranking algorithm. `buildMealQuery()` — converts URL params to a MongoDB filter. `getMealVisual()` — derives a Pexels image URL and background colour from the meal name. `getRecommendedMeals()` — fetches and ranks personalised meals for a user. |

### `/views` — EJS Templates
Server-rendered HTML pages. Each page receives data from the route handler via `res.render()`. Shared layout (`top.ejs`, `bottom.ejs`) and partials (`nav.ejs`, `alerts.ejs`, `footer.ejs`) are included in every page.

### `/public` — Static Assets
`app.css` is the single stylesheet for the entire application — design system variables, component styles, and responsive layout.

---

## Inline Code Documentation

All key logic is documented with inline comments throughout the codebase. Examples:

```js
// server.js — CSV seed import
// Runs once on startup. If the Meal collection is already populated, it skips.
// This means production deploys don't need a separate seed step.
const importCSV = async () => {
  const mealCount = await Meal.countDocuments();
  if (mealCount > 0) return; // Already seeded — skip
  // Stream rows one-by-one to avoid loading the entire file into memory
  fs.createReadStream(...).pipe(csv()).on("data", row => rows.push(row));
};
```

```js
// utils/mealUtils.js — Meal scoring algorithm
// scoreMealForUser(meal, user) — returns a numeric score (higher = better match).
// Factors: health condition match, allergen penalty, budget fit,
//          calorie goal proximity, temperature preference, sugar/salt level.
const scoreMealForUser = (meal, user) => { ... };
```

```js
// middleware/webAuth.js — Cookie auth
// attachCurrentUser — runs on every web request.
// Decodes JWT from cookie, fetches full user from DB, attaches to req.currentUser.
// On any failure (expired, missing, deleted user) sets currentUser to null — never crashes.
const attachCurrentUser = async (req, res, next) => { ... };
```

```js
// routes/web.js — Compliance report builder
// buildComplianceReport(user) — analyses last 7 days of mealHistory.
// Each day gets one of three states:
//   tracked=false        → no meals logged (grey dot)
//   tracked=true, compliant=true  → meals logged, no prescription conflicts (green dot)
//   tracked=true, compliant=false → conflict detected (red dot)
const buildComplianceReport = (user) => { ... };
```

```js
// routes/chat.js — AI nutrition assistant
// Builds a system prompt with live DB context (meal count, sample meals for the user's
// condition, user profile data) before every Groq API call so the AI gives
// personalised, database-aware answers rather than generic nutrition advice.
const completion = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", ... });
```

---

## Running Locally

### Prerequisites

- **Node.js** v18 or later
- A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster **or** MongoDB installed locally

### 1. Clone and install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/nutriflow
JWT_SECRET=replace_with_a_long_random_string_at_least_32_chars
JWT_EXPIRE=7d
PORT=3000
NODE_ENV=development
GROQ_API_KEY=your_groq_api_key_from_console.groq.com
```

### 3. Start the server

```bash
npm start
```

The first run automatically imports 586 meals from `data/meals.csv`.

Open **http://localhost:3000** in your browser.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string (Atlas or local) |
| `JWT_SECRET` | Yes | Secret key for signing JWT tokens — must be long and random |
| `JWT_EXPIRE` | No | Token lifetime (default `7d`) |
| `PORT` | No | Server port (default `3000`) |
| `NODE_ENV` | No | `development` or `production` |
| `FRONTEND_URL` | No | Your deployed app URL — used for CORS in production |
| `GROQ_API_KEY` | No | Groq API key for the AI nutrition assistant chat |

---

## API Overview

All API routes are prefixed with `/api`. They return JSON and are independent of the EJS frontend. All write operations require authentication via JWT (sent automatically as an HTTP-only cookie).

### Authentication — `/api/auth`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| POST | `/api/auth/register` | None | `{ username, email, password }` | `{ success, user }` + sets JWT cookie |
| POST | `/api/auth/login` | None | `{ email, password }` | `{ success, user }` + sets JWT cookie |
| POST | `/api/auth/logout` | None | — | Clears JWT cookie |

### Meals — `/api/meals`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/api/meals` | Optional | Query: `?q=`, `?disease_type=`, `?sugar_level=`, `?sort=`, `?page=`, `?limit=` | `{ success, meals[], totalPages }` |
| GET | `/api/meals/:id` | Optional | URL param `:id` | `{ success, meal }` |
| POST | `/api/meals` | Admin | Meal fields in body | `{ success, meal }` |
| PUT | `/api/meals/:id` | Admin | Updated meal fields | `{ success, meal }` |
| DELETE | `/api/meals/:id` | Admin | URL param `:id` | `{ success, message }` |

### Users — `/api/users`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/api/users/profile` | User | — | `{ success, user }` |
| PUT | `/api/users/profile` | User | Profile fields in body | `{ success, user }` |
| POST | `/api/users/favorites/:mealId` | User | URL param `:mealId` | `{ success, message }` |
| DELETE | `/api/users/favorites/:mealId` | User | URL param `:mealId` | `{ success, message }` |
| POST | `/api/users/meal-history` | User | `{ mealId, rating, notes }` | `{ success, message }` |

### Cart — `/api/cart`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/api/cart` | User | — | `{ success, cart }` |
| POST | `/api/cart` | User | `{ mealId, quantity }` | `{ success, cart }` |
| DELETE | `/api/cart/:itemId` | User | URL param `:itemId` | `{ success, cart }` |
| DELETE | `/api/cart` | User | — | `{ success, message }` |

### Orders — `/api/orders`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/api/orders` | User | — | `{ success, orders[] }` |
| POST | `/api/orders` | User | — (uses current cart) | `{ success, order }` |
| GET | `/api/orders/:id` | User | URL param `:id` | `{ success, order }` |

### AI Chat — `/api/chat`

| Method | Path | Auth | Input | Output |
|---|---|---|---|---|
| POST | `/api/chat` | None | `{ message: "string" }` | `{ reply: "string" }` |

The chat endpoint fetches live meal data and the current user's profile before calling the Groq API, so every response is personalised to the user's health condition, goals, and the actual meals in the database.

---

## Key Web Pages

Server-rendered HTML pages. Auth-required pages redirect to `/login` if no valid cookie is present.

| Path | Auth Required | Description |
|---|---|---|
| `/` | No | Landing page with featured meals and live stats |
| `/register` | No | Sign-up form |
| `/login` | No | Sign-in form |
| `/meals` | No | Browse catalogue — search, filter, cook/order mode |
| `/meals/:id` | No | Meal detail — nutrition, ingredients, prescription warnings, log meal |
| `/dashboard` | Yes | Personalised hub — calorie progress, streak, compliance widget |
| `/planner` | Yes | 7-day meal planner — assign meals to breakfast/lunch/dinner |
| `/grocery-list` | Yes | Per-meal ingredient cards with checkboxes |
| `/prescription` | Yes | Paste prescription, view drug-food interactions, compliance report |
| `/profile` | Yes | Edit health profile, goals, allergies, budget |
| `/cart` | Yes | Shopping cart |
| `/checkout` | Yes | Place order |
| `/admin/meals` | Admin only | Create, edit, delete meals |

---

## Deployment

Deployed on **[Render](https://render.com)** with **[MongoDB Atlas](https://www.mongodb.com/atlas)** as the database.

> **Live URL:** *(add your Render URL here)*

### Steps

1. Push code to GitHub (`.env` is git-ignored — never commit secrets).
2. Create a free MongoDB Atlas M0 cluster. Set Network Access to `0.0.0.0/0`.
3. On Render, create a new **Web Service** connected to your GitHub repo:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables in the Render dashboard (see table above).
5. Deploy — meals seed automatically from `data/meals.csv` on first boot.
6. Verify at `https://your-app.onrender.com/health`.

### Pre-deployment Checklist

- [ ] `NODE_ENV=production` set in Render environment
- [ ] `JWT_SECRET` is a strong random string (not the default)
- [ ] `.env` is git-ignored and not committed
- [ ] MongoDB Atlas IP whitelist includes `0.0.0.0/0`
- [ ] `GROQ_API_KEY` added to Render environment variables
- [ ] Test register → login → planner → grocery list → chat on live URL
- [ ] Test on Chrome, Firefox, Edge, Safari

---

## Team Contributions

### Roles and Responsibilities

| Member | Role | Responsibilities |
|---|---|---|
| **Shaik Ahmed Nawab** | Backend Lead | Express server architecture, REST API design, JWT authentication, MongoDB schemas, AI nutrition assistant integration (Groq), deployment setup |
| **Abhishek** | Frontend Lead | EJS templates for all pages, CSS design system, responsive layout, navigation, hover effects, UI polish |
| **Arun Kumar** | Feature Developer | Weekly meal planner, grocery list (per-meal cards), Cook/Order mode toggle, cart management, order checkout flow |
| **Surya Kumari** | Feature Developer | Prescription system, drug-food interaction checker, 7-day compliance report, dashboard widgets, nutrition tracking |

### Feature Ownership

| Feature | Owner |
|---|---|
| User registration and login (JWT, bcrypt) | Shaik Ahmed Nawab |
| MongoDB schemas (User, Meal, Cart, Order, MealPlan) | Shaik Ahmed Nawab |
| REST API endpoints (`/api/auth`, `/api/meals`, `/api/users`, `/api/cart`, `/api/orders`) | Shaik Ahmed Nawab |
| AI nutrition assistant chatbox (`/api/chat`, Groq integration) | Shaik Ahmed Nawab |
| Landing page, meal browse page, meal detail page | Abhishek |
| Navigation bar, alerts, footer, CSS design system | Abhishek |
| Login / register / profile page templates | Abhishek |
| Weekly meal planner (`/planner`) | Arun Kumar |
| Grocery list with per-meal ingredient cards (`/grocery-list`) | Arun Kumar |
| Cook Mode / Order Mode toggle | Arun Kumar |
| Cart and checkout pages (`/cart`, `/checkout`) | Arun Kumar |
| Prescription page — text parsing and restriction extraction (`/prescription`) | Surya Kumari |
| Drug-food interaction checker (13 medication rules) | Surya Kumari |
| 7-day compliance report with green/red/grey day tracking | Surya Kumari |
| Dashboard — calorie progress, streak, mini planner, compliance widget | Surya Kumari |

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` / DB error | Wrong `MONGODB_URI` | Check Atlas connection string and DB user password |
| Site won't load on Render | Cold start (free tier) | Wait ~30s and refresh |
| `EADDRINUSE :::3000` | Port taken locally | Change `PORT` in `.env` or kill the process with `lsof -ti:3000 \| xargs kill` |
| Page shows "Not Found" | Server not restarted after code change | Stop and run `npm start` again |
| Meals not showing | Atlas IP whitelist blocking Render | Set Atlas Network Access to `0.0.0.0/0` |
| Chat not responding | Missing `GROQ_API_KEY` | Add the key to `.env` (local) or Render environment (production) |
| Login redirects back to login | Wrong `JWT_SECRET` | Ensure the same secret is used consistently in `.env` |
