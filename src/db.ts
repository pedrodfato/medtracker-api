import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const URL = process.env.dbURL!

export const sql = postgres(URL, {ssl: 'require'}) 
export const db = drizzle(sql)
