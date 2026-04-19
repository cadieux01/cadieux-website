export const BREAD_VARIETIES = [
  "Classic Sourdough",
  "Multigrain Loaf",
  "Whole Wheat Sandwich",
  "Seeded Rye",
  "Oat & Honey",
  "Flaxseed Brown",
  "Sprouted Grain",
  "Ancient Grain Blend",
  "High-Protein White",
  "Malted Barley Loaf",
];

export const INGREDIENTS = [
  {
    name: "Whole Wheat",
    descriptor: "Stone-milled, full bran intact",
    arrow: "→",
    side: "left" as const,
  },
  {
    name: "Rolled Oats",
    descriptor: "Beta-glucan rich, slow energy",
    arrow: "←",
    side: "right" as const,
  },
  {
    name: "Flaxseed",
    descriptor: "Omega-3, fibre, and lignans",
    arrow: "→",
    side: "left" as const,
  },
  {
    name: "Sunflower Seeds",
    descriptor: "Vitamin E, healthy fats",
    arrow: "←",
    side: "right" as const,
  },
  {
    name: "Malted Barley",
    descriptor: "Natural sweetness, deep flavour",
    arrow: "↓",
    side: "top" as const,
  },
];
