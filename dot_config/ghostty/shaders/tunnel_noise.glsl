#define T (iTime * 0.6)

float orb(vec3 p) {
    float t = T * 0.1;
    return length(p - vec3(
        sin(sin(t*.2)+t*.4) * 6.,
        1.+sin(sin(t*.5)+t*.2) * 4.,
        12.+T+cos(t*.3)*8.));
}

void mainImage(out vec4 o, vec2 u) {
    // Save UV before coordinate transform
    vec2 uv = u / iResolution.xy;

    float d,a,e,i,s,t = T;
    vec3 p = iResolution;

    u = (u+u-p.xy)/p.y;
    u += vec2(cos(t*.1)*.3, cos(t*.3)*.1);

    for(o*=i; i++<128.;
        d += s = min(.03+.2*abs(s), e=max(.5*e, .01)),
        o += 1./(s+e*3.))
        for(p = vec3(u*d,d+t),
            e = orb(p)-.1,
            p.xy *= mat2(cos(.1*t+p.z/8.+vec4(0,33,11,0))),
            s = 4.-abs(p.y),
            a = .8; a<32.; a+=a)
            p += cos(.7*t+p.yzx)*.2,
            s -= abs(dot(sin(.1*t+p*a), .6+p-p))/a;

    o = tanh(o / 10.0);

    vec4 term = texture(iChannel0, uv);
    o = vec4(term.rgb + o.rgb * 0.08, term.a);
}
