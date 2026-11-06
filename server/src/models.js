import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    googleId: { type: String, index: { unique: true, sparse: true } },
    email: { type: String, required: true, lowercase: true, trim: true, index: { unique: true } },
    emailVerified: { type: Boolean, default: false },
    name: { type: String, default: '' },             // real name from Google (private)
    displayName: { type: String, required: true, maxlength: 20 }, // public callsign
    photoUrl: { type: String, default: '' },         // Google profile photo
    avatar: { type: String, default: '' },           // LEGACY inline data URL - migrated to the Avatar collection at startup
    avatarVer: { type: String, default: '' },        // hash of the stored picture (cache-busting); '' = none
    role: { type: String, enum: ['player', 'admin'], default: 'player' },
    suspended: { type: Boolean, default: false },
    suspendedReason: { type: String, default: '' },
    tokenVersion: { type: Number, default: 0 },
    consents: {
      version: String,
      acceptedAt: Date,
      terms: Boolean, privacy: Boolean, location: Boolean, safety: Boolean, age: Boolean,
    },
    stats: {
      games: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      asSurvivor: { type: Number, default: 0 },
      asZombie: { type: Number, default: 0 },
      infections: { type: Number, default: 0 },
      missions: { type: Number, default: 0 },
      extractions: { type: Number, default: 0 },
      points: { type: Number, default: 0 },
      secondsPlayed: { type: Number, default: 0 },
    },
    lastLoginAt: Date,
    isDev: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const gameSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    hostId: { type: String, index: true },
    name: String,
    status: { type: String, index: true },
    playerIds: { type: [String], index: true },
    playerCount: Number,
    state: { type: Schema.Types.Mixed }, // live snapshot (removed when finished)
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true, minimize: false }
);

const resultSchema = new Schema(
  {
    gameId: { type: String, index: true },
    code: String,
    name: String,
    hostId: String,
    winner: String, // survivors | zombies | none
    reason: String,
    durationSec: Number,
    startedAt: Date,
    endedAt: { type: Date, index: { expires: 60 * 60 * 24 * 365 } }, // 1 year retention
    settings: Schema.Types.Mixed,
    missionsDone: [String],
    playerIds: { type: [String], index: true },
    players: [
      {
        userId: String, name: String, avatar: String,
        startRole: String, endRole: String, status: String, outcome: String, won: Boolean, bonus: Number,
        score: Number, missions: Number, infections: Number, extracted: Boolean,
      },
    ],
    events: [{ t: Number, msg: String }],
  },
  { minimize: false }
);

const reportSchema = new Schema(
  {
    gameCode: String,
    reporterId: { type: String, index: true },
    reporterName: String,
    kind: { type: String, enum: ['hazard', 'medical', 'harassment', 'trespass', 'bug', 'other'] },
    note: { type: String, maxlength: 500 },
    loc: { lat: Number, lng: Number },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    resolvedBy: String,
    resolvedAt: Date,
    createdAt: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 180 } },
  },
  { minimize: false }
);

const presetSchema = new Schema(
  {
    ownerId: { type: String, index: true },
    name: { type: String, maxlength: 60 },
    area: Schema.Types.Mixed,
    checkpoints: Schema.Types.Mixed,
  },
  { timestamps: true }
);

const auditSchema = new Schema({
  at: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 365 } },
  actorId: String, actorEmail: String, action: String, target: String, meta: Schema.Types.Mixed,
});

const settingSchema = new Schema({ _id: String, value: Schema.Types.Mixed });

// One small image per user, stored once and served by URL (never embedded in game state or results).
const avatarSchema = new Schema({ _id: String, mime: String, hash: String, data: Buffer, updatedAt: { type: Date, default: Date.now } });

export const User = model('User', userSchema);
export const Avatar = model('Avatar', avatarSchema);
export const Game = model('Game', gameSchema);
export const GameResult = model('GameResult', resultSchema);
export const Report = model('Report', reportSchema);
export const Preset = model('Preset', presetSchema);
export const Audit = model('Audit', auditSchema);
export const Setting = model('Setting', settingSchema);
