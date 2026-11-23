import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const URL = (process.env.DATABASE_URL || process.env.dbURL)!

// prepare: false — Supabase's transaction pooler (port 6543) can't keep
// prepared statements between requests.
export const sql = postgres(URL, {ssl: 'require', prepare: false})
export const db = drizzle(sql)
