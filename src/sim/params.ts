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
  // (see HERBIVORE_PARAMS.excretionRatio / CARCASS_PARAMS below).
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
  // of spreadRate (which needs a neighbor; this doesn't). "Grass dies too":
  // this same fraction is subtracted from the tile's standing biomass, not
  // just added elsewhere as a free top-up -- real turnover, not a fountain.
  // Kept just as small as spreadRate for the same reason: it must stay too
  // weak to prop up a herd that would otherwise starve out.
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

  // A bite isn't instant: for this many ticks *after* the tick it eats on, an
  // individual holds still instead of moving/eating again -- "move" costs
  // its usual 1 tick, "eat" costs 1 (the bite) + this (the pause), so the two
  // actions read as different lengths of screen time instead of blurring
  // into the same walk-and-chomp every tick. Hunger is frozen (not climbing)
  // while resting -- it already ate this cycle, so the pause is the *same*
  // meal's relief spread over more ticks, not a second tick of going hungry.
  // Letting hunger climb here instead was the first attempt, and it broke
  // things: it halves the real relief rate of sustained grazing without
  // changing grazeHungerRelief to compensate, so a constantly-fed individual
  // stalls into a flat 0.05-hunger oscillation instead of ever trending down
  // to reproHungerThreshold -- confirmed by tracing hunger over 20 ticks with
  // unlimited grass. Freezing it instead keeps the same downward trend as
  // before, just at half speed in tick-count.
  restTicksAfterEating: 1,

  // 排泄 (while alive) ties "ate here" to "something can grow here again
  // later" -- on top of the slower, animal-independent senescence trickle
  // (GRASS_PARAMS.senescenceRate). 死骸 (on death) is CARCASS_PARAMS below,
  // shared with carnivores -- a body is a body regardless of species.
  excretionRatio: 0.5, // fraction of each bite returned to the tile as fertility

  // 多産多死 (base of the pyramid): short-lived and quick to breed. At 2000
  // ticks (1000s) old age never actually fired, so starvation was the only
  // source of death and a population that found even scraps of food just
  // sat there indefinitely. At 200 ticks (100s / ~10 epochs) the herd needs
  // constant reproduction to hold its numbers -- once food gets scarce
  // enough that reproduction stops keeping up, aging alone thins it fast.
  lifespanTicks: 200,
  visionRadius: 3,
};

export const CARNIVORE_PARAMS = {
  // Apex predators are naturally far rarer than what they eat -- both the
  // population ceiling and the starting pack are a fraction of the herd's.
  // First pass used 500/15 and, even with a stricter repro bar than a
  // herbivore's, the population exploded to ~390 while crashing the herd to
  // single digits within a couple hundred ticks -- a predator population
  // was outnumbering its prey by 40x, exactly backwards for a pyramid.
  // Capped harder as a backstop while the repro economy below (the real
  // fix) was tightened.
  capacity: 150,
  initialCount: 12,

  // 少産少死, one level further up the pyramid than herbivores: slower
  // metabolism (can go a little longer between meals), a much stricter
  // reproduction bar, and a lifespan several times longer. If a carnivore
  // could breed as readily as a herbivore, or a herbivore as readily as
  // grass regrows, the pyramid ordering the game's whole premise leans on
  // (each level scarcer and slower-turning-over than the one it eats)
  // would just be backwards.
  hungerGainPerTick: 0.04,
  // A successful kill is a satisfying meal, but not enough on its own to
  // fully satiate and immediately qualify for reproduction the way an
  // initial 0.5 did -- that let a single catch nearly always trigger a
  // birth, and with prey initially abundant that ran away almost as fast as
  // the herd itself was booming.
  predationRelief: 0.3,
  starvationHunger: 1.0,
  initialHunger: 0.5,

  // Much stricter than a herbivore's reproHungerThreshold (0.15) and
  // reproHungerCost (0.3) -- several consecutive good catches should be
  // needed to earn one birth, not just one.
  reproHungerThreshold: 0.05,
  reproHungerCost: 0.7,

  // Same pacing device as HERBIVORE_PARAMS.restTicksAfterEating -- a kill
  // freezes the predator in place for this many ticks afterward.
  restTicksAfterEating: 1,

  // 3x a herbivore's 200 ticks -- long-lived, the way an apex predator
  // should be, at the cost of being fragile once its numbers do start
  // declining (a slow-breeding population can't bounce back fast).
  lifespanTicks: 600,
};

export const CARCASS_PARAMS = {
  // Shared by every species -- a body decomposing where it fell is a much
  // bigger nutrient event than daily droppings, regardless of whose body it
  // was. It doesn't dump its fertility instantly -- it stays visible on the
  // tile and decomposes over decayTicks, releasing an even share of
  // fertility each tick. This is the "遅延" (delay) from design.md's causal
  // loop made concrete: death pays off the next growth only once
  // decomposition actually finishes.
  fertility: 0.4,
  decayTicks: 10, // ~5s
};
