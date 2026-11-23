(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const intro = document.getElementById('intro');
  const toastEl = document.getElementById('toast');
  const hintEl = document.getElementById('hint');
  const statusEl = document.getElementById('status');
  const sensInput = document.getElementById('sens');
  const sensVal = document.getElementById('sens-val');
  const pauseBtn = document.getElementById('pause');
  const calBtn = document.getElementById('cal');
  const fsBtn = document.getElementById('fs');
  const breathBtn = document.getElementById('breath');

  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6v12M15 6v12"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><path d="M8 5.5 19 12 8 18.5z"/></svg>';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const state = {
    sens: 1,
    breathing: true,
    running: true,
    clock: 0,
    sensorReady: false,
    sensorTried: false,
    cal: { ax: 0, ay: 0, gamma: 0 }
  };

  const sensor = {
    ax: 0, ay: 0, gamma: 0,
    seen: false,
    autoCal: true,
    calCount: 0,
    calSum: { ax: 0, ay: 0, gamma: 0 }
  };
  const smooth = { x: 0, y: 0, roll: 0 };
  let W = 0;
  let H = 0;
  let dots = [];

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.toggle('on', kind === 'on');
    statusEl.classList.toggle('off', kind === 'off');
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = Array.from({ length: 72 }, () => ({
      x: (Math.random() - 0.5) * W * 2,
      y: (Math.random() - 0.5) * H * 1.9,
      r: 0.6 + Math.random() * 1.5,
      a: 0.025 + Math.random() * 0.075,
      p: Math.random() * Math.PI * 2
    }));
  }
  window.addEventListener('resize', resize);
  resize();

  function sampleCalibration() {
    if (!sensor.autoCal) return;
    sensor.calSum.ax += sensor.ax;
    sensor.calSum.ay += sensor.ay;
    sensor.calSum.gamma += sensor.gamma;
    sensor.calCount += 1;
    if (sensor.calCount >= 12) {
      state.cal = {
        ax: sensor.calSum.ax / sensor.calCount,
        ay: sensor.calSum.ay / sensor.calCount,
        gamma: sensor.calSum.gamma / sensor.calCount
      };
      sensor.autoCal = false;
    }
  }

  function onMotion(e) {
    sensor.seen = true;
    const lin = e.acceleration;
    if (lin && (typeof lin.x === 'number' || typeof lin.y === 'number')) {
      sensor.ax = lin.x || 0;
      sensor.ay = lin.y || 0;
    } else {
      const g = e.accelerationIncludingGravity;
      if (g) {
        sensor.ax = g.x || 0;
        sensor.ay = g.y || 0;
      }
    }
    sampleCalibration();
  }

  function onOrientation(e) {
    if (typeof e.gamma === 'number') {
      sensor.seen = true;
      sensor.gamma = e.gamma;
      sampleCalibration();
    }
  }

  async function enableSensor() {
    if (state.sensorTried) return state.sensorReady;
    state.sensorTried = true;
    try {
      if (typeof DeviceMotionEvent === 'undefined' && typeof DeviceOrientationEvent === 'undefined') {
        throw new Error('unsupported');
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const result = await DeviceMotionEvent.requestPermission();
        if (result !== 'granted') throw new Error('motion denied');
      }
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') throw new Error('orientation denied');
      }
      window.addEventListener('devicemotion', onMotion);
      window.addEventListener('deviceorientation', onOrientation);
      sensor.autoCal = true;
      sensor.calCount = 0;
      sensor.calSum = { ax: 0, ay: 0, gamma: 0 };
      state.sensorReady = true;
      calBtn.disabled = false;
      setStatus('感应中', 'on');
      toast('感应已开启 · 正在自动校准零点');
      // 部分设备声明了接口却不派发事件，提示用户改用支持传感器的手机
      setTimeout(() => {
        if (!sensor.seen) {
          setStatus('未检测到传感器', 'off');
          toast('未收到运动数据，请用带传感器的手机打开');
        }
      }, 2200);
      return true;
    } catch (err) {
      setStatus('设备不支持', 'off');
      toast('当前设备无法读取传感器，请在手机浏览器打开');
      return false;
    }
  }

  function drawReference(cx, cy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 108, 150, 0.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 126, 0, Math.PI * 2);
    ctx.stroke();
    const tick = (x, y, dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(cx + x, cy + y);
      ctx.lineTo(cx + x + dx, cy + y + dy);
      ctx.stroke();
    };
    tick(0, -136, 0, 10);
    tick(0, 136, 0, -10);
    tick(-136, 0, 10, 0);
    tick(136, 0, -10, 0);
    ctx.restore();
  }

  function drawMotionField(cx, cy, t) {
    ctx.save();
    ctx.translate(cx + smooth.x * 0.55, cy + smooth.y * 0.55);
    ctx.rotate(smooth.roll * Math.PI / 180);

    const g = ctx.createLinearGradient(-W, 0, W, 0);
    g.addColorStop(0, 'rgba(85, 115, 160, 0)');
    g.addColorStop(0.5, 'rgba(85, 115, 160, 0.20)');
    g.addColorStop(1, 'rgba(85, 115, 160, 0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-W, 0);
    ctx.lineTo(W, 0);
    ctx.stroke();

    for (const d of dots) {
      const dx = d.x + smooth.x * 0.32;
      const dy = d.y + smooth.y * 0.32;
      ctx.fillStyle = `rgba(72, 102, 148, ${d.a})`;
      ctx.beginPath();
      ctx.arc(dx, dy, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOrb(cx, cy) {
    const ox = cx + smooth.x;
    const oy = cy + smooth.y;
    const glowR = 96;

    const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, glowR);
    glow.addColorStop(0, 'rgba(77, 124, 245, 0.20)');
    glow.addColorStop(0.45, 'rgba(77, 124, 245, 0.07)');
    glow.addColorStop(1, 'rgba(77, 124, 245, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ox, oy, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(77, 124, 245, 0.14)';
    ctx.beginPath();
    ctx.arc(ox, oy, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4d7cf5';
    ctx.beginPath();
    ctx.arc(ox, oy, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(ox - 2, oy - 2.4, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (state.breathing) {
      // 6 秒一轮 = 每分钟 10 次呼吸，接近自然放松呼吸
      const angle = state.clock * Math.PI / 3 - Math.PI / 2;
      const phase = (Math.sin(angle) + 1) / 2;
      const r = 44 + phase * 18;
      ctx.strokeStyle = `rgba(77, 124, 245, ${0.30 - phase * 0.16})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(90, 110, 145, 0.55)';
      ctx.font = '500 11px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.cos(angle) >= 0 ? '吸 气' : '呼 气', ox, oy + 68);
    }
  }

  // 传感器轴向是设备坐标系，横屏时需要换算成屏幕坐标系
  function toScreenAxes(ax, ay) {
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    switch (angle) {
      case 90: return { x: -ay, y: ax };
      case 180: return { x: -ax, y: -ay };
      case 270:
      case -90: return { x: ay, y: -ax };
      default: return { x: ax, y: ay };
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (state.running) state.clock += dt;
    const t = state.clock;

    let ax = 0;
    let ay = 0;
    let roll = 0;
    if (state.sensorReady) {
      const p = toScreenAxes(sensor.ax - state.cal.ax, sensor.ay - state.cal.ay);
      ax = p.x;
      ay = p.y;
      const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      roll = (sensor.gamma - state.cal.gamma) * (angle === 180 ? -1 : 1);
    }

    const k = state.running ? 1 - Math.pow(0.002, dt) : 0;
    smooth.x += (clamp(ax * state.sens * 16, -W * 0.17, W * 0.17) - smooth.x) * k;
    smooth.y += (clamp(ay * state.sens * 16, -H * 0.13, H * 0.13) - smooth.y) * k;
    smooth.roll += (clamp(roll * state.sens * 0.8, -14, 14) - smooth.roll) * k;

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    drawReference(cx, cy);
    drawMotionField(cx, cy, t);
    drawOrb(cx, cy);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function updateHint() {
    hintEl.textContent = state.breathing
      ? '视线轻落光点 · 跟随呼吸，让感官慢慢对齐'
      : '视线轻落光点 · 让视觉与身体的晃动保持一致';
  }

  sensInput.addEventListener('input', () => {
    state.sens = parseFloat(sensInput.value);
    sensVal.textContent = state.sens.toFixed(1) + '×';
  });

  pauseBtn.addEventListener('click', () => {
    state.running = !state.running;
    pauseBtn.innerHTML = state.running ? ICON_PAUSE : ICON_PLAY;
    pauseBtn.setAttribute('aria-label', state.running ? '暂停' : '继续');
  });

  breathBtn.addEventListener('click', () => {
    state.breathing = !state.breathing;
    breathBtn.classList.toggle('off', !state.breathing);
    updateHint();
  });

  calBtn.addEventListener('click', () => {
    state.cal = { ax: sensor.ax, ay: sensor.ay, gamma: sensor.gamma };
    sensor.autoCal = false;
    toast('已重新校准零点');
  });

  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('当前浏览器不支持全屏'));
      else toast('当前浏览器不支持全屏');
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && intro.classList.contains('hidden')) {
      e.preventDefault();
      pauseBtn.click();
    }
  });

  let hideTimer;
  function showUI() {
    document.body.classList.remove('idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (intro.classList.contains('hidden')) document.body.classList.add('idle');
    }, 4200);
  }
  window.addEventListener('pointermove', showUI, { passive: true });
  window.addEventListener('touchstart', showUI, { passive: true });
  showUI();

  function closeIntro() {
    intro.classList.add('hidden');
    showUI();
  }
  document.getElementById('start-sensor').addEventListener('click', () => {
    closeIntro();
    enableSensor();
  });
})();
