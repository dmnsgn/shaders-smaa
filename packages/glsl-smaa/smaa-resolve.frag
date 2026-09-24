precision highp float;

#ifndef SMAA_REPROJECTION
  #define SMAA_REPROJECTION 0
#endif

/**
 * Multiplier for the velocity weighting: the higher, the sooner a moving pixel
 * stops blending with its history.
 *
 * Range: [0, 80]
 */
#ifndef SMAA_REPROJECTION_WEIGHT_SCALE
  #define SMAA_REPROJECTION_WEIGHT_SCALE 30.0
#endif

#ifndef SMAA_DECODE_VELOCITY
  #define SMAA_DECODE_VELOCITY(sample) sample.rg
#endif

uniform sampler2D uCurrentColorTexture;
uniform sampler2D uPreviousColorTexture;

#if SMAA_REPROJECTION
  uniform sampler2D uVelocityTexture;
#endif

varying vec2 vTexCoord0;

void main() {
  #if SMAA_REPROJECTION
    // Velocity is assumed to be calculated for motion blur, so we need to
    // inverse it for reprojection:
    vec2 velocity = -SMAA_DECODE_VELOCITY(texture2D(uVelocityTexture, vTexCoord0)); // PointSampler

    // Fetch current pixel:
    vec4 current = texture2D(uCurrentColorTexture, vTexCoord0); // PointSampler

    // Reproject current coordinates and fetch previous pixel:
    vec4 previous = texture2D(uPreviousColorTexture, vTexCoord0 + velocity); // PointSampler

    // Attenuate the previous pixel if the velocity is different:
    float delta = abs(current.a * current.a - previous.a * previous.a) / 5.0;
    float weight = 0.5 * clamp(1.0 - sqrt(delta) * SMAA_REPROJECTION_WEIGHT_SCALE, 0.0, 1.0);

    // Blend the pixels according to the calculated weight:
    gl_FragColor = mix(current, previous, weight);
  #else
    // Just blend the pixels:
    vec4 current = texture2D(uCurrentColorTexture, vTexCoord0); // PointSampler
    vec4 previous = texture2D(uPreviousColorTexture, vTexCoord0); // PointSampler
    gl_FragColor = mix(current, previous, 0.5);
  #endif
}
