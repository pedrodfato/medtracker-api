import 'dotenv/config'

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'


const { PGRole, PGPassword, PGPoolerhost, PGDatabase } = process.env;
const URL = `postgresql://${PGRole}:${PGPassword}@${PGPoolerhost}/${PGDatabase}?sslmode=require&channel_binding=require`

export const sql = postgres(URL, {ssl: 'require'}) 
export const db = drizzle(sql)
