import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db.js";
import * as schema from "../schema.js";
import 'dotenv/config'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", 
    schema: schema,
  }),
  
  emailAndPassword: {
    enabled: true,
  },
  
  baseURL: process.env.apiURL || 'http://localhost:3333',
  trustedOrigins: process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(',') : undefined,
});