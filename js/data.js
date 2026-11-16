// Static game data: materials, explosives, constants and campaign stages.

export const CELL = 0.05;          // metres per target cell
export const GRID_W = 240;         // 12 m wide
export const GRID_H = 120;         // 6 m tall (incl. ground)
export const GROUND_ROWS = 4;
export const G_ROWS = GRID_H - GROUND_ROWS; // rows above ground
export const GRAVITY = 9.81;
export const AIR_RHO = 1.225;
export const SOUND = 340;
export const MUZZLE_H = 1.8;       // launcher height (m)
export const CORE_WIN = 0.4;     // fraction of core cells that must be destroyed

// ---------- shell building materials ----------
// rho kg/m3, H hardness (1-10 game scale), cost credits/kg
export const SHELL_MATS = {
  steel:   { name: 'Mild Steel',       rho: 7850,  H: 4,   cost: 2,  color: '#8d99a6' },
  hsteel:  { name: 'Hardened Steel',   rho: 7850,  H: 6,   cost: 5,  color: '#6d8196' },
  aluminum:{ name: 'Aluminium',        rho: 2700,  H: 1.5, cost: 6,  color: '#c3ccd4' },
  copper:  { name: 'Copper',           rho: 8960,  H: 1.5, cost: 10, color: '#d58a46' },
  lead:    { name: 'Lead',             rho: 11340, H: 0.6, cost: 4,  color: '#727a86' },
  wha:     { name: 'Tungsten Alloy',   rho: 17600, H: 7,   cost: 60, color: '#59606e' },
  wc:      { name: 'Tungsten Carbide', rho: 15600, H: 9,   cost: 80, color: '#3e4552', brittle: true },
  du:      { name: 'Depleted Uranium', rho: 19050, H: 7.5, cost: 95, color: '#5a6640', selfSharpen: true, pyro: true },
};

export const FILLERS = {
  tnt:   { name: 'TNT',    rho: 1650, power: 1.0,  cost: 12 },
  compb: { name: 'Comp B', rho: 1720, power: 1.33, cost: 22 },
  octol: { name: 'Octol',  rho: 1810, power: 1.6,  cost: 40 },
};

export const PROPELLANT = {
  cannonCost: 6,        // per kg of gun charge
  cannonEnergy: 1.45e6, // useful J per kg of charge
  rocketRho: 1750,
  rocketCost: 14,
  rocketVe: 2300,       // exhaust velocity m/s
};

export const FIN_SPAN = [0, 0.35, 0.7, 1.1]; // fin span beyond body, in calibers
export const FIN_NAMES = ['None', 'Small', 'Medium', 'Large'];
export const FIN_COST = [0, 12, 22, 35];
export const CANNON_MAX_BORE = 0.155;
export const CANNON_MAX_LEN = 1.0;
export const ROCKET_MAX_CAL = 0.30;
export const ROCKET_MAX_LEN = 3.0;

// ---------- target materials ----------
// R: KE resistance (J/m^3), H: hardness, rho, heat: HEAT jet resistance (x RHA),
// blast: overpressure needed to breach, absorb: blast attenuation multiplier
export const T = { AIR: 0, GROUND: 1, WOOD: 2, BRICK: 3, CONCRETE: 4, RCONC: 5, STEEL: 6, HHA: 7, CERAMIC: 8, ERA: 9, CORE: 10, GLASS: 11, SAND: 12 };

export const TMATS = [];
TMATS[T.AIR]      = { name: 'Air' };
TMATS[T.GROUND]   = { name: 'Bedrock',     R: 1e12,  H: 10, rho: 2600, heat: 99, blast: 1e9, absorb: 1, color: [43, 39, 34],   solid: true, fixed: true };
TMATS[T.WOOD]     = { name: 'Timber',      R: 0.15e9, H: 0.6, rho: 600, heat: 0.12, blast: 1.2, absorb: 0.8, color: [150, 102, 58], solid: true };
TMATS[T.BRICK]    = { name: 'Brick',       R: 0.6e9, H: 2,   rho: 1900, heat: 0.28, blast: 2.5, absorb: 1, color: [168, 82, 60],  solid: true };
TMATS[T.CONCRETE] = { name: 'Concrete',    R: 1.2e9, H: 3,   rho: 2400, heat: 0.35, blast: 6,   absorb: 1.1, color: [150, 150, 142], solid: true };
TMATS[T.RCONC]    = { name: 'Rebar Concrete', R: 1.8e9, H: 3.5, rho: 2500, heat: 0.45, blast: 9, absorb: 1.2, color: [118, 124, 128], solid: true };
TMATS[T.STEEL]    = { name: 'Armour Steel', R: 4.5e9, H: 5,  rho: 7850, heat: 1.0, blast: 40,  absorb: 1, color: [120, 136, 150], solid: true, spall: true };
TMATS[T.HHA]      = { name: 'High-Hard Steel', R: 5.4e9, H: 6.5, rho: 7850, heat: 1.05, blast: 46, absorb: 1, color: [86, 104, 122], solid: true, spall: true };
TMATS[T.CERAMIC]  = { name: 'Ceramic Composite', R: 5.0e9, H: 9, rho: 3800, heat: 2.6, blast: 30, absorb: 1.3, color: [206, 196, 160], solid: true };
TMATS[T.ERA]      = { name: 'Reactive Tile', R: 2.5e9, H: 5, rho: 3000, heat: 1.0, blast: 15, absorb: 1, color: [204, 170, 40], solid: true, era: true };
TMATS[T.CORE]     = { name: 'Target Core', R: 0.4e9, H: 2,   rho: 3000, heat: 0.4, blast: 3,   absorb: 1, color: [228, 40, 40], solid: true, core: true };
TMATS[T.GLASS]    = { name: 'Glass',       R: 0.3e9, H: 5,   rho: 2500, heat: 0.2, blast: 0.6, absorb: 0.6, color: [150, 210, 230], solid: true };
TMATS[T.SAND]     = { name: 'Sandbags',    R: 0.45e9, H: 1,  rho: 1600, heat: 0.25, blast: 3, absorb: 2.2, color: [176, 156, 104], solid: true };

export const PAINT_MATS = [T.WOOD, T.BRICK, T.CONCRETE, T.RCONC, T.SAND, T.GLASS, T.STEEL, T.HHA, T.CERAMIC, T.ERA, T.CORE];

// ---------- campaign ----------
// build(b): b.rect(x, y, w, h, mat) with x,y in cells from the grid's left edge / ground up.
export const LEVELS = [
  {
    id: 1, name: 'Brick Shed', dist: 150, shots: 1, stars: [35, 60],
    brief: 'A plain brick shed. Anything works — but how cheap can you go?',
    build(b) {
      b.rect(70, 0, 5, 46, T.BRICK); b.rect(110, 0, 5, 46, T.BRICK); b.rect(70, 41, 45, 5, T.BRICK);
      b.rect(82, 12, 18, 2, T.WOOD); b.rect(83, 0, 2, 12, T.WOOD); b.rect(97, 0, 2, 12, T.WOOD);
      b.rect(86, 14, 10, 10, T.CORE);
    },
  },
  {
    id: 2, name: 'Timber Stockade', dist: 250, shots: 1, stars: [35, 60],
    brief: 'Three log palisades guard a wooden hut. Thick, but soft.',
    build(b) {
      for (const x of [44, 60, 76]) { b.rect(x, 0, 7, 58, T.WOOD); b.rect(x + 1, 58, 1, 3, T.WOOD); b.rect(x + 4, 58, 1, 3, T.WOOD); }
      b.box(96, 0, 50, 54, 6, T.WOOD);
      b.rect(112, 0, 18, 16, T.WOOD);
      b.rect(116, 16, 10, 10, T.CORE);
    },
  },
  {
    id: 3, name: 'Sandbag Nest', dist: 400, shots: 1, stars: [90, 160],
    brief: 'Sand soaks up blast waves. A concrete shell hides the core.',
    build(b) {
      b.poly([[70, 0], [96, 0], [96, 40], [92, 40]], T.SAND);
      
      b.rect(96, 0, 6, 44, T.CONCRETE);
      b.rect(96, 44, 54, 8, T.CONCRETE);
      b.rect(144, 0, 6, 44, T.CONCRETE);
      b.rect(108, 0, 18, 14, T.CONCRETE);
      b.rect(112, 14, 10, 10, T.CORE);
    },
  },
  {
    id: 4, name: 'Concrete Pillbox', dist: 500, shots: 1, stars: [110, 190],
    brief: 'One metre of concrete all round. Bring weight or bring boom.',
    build(b) {
      b.box(60, 0, 84, 72, 20, T.CONCRETE);
      b.rect(80, 0, 44, 6, T.CONCRETE);
      b.rect(96, 6, 12, 10, T.CONCRETE);
      b.rect(97, 16, 10, 10, T.CORE);
    },
  },
  {
    id: 5, name: 'Vault Door', dist: 600, shots: 1, stars: [100, 180],
    brief: '15 cm of armour steel in a rebar-concrete frame. Blast alone will not open it.',
    build(b) {
      b.rect(60, 60, 82, 16, T.RCONC);
      b.rect(70, 0, 6, 60, T.RCONC);
      b.rect(76, 0, 3, 60, T.STEEL);
      b.rect(132, 0, 10, 60, T.RCONC);
      b.rect(92, 0, 18, 18, T.RCONC);
      b.rect(96, 18, 10, 10, T.CORE);
    },
  },
  {
    id: 6, name: 'Sloped Glacis', dist: 800, shots: 1, stars: [120, 210],
    brief: '10 cm plate laid back at 60°. Shallow, blunt-angled hits skip right off.',
    build(b) {
      b.poly([[58, 0], [64, 0], [112, 52], [106, 52]], T.STEEL);
      b.rect(106, 52, 56, 2, T.STEEL);
      b.rect(160, 0, 2, 52, T.STEEL);
      b.rect(118, 0, 20, 16, T.STEEL);
      b.rect(122, 16, 12, 12, T.CORE);
    },
  },
  {
    id: 7, name: 'Skirted Hull', dist: 900, shots: 1, stars: [145, 260],
    brief: 'A thin skirt 1.5 m ahead of 15 cm of hull. Jets hate the gap.',
    build(b) {
      b.rect(48, 10, 1, 58, T.STEEL);
      b.rect(46, 66, 36, 1, T.STEEL);
      b.rect(80, 0, 3, 68, T.STEEL);
      b.rect(80, 66, 70, 2, T.STEEL);
      b.rect(148, 0, 2, 66, T.STEEL);
      b.rect(96, 0, 20, 18, T.STEEL);
      b.rect(100, 18, 12, 12, T.CORE);
    },
  },
  {
    id: 8, name: 'Long Shot', dist: 2500, shots: 1, stars: [175, 310],
    brief: '2.5 km away: drag eats speed. Stable, slippery shapes keep their punch.',
    build(b) {
      b.poly([[66, 0], [72, 0], [98, 46], [92, 46]], T.STEEL);
      b.rect(92, 46, 52, 3, T.STEEL);
      b.rect(141, 0, 3, 46, T.STEEL);
      b.rect(104, 0, 20, 16, T.STEEL);
      b.rect(108, 16, 12, 12, T.CORE);
    },
  },
  {
    id: 9, name: 'Ceramic Bastion', dist: 1200, shots: 1, stars: [540, 950],
    brief: '30 cm of ceramic composite backed by steel. Shaped-charge jets crumble in ceramic.',
    build(b) {
      b.rect(72, 0, 6, 70, T.CERAMIC);
      b.rect(78, 0, 2, 70, T.STEEL);
      b.rect(70, 70, 80, 4, T.STEEL);
      b.rect(146, 0, 4, 70, T.STEEL);
      b.rect(96, 0, 20, 18, T.STEEL);
      b.rect(100, 18, 12, 12, T.CORE);
    },
  },
  {
    id: 10, name: 'Deep Bunker', dist: 1000, shots: 2, stars: [740, 1300],
    brief: 'Sand, then rebar concrete, then steel. Two shots: open a hole, then go through it.',
    build(b) {
      b.poly([[40, 0], [80, 0], [80, 74], [70, 74]], T.SAND);
      b.rect(80, 0, 20, 82, T.RCONC);
      b.rect(100, 0, 2, 74, T.STEEL);
      b.rect(100, 74, 70, 10, T.RCONC);
      b.rect(160, 0, 10, 74, T.RCONC);
      b.rect(122, 0, 20, 18, T.RCONC);
      b.rect(126, 18, 12, 12, T.CORE);
    },
  },
  {
    id: 11, name: 'Reactive Tank', dist: 1500, shots: 1, stars: [1080, 1900],
    brief: 'Reactive tiles and a ceramic turret face. The core sits in the turret.',
    build(b) {
      b.rect(40, 0, 130, 8, T.STEEL);
      for (let x = 44; x < 168; x += 14) b.rect(x, 2, 8, 4, T.AIR);
      b.poly([[34, 8], [170, 8], [176, 30], [44, 30], [34, 18]], T.STEEL);
      b.rect(52, 12, 110, 14, T.AIR);
      b.poly([[64, 30], [140, 30], [146, 54], [76, 56], [64, 46]], T.STEEL);
      b.poly([[64, 30], [68, 30], [68, 48], [64, 46]], T.CERAMIC);
      b.rect(72, 33, 62, 18, T.AIR);
      b.rect(96, 33, 14, 14, T.CORE);
      for (let y = 30; y < 48; y += 4) b.rect(60, y, 4, 3, T.ERA);
      for (let x = 36; x < 60; x += 6) b.rect(x, 18 + Math.round((x - 36) / 3), 5, 3, T.ERA);
      b.rect(10, 42, 56, 3, T.STEEL);
    },
  },
  {
    id: 12, name: 'Behemoth', dist: 3000, shots: 2, stars: [1300, 2400],
    brief: 'Reactive tiles, ceramic, high-hard steel, spaced plates. 3 km out. Good luck.',
    build(b) {
      for (let y = 4; y < 80; y += 5) b.rect(36, y, 4, 4, T.ERA);
      b.rect(46, 0, 1, 84, T.HHA);
      b.rect(66, 0, 5, 86, T.CERAMIC);
      b.poly([[72, 0], [75, 0], [97, 86], [94, 86]], T.HHA);
      b.rect(94, 86, 80, 4, T.HHA);
      b.rect(170, 0, 4, 86, T.HHA);
      b.rect(118, 0, 22, 20, T.HHA);
      b.rect(122, 20, 14, 14, T.CORE);
    },
  },
];

export const SANDBOX_TARGETS = [
  { name: 'Empty range', build() {} },
  { name: 'Armour test plates', build(b) { b.rect(60, 0, 2, 60, T.STEEL); b.rect(90, 0, 4, 60, T.STEEL); b.rect(130, 0, 8, 60, T.STEEL); b.rect(180, 0, 12, 12, T.CORE); } },
  { name: 'Concrete block', build(b) { b.rect(60, 0, 100, 80, T.CONCRETE); b.rect(105, 10, 10, 10, T.CORE); } },
  { name: 'Brick tower', build(b) { b.box(80, 0, 50, 110, 4, T.BRICK); for (let y = 20; y < 110; y += 22) b.rect(80, y, 50, 3, T.WOOD); b.rect(100, 0, 10, 10, T.CORE); } },
  ...LEVELS.map(l => ({ name: `Stage ${l.id}: ${l.name}`, build: l.build })),
];
