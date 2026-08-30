export const GRASS_PARAMS = {
  growthRate: 0.03,
  capacity: 1.0,
  grazePerBite: 0.15,
  // 3 breakpoints -> 4 height categories (bare / . / w / W)
  heightThresholds: [0.15, 0.45, 0.75] as const,
  colorBuckets: 8,
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

  // 多産多死: short-lived on purpose. At 2000 ticks (1000s) old age never
  // actually fired, so starvation was the only source of death and a
  // population that found even scraps of food just sat there indefinitely.
  // At 200 ticks (100s / ~10 epochs) the herd needs constant reproduction to
  // hold its numbers -- once food gets scarce enough that reproduction stops
  // keeping up, aging alone thins the herd fast.
  lifespanTicks: 200,
  visionRadius: 3,
};
