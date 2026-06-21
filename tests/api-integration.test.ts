import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = "http://localhost:3000/api";

describe("Veto — API Integration Tests", () => {
  let ruleId: string;
  let requestId: string;
  let authToken: string;

  // ─────────────────────────────────────────────────────────
  // SEED ENDPOINT: Initialize default rules
  // ─────────────────────────────────────────────────────────
  describe("POST /api/seed", () => {
    it("should seed default rules idempotently", async () => {
      const res = await fetch(`${BASE_URL}/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toContain("rule");
      console.log("✓ Seed endpoint working:", data.message);
    });
  });

  // ─────────────────────────────────────────────────────────
  // OWNER LOGIN: Authenticate owner
  // ─────────────────────────────────────────────────────────
  describe("POST /api/owner/login", () => {
    it("should reject invalid credentials", async () => {
      const res = await fetch(`${BASE_URL}/owner/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "wrong-password",
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBeDefined();
      console.log("✓ Login rejection working");
    });

    it("should accept valid owner password", async () => {
      const res = await fetch(`${BASE_URL}/owner/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "dev-owner-password",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      authToken = data.token;
      console.log("✓ Owner login working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // OWNER STATUS: Check authentication status
  // ─────────────────────────────────────────────────────────
  describe("GET /api/owner/status", () => {
    it("should return authenticated status with valid token", async () => {
      const res = await fetch(`${BASE_URL}/owner/status`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isAuthenticated).toBe(true);
      console.log("✓ Owner status check working");
    });

    it("should reject requests without auth token", async () => {
      const res = await fetch(`${BASE_URL}/owner/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(401);
      console.log("✓ Auth protection working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // RULES: Create, Read, Update, Delete
  // ─────────────────────────────────────────────────────────
  describe("GET /api/rules", () => {
    it("should retrieve existing rules", async () => {
      const res = await fetch(`${BASE_URL}/rules`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      console.log(`✓ Retrieved ${data.length} rules`);
    });
  });

  describe("POST /api/rules", () => {
    it("should create a new rule", async () => {
      const res = await fetch(`${BASE_URL}/rules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: "Test Rule — Max 5 SUI",
          type: "MAX_AMOUNT_PER_TX",
          config: { maxAmountSui: 5 },
          enabled: true,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.name).toBe("Test Rule — Max 5 SUI");
      ruleId = data.id;
      console.log("✓ Rule creation working:", ruleId);
    });

    it("should reject rule creation without auth", async () => {
      const res = await fetch(`${BASE_URL}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Rule",
          type: "MAX_AMOUNT_PER_TX",
          config: { maxAmountSui: 5 },
        }),
      });

      expect(res.status).toBe(401);
      console.log("✓ Rule creation protection working");
    });
  });

  describe("PUT /api/rules/[id]", () => {
    it("should update an existing rule", async () => {
      const res = await fetch(`${BASE_URL}/rules/${ruleId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: "Updated Rule — Max 10 SUI",
          config: { maxAmountSui: 10 },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("Updated Rule — Max 10 SUI");
      console.log("✓ Rule update working");
    });

    it("should reject update without auth", async () => {
      const res = await fetch(`${BASE_URL}/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Update",
        }),
      });

      expect(res.status).toBe(401);
      console.log("✓ Rule update protection working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // ALIASES: Create and manage address aliases
  // ─────────────────────────────────────────────────────────
  describe("GET /api/aliases", () => {
    it("should retrieve aliases", async () => {
      const res = await fetch(`${BASE_URL}/aliases`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      console.log(`✓ Retrieved ${data.length} aliases`);
    });
  });

  describe("POST /api/aliases", () => {
    it("should create a new alias", async () => {
      const res = await fetch(`${BASE_URL}/aliases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          alias: "alice",
          address: "0x1234567890abcdef",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.alias).toBe("alice");
      expect(data.address).toBe("0x1234567890abcdef");
      console.log("✓ Alias creation working");
    });

    it("should reject alias creation without auth", async () => {
      const res = await fetch(`${BASE_URL}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: "bob",
          address: "0xabcdef1234567890",
        }),
      });

      expect(res.status).toBe(401);
      console.log("✓ Alias creation protection working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // AGENT MESSAGE: Parse natural language intent
  // ─────────────────────────────────────────────────────────
  describe("POST /api/agent/message", () => {
    it("should parse valid transfer message", async () => {
      const res = await fetch(`${BASE_URL}/agent/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "send 1 sui to alice",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.status).toBe("AWAITING_CONFIRMATION");
      expect(data.parsedIntent).toBeDefined();
      expect(data.parsedIntent.action).toBe("transfer");
      requestId = data.id;
      console.log("✓ Message parsing working");
    });

    it("should handle invalid message format", async () => {
      const res = await fetch(`${BASE_URL}/agent/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "",
        }),
      });

      expect(res.status).toBe(400);
      console.log("✓ Invalid message rejection working");
    });

    it("should reject JSON parsing errors", async () => {
      const res = await fetch(`${BASE_URL}/agent/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      expect(res.status).toBe(400);
      console.log("✓ Invalid JSON rejection working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // REQUESTS: View agent request history
  // ─────────────────────────────────────────────────────────
  describe("GET /api/requests", () => {
    it("should retrieve request history", async () => {
      const res = await fetch(`${BASE_URL}/requests?limit=50`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      console.log(`✓ Retrieved ${data.length} requests`);
    });

    it("should support pagination", async () => {
      const res = await fetch(`${BASE_URL}/requests?limit=10&offset=0`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      console.log("✓ Pagination working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // WALLET: Check agent wallet balance
  // ─────────────────────────────────────────────────────────
  describe("GET /api/wallet", () => {
    it("should retrieve wallet info", async () => {
      const res = await fetch(`${BASE_URL}/wallet`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.address).toBeDefined();
      expect(data.balance).toBeDefined();
      console.log("✓ Wallet endpoint working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // OWNER LOGOUT: Clear authentication
  // ─────────────────────────────────────────────────────────
  describe("POST /api/owner/logout", () => {
    it("should logout owner", async () => {
      const res = await fetch(`${BASE_URL}/owner/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      console.log("✓ Owner logout working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // DELETE /api/rules/[id]: Delete a rule
  // ─────────────────────────────────────────────────────────
  describe("DELETE /api/rules/[id]", () => {
    it("should delete a rule with auth", async () => {
      // First login again
      const loginRes = await fetch(`${BASE_URL}/owner/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "dev-owner-password",
        }),
      });

      const loginData = await loginRes.json();
      const token = loginData.token;

      // Then delete the rule
      const res = await fetch(`${BASE_URL}/rules/${ruleId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      console.log("✓ Rule deletion working");
    });
  });

  // ─────────────────────────────────────────────────────────
  // ERROR HANDLING
  // ─────────────────────────────────────────────────────────
  describe("Error Handling", () => {
    it("should return 404 for non-existent rule", async () => {
      const res = await fetch(`${BASE_URL}/rules/non-existent-id`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(404);
      console.log("✓ 404 handling working");
    });

    it("should return 405 for invalid HTTP method", async () => {
      const res = await fetch(`${BASE_URL}/seed`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      expect([405, 400]).toContain(res.status);
      console.log("✓ Invalid method handling working");
    });
  });
});
