import { text, pgTable, serial, integer, timestamp, boolean } from 'drizzle-orm/pg-core';


export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  password: text('password'),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
})

export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  dosage: text('dosage').notNull(),
  totalPills: integer('total_pills').notNull(),
  frequencyHours: integer('frequency_hours').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'), 
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});