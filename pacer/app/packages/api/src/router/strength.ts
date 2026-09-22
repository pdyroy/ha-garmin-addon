import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, desc, eq, gte, inArray, lte } from "@acme/db";
import { StrengthSet } from "@acme/db/schema";
import {
  computeCoverage,
  EXERCISES,
  findExercise,
  suggestWindowDays,
} from "@acme/engine";

import { protectedProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Strength logging — movement pattern coverage
// ---------------------------------------------------------------------------
//
// Garmin records that a strength session happened but not what was in it, so
// sets are entered here. Every procedure is protected and scoped to
// `ctx.session.user.id`: the add-on ships publicly, so an id is never read
// from the input, and no procedure can reach another user's rows even when
// handed a valid row id.

/** Set slots offered per exercise per day. */
export const MAX_SETS_PER_EXERCISE = 7;

/** How much history coverage needs to resolve staleness beyond the window. */
const HISTORY_DAYS = 120;

/**
 * Ceiling on the coverage scan. Seven slots across forty-odd exercises is a
 * few hundred rows a week, so this is roughly a year of dense logging — far
 * more than coverage reads, and it keeps one query from walking the table if
 * rows ever arrive from somewhere other than the log UI.
 */
const COVERAGE_ROW_LIMIT = 5000;

/**
 * Only slugs that exist in EXERCISES are accepted. The column is free text,
 * so without this an arbitrary string would be stored and then silently
 * counted as unclassified forever.
 */
const exerciseIdSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((id) => findExercise(id) !== undefined, {
    message: "Unknown exercise",
  });

/**
 * A single set. `reps` is required because every logged set is at least one
 * repetition; weight is absent for bodyweight work, and duration replaces
 * reps as the meaningful number for carries and planks.
 */
const setInputSchema = z.object({
  reps: z.number().int().min(1).max(500),
  weightKg: z.number().min(0).max(1000).nullish(),
  durationSeconds: z.number().int().min(1).max(3600).nullish(),
  rpe: z.number().min(1).max(10).nullish(),
});

/**
 * YYYY-MM-DD, parsed as UTC noon so a day never slips across a boundary.
 *
 * The round-trip is the actual check: `Date.parse("2026-02-30T12:00:00Z")`
 * does not fail, it rolls over to 2 March, and the set would then be filed
 * under a day the athlete never picked. Re-formatting and comparing rejects
 * every such date. The range bound keeps a typo'd year out of the log —
 * one day of slack ahead covers a timezone that is already past midnight.
 */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(
    (day) => {
      // Zod runs every check in the chain, so this sees strings the regex
      // already rejected — and `toISOString()` throws on an unparseable
      // date rather than returning something to compare. Guard first.
      const parsed = new Date(`${day}T12:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === day
      );
    },
    { message: "Not a real date" },
  )
  .refine(
    (day) => {
      const picked = Date.parse(`${day}T12:00:00Z`);
      const now = Date.now();
      return picked <= now + 86_400_000 && picked >= now - 3650 * 86_400_000;
    },
    { message: "Date must be within the last ten years and not in the future" },
  );

function dayToTimestamp(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export const strengthRouter = {
  /**
   * Pattern coverage over a rolling window, plus the nine tiles' state.
   * `sessionsPerWeek` only picks the default window length; an explicit
   * `windowDays` wins.
   */
  coverage: protectedProcedure
    .input(
      z
        .object({
          windowDays: z.number().int().min(1).max(90).optional(),
          sessionsPerWeek: z.number().int().min(1).max(14).optional(),
          staleAfterDays: z.number().int().min(1).max(90).default(10),
        })
        .default({ staleAfterDays: 10 }),
    )
    .query(async ({ ctx, input }) => {
      const windowDays =
        input.windowDays ?? suggestWindowDays(input.sessionsPerWeek ?? 3);

      const rows = await ctx.db
        .select({
          performedAt: StrengthSet.performedAt,
          exerciseId: StrengthSet.exerciseId,
        })
        .from(StrengthSet)
        .where(
          and(
            eq(StrengthSet.userId, ctx.session.user.id),
            gte(StrengthSet.performedAt, daysAgo(HISTORY_DAYS)),
          ),
        )
        .orderBy(desc(StrengthSet.performedAt))
        .limit(COVERAGE_ROW_LIMIT);

      return computeCoverage(rows, {
        windowDays,
        staleAfterDays: input.staleAfterDays,
      });
    }),

  /** Every set logged on one day, grouped by exercise in log order. */
  day: protectedProcedure
    .input(z.object({ date: daySchema }))
    .query(async ({ ctx, input }) => {
      const start = new Date(`${input.date}T00:00:00Z`);
      const end = new Date(`${input.date}T23:59:59.999Z`);

      const rows = await ctx.db
        .select()
        .from(StrengthSet)
        .where(
          and(
            eq(StrengthSet.userId, ctx.session.user.id),
            gte(StrengthSet.performedAt, start),
            lte(StrengthSet.performedAt, end),
          ),
        )
        .orderBy(asc(StrengthSet.performedAt), asc(StrengthSet.setIndex));

      const byExercise = new Map<string, typeof rows>();
      for (const row of rows) {
        const bucket = byExercise.get(row.exerciseId) ?? [];
        bucket.push(row);
        byExercise.set(row.exerciseId, bucket);
      }

      return [...byExercise.entries()].map(([exerciseId, sets]) => ({
        exerciseId,
        name: findExercise(exerciseId)?.name ?? exerciseId,
        pattern: findExercise(exerciseId)?.pattern ?? null,
        sets: sets.map((s) => ({
          id: s.id,
          setIndex: s.setIndex,
          reps: s.reps,
          weightKg: s.weightKg,
          durationSeconds: s.durationSeconds,
          rpe: s.rpe,
          notes: s.notes,
        })),
      }));
    }),

  /**
   * Replace one day's work on one exercise. The log UI edits all of an
   * exercise's slots at once, so a replace is what it actually means — a
   * per-set upsert would leave deleted slots behind. Runs in a transaction
   * so a failed insert cannot wipe the previous entry.
   */
  logExercise: protectedProcedure
    .input(
      z.object({
        date: daySchema,
        exerciseId: exerciseIdSchema,
        sets: z.array(setInputSchema).max(MAX_SETS_PER_EXERCISE),
        notes: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const performedAt = dayToTimestamp(input.date);
      const start = new Date(`${input.date}T00:00:00Z`);
      const end = new Date(`${input.date}T23:59:59.999Z`);

      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: StrengthSet.id })
          .from(StrengthSet)
          .where(
            and(
              eq(StrengthSet.userId, userId),
              eq(StrengthSet.exerciseId, input.exerciseId),
              gte(StrengthSet.performedAt, start),
              lte(StrengthSet.performedAt, end),
            ),
          );

        if (existing.length > 0) {
          await tx.delete(StrengthSet).where(
            and(
              eq(StrengthSet.userId, userId),
              inArray(
                StrengthSet.id,
                existing.map((r) => r.id),
              ),
            ),
          );
        }

        if (input.sets.length === 0) return { saved: 0 };

        await tx.insert(StrengthSet).values(
          input.sets.map((set, i) => ({
            userId,
            performedAt,
            exerciseId: input.exerciseId,
            setIndex: i + 1,
            reps: set.reps,
            weightKg: set.weightKg ?? null,
            durationSeconds: set.durationSeconds ?? null,
            rpe: set.rpe ?? null,
            notes: i === 0 ? (input.notes ?? null) : null,
          })),
        );

        return { saved: input.sets.length };
      });
    }),

  /**
   * Per-day progression for one exercise: the heaviest set and the day's
   * total volume. Enough for a simple chart; no autoregulation.
   */
  history: protectedProcedure
    .input(
      z.object({
        exerciseId: exerciseIdSchema,
        days: z.number().int().min(7).max(730).default(180),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          performedAt: StrengthSet.performedAt,
          reps: StrengthSet.reps,
          weightKg: StrengthSet.weightKg,
        })
        .from(StrengthSet)
        .where(
          and(
            eq(StrengthSet.userId, ctx.session.user.id),
            eq(StrengthSet.exerciseId, input.exerciseId),
            gte(StrengthSet.performedAt, daysAgo(input.days)),
          ),
        )
        .orderBy(asc(StrengthSet.performedAt));

      const byDay = new Map<
        string,
        {
          sets: number;
          reps: number;
          topWeightKg: number | null;
          volumeKg: number;
        }
      >();
      for (const row of rows) {
        const day = isoDay(row.performedAt);
        const agg = byDay.get(day) ?? {
          sets: 0,
          reps: 0,
          topWeightKg: null,
          volumeKg: 0,
        };
        agg.sets += 1;
        agg.reps += row.reps;
        if (row.weightKg != null) {
          agg.volumeKg += row.weightKg * row.reps;
          if (agg.topWeightKg == null || row.weightKg > agg.topWeightKg) {
            agg.topWeightKg = row.weightKg;
          }
        }
        byDay.set(day, agg);
      }

      return [...byDay.entries()].map(([date, agg]) => ({ date, ...agg }));
    }),

  /** Delete one set. Scoped by user, so a foreign row id resolves to nothing. */
  deleteSet: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(StrengthSet)
        .where(
          and(
            eq(StrengthSet.id, input.id),
            eq(StrengthSet.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: StrengthSet.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Set not found" });
      }
      return { success: true };
    }),

  /** The days with logged work, newest first — the log's own history list. */
  recentDays: protectedProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(90).default(20) }).default({
        limit: 20,
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          performedAt: StrengthSet.performedAt,
          exerciseId: StrengthSet.exerciseId,
        })
        .from(StrengthSet)
        .where(eq(StrengthSet.userId, ctx.session.user.id))
        .orderBy(desc(StrengthSet.performedAt))
        .limit(input.limit * MAX_SETS_PER_EXERCISE * EXERCISES.length);

      const byDay = new Map<string, { sets: number; exercises: Set<string> }>();
      for (const row of rows) {
        const day = isoDay(row.performedAt);
        const agg = byDay.get(day) ?? { sets: 0, exercises: new Set<string>() };
        agg.sets += 1;
        agg.exercises.add(row.exerciseId);
        byDay.set(day, agg);
      }

      return [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, input.limit)
        .map(([date, agg]) => ({
          date,
          sets: agg.sets,
          exercises: agg.exercises.size,
        }));
    }),
} satisfies TRPCRouterRecord;
