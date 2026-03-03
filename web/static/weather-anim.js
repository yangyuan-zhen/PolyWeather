// ──────────────────────────────────────────────────────────
//  Weather Animation Engine
//  Canvas-based particle system for rain, snow, fog, etc.
// ──────────────────────────────────────────────────────────

const WeatherAnim = (() => {
  let canvas, ctx;
  let animId = null;
  let particles = [];
  let currentType = null;
  let lightningTimer = 0;
  let lightningFlash = 0;

  const CONFIGS = {
    rain: {
      count: 120,
      init: (w, h) => ({
        x: Math.random() * w * 1.2 - w * 0.1,
        y: Math.random() * h - h,
        len: 12 + Math.random() * 18,
        speed: 8 + Math.random() * 6,
        opacity: 0.2 + Math.random() * 0.4,
        wind: 2 + Math.random() * 2,
      }),
      draw: (p, ctx) => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.wind * 0.5, p.y + p.len);
        ctx.strokeStyle = `rgba(174, 214, 241, ${p.opacity})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      },
      update: (p, w, h) => {
        p.y += p.speed;
        p.x += p.wind;
        if (p.y > h) {
          p.y = -p.len;
          p.x = Math.random() * w * 1.2 - w * 0.1;
        }
      },
    },

    heavyrain: {
      count: 200,
      init: (w, h) => ({
        x: Math.random() * w * 1.3 - w * 0.15,
        y: Math.random() * h - h,
        len: 18 + Math.random() * 24,
        speed: 12 + Math.random() * 8,
        opacity: 0.3 + Math.random() * 0.5,
        wind: 4 + Math.random() * 3,
      }),
      draw: (p, ctx) => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.wind * 0.6, p.y + p.len);
        ctx.strokeStyle = `rgba(160, 200, 230, ${p.opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      },
      update: (p, w, h) => {
        p.y += p.speed;
        p.x += p.wind;
        if (p.y > h) {
          p.y = -p.len;
          p.x = Math.random() * w * 1.3 - w * 0.15;
        }
      },
    },

    snow: {
      count: 80,
      init: (w, h) => ({
        x: Math.random() * w,
        y: Math.random() * h - h,
        r: 1.5 + Math.random() * 3,
        speed: 0.8 + Math.random() * 1.5,
        opacity: 0.4 + Math.random() * 0.4,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.01 + Math.random() * 0.03,
        wobbleAmp: 0.5 + Math.random() * 1.5,
      }),
      draw: (p, ctx) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.fill();
      },
      update: (p, w, h) => {
        p.y += p.speed;
        p.wobble += p.wobbleSpeed;
        p.x += Math.sin(p.wobble) * p.wobbleAmp;
        if (p.y > h + p.r) {
          p.y = -p.r * 2;
          p.x = Math.random() * w;
        }
      },
    },

    fog: {
      count: 15,
      init: (w, h) => ({
        x: Math.random() * w,
        y: 20 + Math.random() * (h - 40),
        w: 120 + Math.random() * 200,
        h: 30 + Math.random() * 60,
        speed: 0.15 + Math.random() * 0.3,
        opacity: 0.03 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
      }),
      draw: (p, ctx) => {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w / 2);
        const osc = Math.sin(p.phase) * 0.02;
        grad.addColorStop(0, `rgba(200, 210, 230, ${p.opacity + osc})`);
        grad.addColorStop(1, "rgba(200, 210, 230, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      },
      update: (p, w) => {
        p.x += p.speed;
        p.phase += 0.01;
        if (p.x - p.w / 2 > w) {
          p.x = -p.w / 2;
        }
      },
    },

    clear: {
      count: 0,
      init: () => ({}),
      draw: () => {},
      update: () => {},
    },

    cloudy: {
      count: 8,
      init: (w, h) => ({
        x: Math.random() * w,
        y: 10 + Math.random() * 60,
        w: 100 + Math.random() * 160,
        h: 25 + Math.random() * 35,
        speed: 0.1 + Math.random() * 0.15,
        opacity: 0.04 + Math.random() * 0.06,
      }),
      draw: (p, ctx) => {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w / 2);
        grad.addColorStop(0, `rgba(150, 160, 180, ${p.opacity})`);
        grad.addColorStop(1, "rgba(150, 160, 180, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      },
      update: (p, w) => {
        p.x += p.speed;
        if (p.x - p.w / 2 > w) p.x = -p.w / 2;
      },
    },
  };

  function detectWeatherType(data) {
    if (!data || !data.current) return "clear";
    const wx = (data.current.wx_desc || "").toUpperCase();
    const cloud = (data.current.cloud_desc || "").toLowerCase();

    // Priority: precipitation > fog > clouds > clear
    if (wx.includes("TS") || wx.includes("TSRA")) return "storm";
    if (wx.includes("+RA") || wx.includes("+SN")) return "heavyrain";
    if (wx.includes("RA") || wx.includes("DZ") || wx.includes("SHRA"))
      return "rain";
    if (wx.includes("SN") || wx.includes("GR") || wx.includes("GS"))
      return "snow";
    if (wx.includes("FG") || wx.includes("BR") || wx.includes("HZ"))
      return "fog";

    // Cloud-based
    if (cloud.includes("阴天") || cloud.includes("多云")) return "cloudy";

    return "clear";
  }

  function initCanvas() {
    canvas = document.getElementById("weatherCanvas");
    if (!canvas) return false;
    const container = canvas.parentElement;
    canvas.width = container.offsetWidth * window.devicePixelRatio;
    canvas.height = container.offsetHeight * window.devicePixelRatio;
    canvas.style.width = container.offsetWidth + "px";
    canvas.style.height = container.offsetHeight + "px";
    ctx = canvas.getContext("2d");
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    return true;
  }

  function createParticles(type) {
    const config = CONFIGS[type] || CONFIGS.clear;
    const container = canvas.parentElement;
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    particles = [];
    for (let i = 0; i < config.count; i++) {
      particles.push(config.init(w, h));
    }
  }

  function animate() {
    if (!ctx || !canvas) return;
    const container = canvas.parentElement;
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const config = CONFIGS[currentType] || CONFIGS.clear;

    ctx.clearRect(0, 0, w, h);

    // Lightning effect for storms
    if (currentType === "storm") {
      lightningTimer++;
      if (lightningTimer > 120 + Math.random() * 200) {
        lightningFlash = 6;
        lightningTimer = 0;
      }
      if (lightningFlash > 0) {
        const alpha = (lightningFlash / 6) * 0.25;
        ctx.fillStyle = `rgba(200, 220, 255, ${alpha})`;
        ctx.fillRect(0, 0, w, h);
        lightningFlash--;
      }

      // Storm uses heavyrain particles
      const stormConfig = CONFIGS.heavyrain;
      particles.forEach((p) => {
        stormConfig.draw(p, ctx);
        stormConfig.update(p, w, h);
      });
    } else {
      particles.forEach((p) => {
        config.draw(p, ctx);
        config.update(p, w, h);
      });
    }

    animId = requestAnimationFrame(animate);
  }

  function start(data) {
    stop();
    if (!initCanvas()) return;

    const type = detectWeatherType(data);
    currentType = type;

    // Set container CSS class for background gradient
    const container = document.getElementById("weatherAnimContainer");
    container.className = "weather-anim-container active " + type;

    // Storm uses heavyrain particles config
    if (type === "storm") {
      const stormW = container.offsetWidth;
      const stormH = container.offsetHeight;
      particles = [];
      for (let i = 0; i < CONFIGS.heavyrain.count; i++) {
        particles.push(CONFIGS.heavyrain.init(stormW, stormH));
      }
      lightningTimer = 0;
      lightningFlash = 0;
    } else {
      createParticles(type);
    }

    animate();
  }

  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    particles = [];
    currentType = null;
    const container = document.getElementById("weatherAnimContainer");
    if (container) {
      container.className = "weather-anim-container";
    }
  }

  return { start, stop, detectWeatherType };
})();
