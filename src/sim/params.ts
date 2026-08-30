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
  metabolism: 0.01,
  grazeGain: 0.2,
  grazeBiomassThreshold: 0.1,
  reproThreshold: 0.8,
  reproCost: 0.4,
  initialEnergy: 0.5,
  // 多産多死: short-lived on purpose. At 2000 ticks (1000s) old age never
  // actually fired, so starvation was the only source of death and a
  // population that found even scraps of food just sat there indefinitely.
  // At 200 ticks (100s / ~10 epochs) the herd needs constant reproduction to
  // hold its numbers -- once food gets scarce enough that reproduction stops
  // keeping up, aging alone thins the herd fast.
  lifespanTicks: 200,
  visionRadius: 3,
};
