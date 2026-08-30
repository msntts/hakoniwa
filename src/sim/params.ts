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
  lifespanTicks: 2000,
  visionRadius: 3,
};
