// ─────────────────────────────────────────────────────────────────────────────
// middleware/auth.js — JWT verification for REST API routes
//
// These middleware functions protect /api/* endpoints and return JSON errors
// (not HTML redirects). EJS page auth is handled separately in webAuth.js.
// ─────────────────────────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";

// extractToken — reads the JWT from either:
//   1. Authorization header: "Bearer <token>"  (used by API clients / Postman)
//   2. authToken cookie                         (set by POST /api/auth/login)
//
// This means both browser sessions and API clients are supported with one check.
const extractToken = req => {
  const headerToken = req.headers.authorization?.split(" ")[1];
  return headerToken || req.cookies?.authToken || null;
};

// authMiddleware — verifies the JWT and attaches the decoded payload to req.user.
//
// req.user will contain: { id, role, iat, exp }
// Used on routes that require any authenticated user (e.g. GET /api/users/profile).
const authMiddleware = (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided. Please login first."
      });
    }

    // Throws JsonWebTokenError or TokenExpiredError if invalid
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again."
      });
    }
    return res.status(401).json({
      success: false,
      message: "Invalid token. Authentication failed."
    });
  }
};

// optionalAuthMiddleware — same as authMiddleware but never blocks the request.
// If a valid token is present, req.user is populated; otherwise req.user stays
// undefined and next() is called anyway.
// Used on public routes that can return richer data for logged-in users
// (e.g. GET /api/meals can show personalised results if a token is present).
const optionalAuthMiddleware = (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    // Invalid / expired token — treat as unauthenticated, do not reject
    next();
  }
};

// adminMiddleware — must be used AFTER authMiddleware.
// Checks that the authenticated user has the "admin" role.
// Used to gate meal creation, editing, and deletion.
const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin role required."
    });
  }
  next();
};

export {
  extractToken,
  authMiddleware,
  adminMiddleware,
  optionalAuthMiddleware
};
