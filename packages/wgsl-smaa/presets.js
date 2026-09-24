/**
 * @typedef {object} SMAAPreset
 * @property {Object<string, number>} edges
 * @property {Object<string, number>} weights
 */

/**
 * @typedef {object} SMAAPresets
 * @property {SMAAPreset} low
 * @property {SMAAPreset} medium
 * @property {SMAAPreset} high
 * @property {SMAAPreset} ultra
 */

/**
 * The reference's quality presets, as override constants for the edges and
 * weights pass modules. Low and medium disable diagonal and corner detection.
 *
 * @type {SMAAPresets}
 */
const PRESETS = {
  low: {
    edges: { SMAA_THRESHOLD: 0.15 },
    weights: {
      SMAA_MAX_SEARCH_STEPS: 4,
      SMAA_DISABLE_DIAG_DETECTION: 1,
      SMAA_DISABLE_CORNER_DETECTION: 1,
    },
  },
  medium: {
    edges: { SMAA_THRESHOLD: 0.1 },
    weights: {
      SMAA_MAX_SEARCH_STEPS: 8,
      SMAA_DISABLE_DIAG_DETECTION: 1,
      SMAA_DISABLE_CORNER_DETECTION: 1,
    },
  },
  high: {
    edges: { SMAA_THRESHOLD: 0.1 },
    weights: {
      SMAA_MAX_SEARCH_STEPS: 16,
      SMAA_MAX_SEARCH_STEPS_DIAG: 8,
      SMAA_CORNER_ROUNDING: 25,
    },
  },
  ultra: {
    edges: { SMAA_THRESHOLD: 0.05 },
    weights: {
      SMAA_MAX_SEARCH_STEPS: 32,
      SMAA_MAX_SEARCH_STEPS_DIAG: 16,
      SMAA_CORNER_ROUNDING: 25,
    },
  },
};

export default PRESETS;
