import { pgTable, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

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