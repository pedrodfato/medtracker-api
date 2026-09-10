import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db.js";
import * as schema from "../schema.js";
import { parseTrustedOrigins } from "./trustedOrigins.js";
import 'dotenv/config'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),

  emailAndPassword: {
    enabled: true,
  },

  baseURL: process.env.apiURL || process.env.BETTER_AUTH_URL,
  trustedOrigins: parseTrustedOrigins(process.env.TRUSTED_ORIGINS),
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
  user: {
    additionalFields: {
      timezone: {
        type: "string",
        required: false,
        defaultValue: "America/Sao_Paulo",
        input: true,
      },
    },
  },
});