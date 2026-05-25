// Focus indicator — subtle border on the focused split.
// Uses iFocus (1.0 = focused, 0.0 = unfocused) so unfocused panes are untouched.

// --- CONFIGURATION ---
const vec3  ACCENT       = vec3(0.45, 0.7, 1.0); // border color
const float BORDER_W     = 2.0;                   // border thickness in pixels
const float BORDER_ALPHA = 0.5;                   // 0.0 = invisible, 1.0 = solid
const float BLUR         = 1.0;                   // antialiasing softness

void mainImage(out vec4 o, vec2 u) {
    vec2 uv = u / iResolution.xy;
    o = texture(iChannel0, uv);
    if (iFocus < 0.5) return;

    vec2 R = iResolution.xy;
    float edge = min(min(u.x, u.y), min(R.x - u.x, R.y - u.y));
    float border = 1.0 - smoothstep(BORDER_W - 0.5, BORDER_W + 0.5, edge);
    o.rgb = mix(o.rgb, ACCENT, border * BORDER_ALPHA);
}
