/**
 * Owner auth routes: login, logout, status.
 */

import { Hono } from "hono";
import { z } from "zod";
import { getOwnerPassword } from "../lib/auth.js";
import { setOwnerSessionCookie, clearOwnerSessionCookie, isOwnerAuthorized } from "../lib/auth.js";

const app = new Hono();

const LoginSchema = z.object({ password: z.string().min(1) });

// POST /login
app.post("/login", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validation = LoginSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: "Must include { password: string }" }, 400);
  }

  const expected = getOwnerPassword();
  if (!expected) {
    return c.json({ error: "Server misconfiguration: OWNER_PASSWORD not set" }, 500);
  }

  // Constant-time comparison
  const provided = validation.data.password;
  if (provided.length !== expected.length) {
    return c.json({ error: "Invalid password" }, 401);
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return c.json({ error: "Invalid password" }, 401);
  }

  setOwnerSessionCookie(c);
  return c.json({ ok: true, message: "Owner session established" });
});

// POST /logout
app.post("/logout", (c) => {
  clearOwnerSessionCookie(c);
  return c.json({ ok: true, message: "Logged out" });
});

// GET /status
app.get("/status", (c) => {
  return c.json({ authenticated: isOwnerAuthorized(c) });
});

export { app as ownerRoutes };
