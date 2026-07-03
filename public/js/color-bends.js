class ColorBends {
  constructor(container, options = {}) {
    this.container = container;
    this.options = Object.assign({
      rotation: 90,
      speed: 0.2,
      colors: [],
      transparent: true,
      autoRotate: 0,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 1,
      parallax: 0.5,
      noise: 0.15,
      iterations: 1,
      intensity: 1.5,
      bandWidth: 6
    }, options);
    
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.material = null;
    this.geometry = null;
    this.mesh = null;
    this.clock = null;
    this.rafId = null;
    this.pointerTarget = new THREE.Vector2(0, 0);
    this.pointerCurrent = new THREE.Vector2(0, 0);
    this.pointerSmooth = 8;
    this.resizeObserver = null;
    
    this.init();
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    
    const MAX_COLORS = 8;
    const uColorsArray = Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(0, 0, 0));
    
    const fragShader = `
      #define MAX_COLORS ${MAX_COLORS}
      uniform vec2 uCanvas;
      uniform float uTime;
      uniform float uSpeed;
      uniform vec2 uRot;
      uniform int uColorCount;
      uniform vec3 uColors[MAX_COLORS];
      uniform int uTransparent;
      uniform float uScale;
      uniform float uFrequency;
      uniform float uWarpStrength;
      uniform vec2 uPointer; // in NDC [-1,1]
      uniform float uMouseInfluence;
      uniform float uParallax;
      uniform float uNoise;
      uniform int uIterations;
      uniform float uIntensity;
      uniform float uBandWidth;
      varying vec2 vUv;

      void main() {
        float t = uTime * uSpeed;
        vec2 p = vUv * 2.0 - 1.0;
        p += uPointer * uParallax * 0.1;
        vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
        vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
        q /= max(uScale, 0.0001);
        q /= 0.5 + 0.2 * dot(q, q);
        q += 0.2 * cos(t) - 7.56;
        vec2 toward = (uPointer - rp);
        q += toward * uMouseInfluence * 0.2;

        for (int j = 0; j < 5; j++) {
          if (j >= uIterations - 1) break;
          vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
          q += (rr - q) * 0.15;
        }

        vec3 col = vec3(0.0);
        float a = 1.0;

        if (uColorCount > 0) {
          vec2 s = q;
          vec3 sumCol = vec3(0.0);
          float cover = 0.0;
          for (int i = 0; i < MAX_COLORS; ++i) {
                if (i >= uColorCount) break;
                s -= 0.01;
                vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
                float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
                float kBelow = clamp(uWarpStrength, 0.0, 1.0);
                float kMix = pow(kBelow, 0.3); // strong response across 0..1
                float gain = 1.0 + max(uWarpStrength - 1.0, 0.0); // allow >1 to amplify displacement
                vec2 disp = (r - s) * kBelow;
                vec2 warped = s + disp * gain;
                float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
                float m = mix(m0, m1, kMix);
                float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
                sumCol += uColors[i] * w;
                cover = max(cover, w);
          }
          col = clamp(sumCol, 0.0, 1.0);
          a = uTransparent > 0 ? cover : 1.0;
        } else {
            vec2 s = q;
            for (int k = 0; k < 3; ++k) {
                s -= 0.01;
                vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
                float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
                float kBelow = clamp(uWarpStrength, 0.0, 1.0);
                float kMix = pow(kBelow, 0.3);
                float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
                vec2 disp = (r - s) * kBelow;
                vec2 warped = s + disp * gain;
                float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
                float m = mix(m0, m1, kMix);
                col[k] = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
            }
            a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
        }

        col *= uIntensity;

        if (uNoise > 0.0001) {
          float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
          col += (n - 0.5) * uNoise;
          col = clamp(col, 0.0, 1.0);
        }

        vec3 rgb = (uTransparent > 0) ? col * a : col;
        gl_FragColor = vec4(rgb, a);
      }
    `;

    const vertShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader: vertShader,
      fragmentShader: fragShader,
      uniforms: {
        uCanvas: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: this.options.speed },
        uRot: { value: new THREE.Vector2(1, 0) },
        uColorCount: { value: 0 },
        uColors: { value: uColorsArray },
        uTransparent: { value: this.options.transparent ? 1 : 0 },
        uScale: { value: this.options.scale },
        uFrequency: { value: this.options.frequency },
        uWarpStrength: { value: this.options.warpStrength },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uMouseInfluence: { value: this.options.mouseInfluence },
        uParallax: { value: this.options.parallax },
        uNoise: { value: this.options.noise },
        uIterations: { value: this.options.iterations },
        uIntensity: { value: this.options.intensity },
        uBandWidth: { value: this.options.bandWidth }
      },
      premultipliedAlpha: true,
      transparent: true
    });

    this.updateColors();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: true
    });
    
    // Set color space/encoding depending on Three.js support
    if (this.renderer.outputEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, this.options.transparent ? 0 : 1);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '-1';
    this.renderer.domElement.style.pointerEvents = 'none';
    
    this.container.appendChild(this.renderer.domElement);
    this.clock = new THREE.Clock();

    this.handleResize = () => {
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.material.uniforms.uCanvas.value.set(w, h);
    };

    this.handleResize();

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.handleResize);
    }

    this.handlePointerMove = (e) => {
      const rect = this.container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
      const y = -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1);
      this.pointerTarget.set(x, y);
    };
    window.addEventListener('pointermove', this.handlePointerMove);

    const loop = () => {
      const dt = this.clock.getDelta();
      const elapsed = this.clock.elapsedTime;
      this.material.uniforms.uTime.value = elapsed;

      const deg = (this.options.rotation % 360) + this.options.autoRotate * elapsed;
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      this.material.uniforms.uRot.value.set(c, s);

      const cur = this.pointerCurrent;
      const tgt = this.pointerTarget;
      const amt = Math.min(1, dt * this.pointerSmooth);
      cur.lerp(tgt, amt);
      this.material.uniforms.uPointer.value.copy(cur);
      
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  updateColors() {
    const toVec3 = hex => {
      const h = hex.replace('#', '').trim();
      const v =
        h.length === 3
          ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      return new THREE.Vector3(v[0] / 255, v[1] / 255, v[2] / 255);
    };

    const arr = (this.options.colors || []).filter(Boolean).slice(0, 8).map(toVec3);
    for (let i = 0; i < 8; i++) {
      const vec = this.material.uniforms.uColors.value[i];
      if (i < arr.length) vec.copy(arr[i]);
      else vec.set(0, 0, 0);
    }
    this.material.uniforms.uColorCount.value = arr.length;
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointermove', this.handlePointerMove);
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

// Export globally
window.ColorBends = ColorBends;
