import { z } from 'zod';
import { MAX_AREA_RADIUS, MAX_POLY_RANGE } from './constants.js';
import { centroid, haversine, polygonAreaM2, polygonSelfIntersects } from './geo.js';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
export const llSchema = z.object({ lat, lng });

export const areaSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('circle'), center: llSchema, radius: z.number().min(50).max(MAX_AREA_RADIUS) }),
    z.object({ type: z.literal('polygon'), points: z.array(llSchema).min(3).max(40) }),
  ])
  .refine(
    (a) => {
      if (a.type !== 'polygon') return true;
      const c = centroid(a.points);
      return a.points.every((p) => haversine(c, p) <= MAX_POLY_RANGE);
    },
    { message: `Every corner must be within ${MAX_POLY_RANGE} m of the area centre.` }
  )
  .refine((a) => a.type !== 'polygon' || polygonAreaM2(a.points) >= 5_000, { message: 'Drawn area is too small (min 5,000 m²).' })
  .refine((a) => a.type !== 'polygon' || polygonAreaM2(a.points) <= 3_000_000, { message: 'Drawn area is too large (max 3 km²).' })
  .refine((a) => a.type !== 'polygon' || !polygonSelfIntersects(a.points), { message: 'The drawn path crosses itself.' });

export const settingsSchema = z.object({
  name: z.string().trim().min(3).max(40),
  maxPlayers: z.number().int().min(2).max(30),
  zombieCount: z.number().int().min(1).max(8),
  durationMin: z.number().int().min(5).max(90),
  area: areaSchema.nullable(),
  shrink: z.boolean(),
  infectionRange: z.number().min(5).max(25),
  qrTtlSec: z.number().int().min(10).max(30),
  revealIntervalSec: z.number().int().min(30).max(300),
  hintRadius: z.number().int().min(30).max(150),
  requiredMissions: z.number().int().min(1).max(5),
  missionHoldSec: z.number().int().min(10).max(300),
  extractionHoldSec: z.number().int().min(10).max(180),
  extractionWindowMin: z.number().int().min(1).max(15),
  hideSec: z.number().int().min(0).max(300),
  firstHintSec: z.number().int().min(5).max(60),
  hintVisibleSec: z.number().int().refine((v) => v === 0 || (v >= 10 && v <= 120), 'Use 0 (until the next scan) or 10-120 s.'),
  noisyObjectives: z.boolean(),
  survivorWinPercent: z.number().int().min(1).max(100),
  supplyMode: z.enum(['credits', 'free']),
  supplyStock: z.number().int().min(1).max(10),
  supplyRefillSec: z.number().int().min(60).max(600),
  graceSec: z.number().int().min(15).max(180),
  zonePenalty: z.enum(['infect', 'warn']),
  maxAccuracy: z.number().int().min(10).max(60),
  survivorsKnowTeam: z.boolean(),
  revealToSurvivors: z.boolean(),
  allowSimGps: z.boolean(),
  forfeitSignalLossSec: z.number().int().refine((v) => v === 0 || (v >= 60 && v <= 900), 'Use 0 (off) or 60-900 s.'),
  countdownSec: z.number().int().min(5).max(30),
  hostSafetyConfirmed: z.boolean(),
}).refine((s) => s.zombieCount < s.maxPlayers, { message: 'Zombies must be fewer than max players.' })
  .refine((s) => s.extractionWindowMin * 2 <= s.durationMin, { message: 'Extraction window must be at most half the match.' })
  .refine((s) => s.allowSimGps || s.missionHoldSec >= 60, { message: 'Mission time must be at least 60 s (shorter only in practice mode).' })
  .refine((s) => s.allowSimGps || s.extractionHoldSec >= 60, { message: 'Extraction time must be at least 60 s (shorter only in practice mode).' })
  .refine((s) => s.hideSec * 1000 <= (s.durationMin * 60_000) / 2, { message: 'Hide phase must be at most half the match.' });

export const DEFAULT_SETTINGS = {
  name: 'Humans: The Last Alive',
  maxPlayers: 10,
  zombieCount: 2,
  durationMin: 30,
  area: null,
  shrink: true,
  infectionRange: 10,
  qrTtlSec: 15,
  revealIntervalSec: 120,
  hintRadius: 60,
  requiredMissions: 3,
  missionHoldSec: 120,
  extractionHoldSec: 60,
  extractionWindowMin: 5,
  hideSec: 90,
  firstHintSec: 10,
  hintVisibleSec: 0,
  noisyObjectives: true,
  survivorWinPercent: 50,
  supplyMode: 'credits',
  supplyStock: 3,
  supplyRefillSec: 180,
  graceSec: 60,
  zonePenalty: 'infect',
  maxAccuracy: 30,
  survivorsKnowTeam: true,
  revealToSurvivors: true,
  allowSimGps: false,
  forfeitSignalLossSec: 300,
  countdownSec: 10,
  hostSafetyConfirmed: false,
};

export const checkpointSchema = z.object({
  id: z.string().regex(/^[\w-]{3,40}$/),
  kind: z.enum(['mission', 'supply', 'extraction']),
  missionType: z.enum(['comms', 'medical', 'power', 'signal', 'rescue']).nullable().optional(),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(''),
  lat, lng,
  radius: z.number().min(10).max(80),
  active: z.boolean(),
  approved: z.boolean(),
}).refine((c) => c.kind !== 'mission' || !!c.missionType, { message: 'Mission checkpoints need a mission type.' });

export const checkpointsSchema = z.array(checkpointSchema).max(40);

export const cleanText = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
