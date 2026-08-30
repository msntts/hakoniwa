export const GRASS_PARAMS = {
  growthRate: 0.03,
  capacity: 1.0,
  grazePerBite: 0.15,
  // 3 breakpoints -> 4 height categories (bare / . / w / W)
  heightThresholds: [0.15, 0.45, 0.75] as const,
  colorBuckets: 8,
  // Growth draws down this per-tile soil nutrient stock 1:1 -- no fertility,
  // no growth, regardless of how much biomass is already there or how empty
  // the tile looks. Replenished only through the herbivore/decomposer cycle
  // (see HERBIVORE_PARAMS.excretionRatio / carcassFertility below).
  fertilityCap: 1.0,
  // Fraction of a tile's own biomass it sheds onto the soil of its 8
  // neighbors each tick (split evenly), as fertility -- lets a grazed-bare
  // tile next to a lush patch recover and start growing again, thickening
  // outward. Tuned down hard from an initial 0.05: at that rate the
  // *aggregate* effect across thousands of tiles was strong enough, on its
  // own, to hold a herd at a permanent ~400-480 plateau instead of ever
  // crashing to extinction -- animal-independent regrowth stopped being a
  // slow background process and started actively propping up a die-off. At
  // 0.002 a herd can still starve out completely, and an animal-free board
  // still recovers (confirmed: fully regrew to max lushness on its own,
  // left alone for a few thousand ticks after a total extinction) -- it
  // just takes real time, the way it should.
  spreadRate: 0.002,
  // Fraction of a tile's own biomass it returns to its *own* soil each tick,
  // regardless of grazing -- old leaves and roots turning over, independent
  // of spreadRate (which needs a neighbor; this doesn't). Kept just as small
  // for the same reason: it must stay too weak to prop up a herd that would
  // otherwise starve out.
  senescenceRate: 0.0001,
};

export const HERBIVORE_PARAMS = {
  capacity: 2000,
  initialCount: 150,

  // Two independent stocks decide death, not one blended "energy" pool:
  // `age` (below, capped by lifespanTicks) counts ticks alive regardless of
  // feeding; `hunger` (0 = full, 1 = starving) tracks how recently an
  // individual has actually eaten. A well-fed individual from a past boom
  // could previously coast on a large banked energy reserve for a long time
  // after food dried up, which is why the herd seemed to survive on almost
  // no grass. Hunger has no reserve to bank -- it climbs every tick and only
  // drops when a bite actually lands, so it reflects *current* feeding, not
  // feeding history.
  hungerGainPerTick: 0.05, // unfed, hits starvation (1.0) in ~20 ticks (~1 epoch)
  // Deliberately close to hungerGainPerTick: at 0.25 a single lucky bite once
  // every several ticks was enough to stay reproduction-ready forever, so a
  // crowded herd on a mostly-grazed board never actually ran out of steam.
  // At 0.1, being fed less than every other tick on average is a losing
  // trade -- sustained access to food is required, not occasional luck.
  grazeHungerRelief: 0.1,
  starvationHunger: 1.0,
  initialHunger: 0.5,

  // Reproduction requires being *currently* well-fed (low hunger), not just
  // having energy banked -- during a famine this shuts off immediately even
  // for individuals that reproduced freely during the preceding boom.
  reproHungerThreshold: 0.15,
  reproHungerCost: 0.3,

  grazeBiomassThreshold: 0.1,

  // 排泄 (while alive) and 死骸 (on death) are what tie "something ate/died
  // here" to "something can grow here again later" -- on top of the slower,
  // animal-independent senescence trickle above (GRASS_PARAMS.senescenceRate).
  excretionRatio: 0.5, // fraction of each bite returned to the tile as fertility

  // A carcass doesn't dump its fertility instantly -- it stays visible on
  // the tile and decomposes over carcassDecayTicks, releasing an even share
  // of carcassFertility (much more than daily droppings) each tick. This is
  // the "遅延" (delay) from design.md's causal loop made concrete: death pays
  // off the next growth only after decomposition actually finishes.
  carcassFertility: 0.4,
  carcassDecayTicks: 10, // ~5s

  // 多産多死: short-lived on purpose. At 2000 ticks (1000s) old age never
  // actually fired, so starvation was the only source of death and a
  // population that found even scraps of food just sat there indefinitely.
  // At 200 ticks (100s / ~10 epochs) the herd needs constant reproduction to
  // hold its numbers -- once food gets scarce enough that reproduction stops
  // keeping up, aging alone thins the herd fast.
  lifespanTicks: 200,
  visionRadius: 3,
};
