export const C = { bg: '#0E231E', surface: '#143229', raised: '#1B4034', line: '#2C5646', brand: '#26A62D', lime: '#85D950', text: '#D7E5DE', sage: '#97B6A7', danger: '#ED6760', info: '#88CEC6' };
// OpenFreeMap (free, no API key, OpenStreetMap data, 3D buildings). Override with VITE_MAP_STYLE to self-host or switch provider.
export const MAP_STYLE = import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/liberty';
export const MISSION_ICON = { comms: 'Antenna', medical: 'Cross', power: 'Zap', signal: 'Radio', rescue: 'LifeBuoy' };
export const MISSION_NAMES = { comms: 'Communication Tower', medical: 'Medical Supplies', power: 'Power Restoration', signal: 'Emergency Signal', rescue: 'Rescue Preparation' };
export const MISSION_POINTS = { comms: 100, medical: 100, power: 150, signal: 150, rescue: 200 };
export const ITEMS = {
  shield: { name: 'Shield', cost: 80, limit: 2, text: 'Blocks infection attempts for 60 seconds.' },
  radar: { name: 'Radar', cost: 60, limit: 3, text: 'Shows approximate zombie positions within 150 m for 30 seconds.' },
  energy: { name: 'Energy Pack', cost: 50, limit: 2, text: 'Objectives take half the time for 2 minutes.' },
  medkit: { name: 'Antidote', cost: 120, limit: 1, text: 'Passive. Cancels one infection and gives 20 seconds of protection.' },
};
