// ─────────────────────────────────────────────────────────────────────────────
// middleware/webAuth.js — Cookie-based authentication for EJS pages
//
// The REST API routes (routes/auth.js, routes/meals.js, etc.) use Bearer-token
// auth via middleware/auth.js. The EJS web pages use a separate set of
// middleware defined here that reads the same JWT but from an HTTP-only cookie,
// and redirects to /login instead of returning 401 JSON.
// ─────────────────────────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { extractToken } from "./auth.js"; // reads from Authorization header OR cookie

// Builds a redirect URL with a flash message encoded as query params.
// Example: redirectWithMessage(res, "/login", "Session expired") →
//          redirects to /login?message=Session%20expired&type=error
const redirectWithMessage = (res, path, message, type = "error") => {
  const separator = path.includes("?") ? "&" : "?";
  res.redirect(`${path}${separator}message=${encodeURIComponent(message)}&type=${encodeURIComponent(type)}`);
};

// attachCurrentUser — runs on every web request (registered in routes/web.js).
//
// Tries to decode the JWT from the request cookie. If valid, fetches the full
// User document (minus password) and attaches it to both req.currentUser and
// res.locals.currentUser so EJS templates can read it directly via currentUser.
//
// On any failure (missing token, expired, user deleted) it sets currentUser to
// null and calls next() — pages that don't require auth still render normally.
const attachCurrentUser = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      res.locals.currentUser = null;
      return next();
    }

    // Verify signature and expiry; throws if invalid
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Re-fetch from DB so profile changes are always reflected immediately
    const user = await User.findById(decoded.id).select("-password");

    req.user = decoded;            // raw JWT payload (id, role, iat, exp)
    req.currentUser = user || null;         // full Mongoose document
    res.locals.currentUser = user || null;  // available in all EJS templates
    next();
  } catch (error) {
    // Token invalid / expired — treat as logged out, do not crash
    req.user = null;
    req.currentUser = null;
    res.locals.currentUser = null;
    next();
  }
};

// requirePageAuth — protects pages that need a logged-in user.
// If not authenticated, redirects to /login with a message.
// Must be placed after attachCurrentUser in the middleware chain.
const requirePageAuth = (req, res, next) => {
  if (!req.currentUser) {
    return redirectWithMessage(res, "/login", "Please log in to continue.");
  }
  next();
};

// requirePageAdmin — protects admin-only pages (e.g. /admin/meals).
// Redirects to /login if not authenticated, or to /dashboard if authenticated
// but not an admin.
const requirePageAdmin = (req, res, next) => {
  if (!req.currentUser) {
    return redirectWithMessage(res, "/login", "Please log in to continue.");
  }
  if (req.currentUser.role !== "admin") {
    return redirectWithMessage(res, "/dashboard", "Admin access is required for that page.");
  }
  next();
};

export {
  attachCurrentUser,
  requirePageAuth,
  requirePageAdmin,
  redirectWithMessage
};
