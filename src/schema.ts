import { text, pgTable, serial, integer, timestamp, boolean } from 'drizzle-orm/pg-core';


export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
})

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { precision: 6, withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true }).notNull(),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { precision: 6, withTimezone: true }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { precision: 6, withTimezone: true }),
	scope: text("scope"),
	idToken: text("id_token"),
	password: text("password"),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true }).notNull(),
});

export const verification = pgTable('verification', {
  id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { precision: 6, withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true }).notNull(),
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