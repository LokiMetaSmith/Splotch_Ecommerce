/**
 * Utility to generate memorable, phonetic friendly order names in adjective-noun format
 * (e.g., "purple-fox", "spicy-cactus", "velvet-otter").
 *
 * Deterministic fallback based on UUID or random selection.
 */

const ADJECTIVES = [
  "amber", "azure", "bold", "brave", "bright", "breezy", "calm", "clever",
  "cosmic", "cozy", "crisp", "dapper", "daring", "eager", "electric", "fancy",
  "fiery", "flying", "frosty", "gentle", "golden", "happy", "hyper", "jolly",
  "keen", "laser", "lively", "lucky", "magic", "merry", "mighty", "neon",
  "nimble", "noble", "peppy", "polar", "proud", "purple", "quick", "quiet",
  "radiant", "rapid", "retro", "ruby", "rust", "shining", "silver", "snappy",
  "solar", "spark", "speedy", "spicy", "stellar", "sunny", "swift", "tidal",
  "turbo", "velvet", "vibrant", "wild", "zippy"
];

const NOUNS = [
  "badger", "bear", "beaver", "bison", "cactus", "comet", "coral", "crane",
  "cricket", "dolphin", "dragon", "eagle", "falcon", "ferret", "finch", "fox",
  "gecko", "hawk", "hedgehog", "heron", "iguana", "jaguar", "lemur", "leopard",
  "lynx", "manta", "marmot", "moose", "orca", "osprey", "otter", "owl",
  "panda", "panther", "parrot", "pelican", "penguin", "phoenix", "puffin",
  "quail", "rabbit", "raccoon", "raven", "robin", "salamander", "seal",
  "sparrow", "squid", "starling", "tiger", "toucan", "turtle", "viper",
  "walrus", "whale", "wolf", "wombat"
];

/**
 * Computes a deterministic integer hash from a string (such as an order UUID).
 * @param {string} str 
 * @returns {number}
 */
function hashString(str) {
  let hash = 0;
  if (!str || typeof str !== "string") return hash;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Generates or derives a friendly order name.
 * @param {string} [seedId] - Optional orderId/UUID to derive a deterministic name.
 * @returns {string} e.g. "purple-fox"
 */
export function generateFriendlyName(seedId) {
  if (seedId && typeof seedId === "string") {
    const cleanSeed = seedId.replace(/-/g, "");
    const h1 = hashString(cleanSeed);
    const h2 = hashString(cleanSeed.split("").reverse().join(""));
    const adj = ADJECTIVES[h1 % ADJECTIVES.length];
    const noun = NOUNS[h2 % NOUNS.length];
    return `${adj}-${noun}`;
  }
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}
