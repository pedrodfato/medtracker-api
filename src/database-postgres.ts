import { eq, ilike } from "drizzle-orm"

import { sql, db } from "./db.js"
import { medications } from "./schema.js"

interface Remedio {
    name: string;
    dosage: string;
    totalPills: number;
    frequencyHours: number;
    startDate: string;
    endDate?: string | null;
}

export class DatabasePostgres {


    async list(search?: string) {
        if (search) {
            return await db.select().from(medications).where(ilike(medications.name, `%${search}%`))
        }
        return await db.select().from(medications);
    }

    async create(remedio: Remedio) {


        await db.insert(medications).values({
           name: remedio.name,
            dosage: remedio.dosage,
            totalPills: remedio.totalPills,
            frequencyHours: remedio.frequencyHours,
            startDate: new Date(remedio.startDate), 
            endDate: remedio.endDate ? new Date(remedio.endDate) : null,
        });
    }

    async update(id: number, remedio: Remedio) {

        await db.update(medications).set({
           name: remedio.name,
            dosage: remedio.dosage,
            totalPills: remedio.totalPills,
            frequencyHours: remedio.frequencyHours,
            startDate: new Date(remedio.startDate),
            endDate: remedio.endDate ? new Date(remedio.endDate) : null,
        }).where(eq(medications.id, id));
    }

    async delete(id: number) {
        await db.delete(medications).where(eq(medications.id, id));
    }

}   