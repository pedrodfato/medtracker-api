import { pgTable, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core';


export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  dosage: varchar('dosage', { length: 100 }).notNull(),
  totalPills: integer('total_pills').notNull(),
  frequencyHours: integer('frequency_hours').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'), 
  createdAt: timestamp('created_at').defaultNow(),
});