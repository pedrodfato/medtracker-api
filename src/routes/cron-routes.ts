import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { doses_history, medications, reminders_sent, user } from '../schema.js';
import { eq, inArray, max } from 'drizzle-orm';
import { findDueReminders, type ReminderCandidate } from '../lib/reminders.js';
import { sendDoseReminder } from '../lib/email.js';

export async function cronRoutes(app: FastifyInstance) {
    // Called every 5 minutes by cron-job.org with the shared CRON_SECRET.
    app.get('/cron/reminders', async (request, reply) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) {
            return reply.status(500).send({ error: 'CRON_SECRET não configurado' });
        }
        if (request.headers.authorization !== `Bearer ${secret}`) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const rows = await db.select({
            medication: medications,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                timezone: user.timezone,
                reminderEnabled: user.reminderEnabled,
                reminderLeadMinutes: user.reminderLeadMinutes,
            },
        })
            .from(medications)
            .innerJoin(user, eq(medications.userId, user.id))
            .where(eq(user.reminderEnabled, true));

        const medicationIds = rows.map((row) => row.medication.id);
        const lastDoses = medicationIds.length === 0 ? [] : await db.select({
            medicationId: doses_history.medicationId,
            lastTakenAt: max(doses_history.takenAt),
        })
            .from(doses_history)
            .where(inArray(doses_history.medicationId, medicationIds))
            .groupBy(doses_history.medicationId);

        const lastTakenByMedication = new Map(lastDoses.map((dose) => [dose.medicationId, dose.lastTakenAt]));

        const candidates: ReminderCandidate[] = rows.map((row) => ({
            medication: row.medication,
            lastDoseTakenAt: lastTakenByMedication.get(row.medication.id) ?? null,
            user: row.user,
        }));

        const due = findDueReminders(candidates, new Date());
        let sent = 0;
        let skipped = 0;
        let failed = 0;

        for (const reminder of due) {
            let claimedId: number | null = null;
            try {
                // Claim the slot first: the unique index guarantees a single email
                // per dose even if two cron runs overlap.
                const [claimed] = await db.insert(reminders_sent)
                    .values({
                        medicationId: reminder.medicationId,
                        userId: reminder.userId,
                        scheduledFor: reminder.scheduledFor,
                    })
                    .onConflictDoNothing({ target: [reminders_sent.medicationId, reminders_sent.scheduledFor] })
                    .returning({ id: reminders_sent.id });

                if (!claimed) {
                    skipped++;
                    continue;
                }
                claimedId = claimed.id;

                await sendDoseReminder(reminder);
                sent++;
            } catch (error) {
                failed++;
                app.log.error({ err: error, medicationId: reminder.medicationId }, 'Falha ao enviar lembrete');
                if (claimedId !== null) {
                    // Release the claim so the next run retries this dose.
                    try {
                        await db.delete(reminders_sent).where(eq(reminders_sent.id, claimedId));
                    } catch (releaseError) {
                        app.log.error({ err: releaseError, medicationId: reminder.medicationId }, 'Falha ao liberar lembrete para nova tentativa');
                    }
                }
            }
        }

        return reply.status(200).send({ checked: candidates.length, sent, skipped, failed });
    });
}
