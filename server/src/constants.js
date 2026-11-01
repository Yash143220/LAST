export const MISSIONS = {
  comms:   { name: 'Communication Tower', points: 100, text: 'Hold position at the relay beacon until the uplink is restored.' },
  medical: { name: 'Medical Supplies',    points: 100, text: 'Secure the supply cache and stabilise the kit.' },
  power:   { name: 'Power Restoration',   points: 150, text: 'Stay at the generator point while it restarts.' },
  signal:  { name: 'Emergency Signal',    points: 150, text: 'Broadcast the distress signal from the open signal point.' },
  rescue:  { name: 'Rescue Preparation',  points: 200, text: 'Mark the landing zone and prepare it for pickup.' },
};

export const ITEMS = {
  shield: { name: 'Shield',      cost: 80,  limit: 2, text: 'Blocks infection attempts for 60 seconds.' },
  radar:  { name: 'Radar',       cost: 60,  limit: 3, text: 'Reveals approximate zombie positions within 150 m for 30 seconds.' },
  energy: { name: 'Energy Pack', cost: 50,  limit: 2, text: 'Missions and extraction hold take half the time for 2 minutes.' },
  medkit: { name: 'Antidote',    cost: 120, limit: 1, text: 'Passive. Cancels one infection and grants 20 seconds of protection.' },
};
export const SHIELD_MS = 60_000;
export const ENERGY_MS = 120_000;
export const ANTIDOTE_MS = 20_000;
export const RADAR_MS = 30_000;
export const RADAR_RANGE = 150;
export const SUPPLY_COOLDOWN_MS = 30_000;
export const START_CREDITS = 50;
export const FIX_FRESH_MS = 20_000;     // a location fix older than this is not trusted for actions
export const HINT_FRESH_MS = 90_000;    // players with no fix in this window are not revealed
export const MAX_AREA_RADIUS = 1500;    // metres - hard limit for any game area
export const MAX_POLY_RANGE = 1000;     // max distance of any polygon vertex from its centroid
export const GAME_RETENTION_MS = 10 * 60_000;

// Shrinking safe zone, expressed as fractions so it scales with any host-chosen area.
// Matches the default 30-minute table: 300/260/220/170/120/70/40 m at 0/5/10/15/20/25/28 min.
export const ZONE_STAGES = [
  { at: 0,        f: 1 },
  { at: 5 / 30,   f: 260 / 300 },
  { at: 10 / 30,  f: 220 / 300 },
  { at: 15 / 30,  f: 170 / 300 },
  { at: 20 / 30,  f: 120 / 300 },
  { at: 25 / 30,  f: 70 / 300 },
  { at: 28 / 30,  f: 40 / 300 },
];
