// TRIPPLE FASION Prototype — app.js
// Uses MediaPipe Pose for real-time landmarks.
// This prototype uses a two-capture approach: FRONT and SIDE,
// and requires the user to input their real height (cm) for scale.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const captureFront = document.getElementById('captureFront');
const captureSide = document.getElementById('captureSide');
const calcBtn = document.getElementById('calcBtn');
const exportBtn = document.getElementById('exportBtn');
const measurementsList = document.getElementById('measurementsList');
const heightInput = document.getElementById('heightInput');

let stream = null;
let videoWidth = 640, videoHeight = 480;
overlay.width = videoWidth; overlay.height = videoHeight;

let latestPose = null;
let frontCapture = null; // {landmarks, imageData}
let sideCapture = null;

let poseDetector = null;

// Utility: distance between normalized pose points -> pixels
function distPixels(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x - b.x) * videoWidth;
  const dy = (a.y - b.y) * videoHeight;
  return Math.hypot(dx, dy);
}

// Convert pixel length to cm using user's height (cm)
function pixelsToCm(pixels, pixelHeight, userHeightCm) {
  // pixelHeight = pixel distance between head and feet in capture
  // scale = userHeightCm / pixelHeight
  if (!pixelHeight || pixelHeight <= 0) return 0;
  const scale = userHeightCm / pixelHeight;
  return pixels * scale;
}

// Circle/ellipse circumference approx (Ramanujan)
function ellipseCircumference(a, b) {
  // a,b are semi-axes (half-widths) in same units
  return Math.PI * (3*(a+b) - Math.sqrt((3*a + b)*(a + 3*b)));
}

function drawLandmarks(landmarks) {
  ctx.clearRect(0,0,overlay.width,overlay.height);
  if (!landmarks) return;
  // draw small circles
  ctx.fillStyle = 'rgba(110,231,183,0.9)';
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  landmarks.forEach((lm) => {
    const x = lm.x * overlay.width;
    const y = lm.y * overlay.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI*2);
    ctx.fill();
  });
}

// MediaPipe Pose setup
const pose = new Pose({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`;
}});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(results => {
  latestPose = results.poseLandmarks || null;
  drawLandmarks(latestPose);
});

// camera start/stop
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "user"}, audio: false});
    video.srcObject = stream;
    await video.play();
    videoWidth = video.videoWidth || 640;
    videoHeight = video.videoHeight || 480;
    overlay.width = videoWidth; overlay.height = videoHeight;
    startProcessing();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    captureFront.disabled = false;
    captureSide.disabled = false;
  } catch (err) {
    alert('Camera error: ' + err.message);
    console.error(err);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  captureFront.disabled = true;
  captureSide.disabled = true;
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

// send frames to Mediapipe
let processing = false;
async function startProcessing() {
  processing = true;
  async function frameLoop() {
    if (!processing) return;
    if (video.readyState >= 2) {
      await pose.send({image: video});
    }
    requestAnimationFrame(frameLoop);
  }
  frameLoop();
}

// Capture helper: snapshot current pose + pixel height (top to ankle)
function captureCurrent(type) {
  if (!latestPose) {
    alert('No pose detected. Make sure full body is visible and try again.');
    return;
  }
  // unify: find top-most and bottom-most landmarks among relevant points
  const yPositions = latestPose.map(l => l.y);
  const minY = Math.min(...yPositions);
  const maxY = Math.max(...yPositions);
  const pixelHeight = (maxY - minY) * videoHeight;

  const data = {
    type,
    landmarks: latestPose.map(l => ({x: l.x, y: l.y, z: l.z, visibility: l.visibility})),
    pixelHeight
  };

  if (type === 'front') {
    frontCapture = data;
    captureFront.textContent = 'FRONT captured ✓';
    captureFront.disabled = true;
  } else {
    sideCapture = data;
    captureSide.textContent = 'SIDE captured ✓';
    captureSide.disabled = true;
  }

  if (frontCapture && sideCapture) {
    calcBtn.disabled = false;
  }
}

captureFront.addEventListener('click', () => captureCurrent('front'));
captureSide.addEventListener('click', () => captureCurrent('side'));

// Measurement calculations
function computeMeasurements() {
  if (!frontCapture || !sideCapture) {
    alert('Please capture both front and side first.');
    return;
  }
  const userH = Number(heightInput.value);
  if (!userH || userH < 100) {
    alert('Enter a realistic height in cm (e.g., 160).');
    return;
  }

  // helper: get landmark by name
  const names = [
    "nose","left_eye_inner","left_eye","left_eye_outer","right_eye_inner","right_eye",
    "right_eye_outer","left_ear","right_ear","mouth_left","mouth_right","left_shoulder",
    "right_shoulder","left_elbow","right_elbow","left_wrist","right_wrist","left_pinky",
    "right_pinky","left_index","right_index","left_thumb","right_thumb","left_hip",
    "right_hip","left_knee","right_knee","left_ankle","right_ankle","left_heel","right_heel",
    "left_foot_index","right_foot_index"
  ];

  function getLM(capture, name) {
    const idx = names.indexOf(name);
    if (idx < 0) return null;
    return capture.landmarks[idx] || null;
  }

  // Pixel widths from front view
  const front = frontCapture;
  const side = sideCapture;

  const frontPixelHeight = front.pixelHeight;
  const sidePixelHeight = side.pixelHeight;

  // shoulder width (acromion to acromion) in pixels front view
  const leftShoulderF = getLM(front, 'left_shoulder');
  const rightShoulderF = getLM(front, 'right_shoulder');
  const shoulderPxFront = distPixels(leftShoulderF, rightShoulderF);

  // hip width (left_hip to right_hip)
  const leftHipF = getLM(front, 'left_hip');
  const rightHipF = getLM(front, 'right_hip');
  const hipPxFront = distPixels(leftHipF, rightHipF);

  // waist estimate: midpoint between hips and shoulders vertically -> compute x-width at that y by interpolating landmarks
  // We'll approximate waist width using positions of left/right hip and linearly adjust toward shoulders.
  const waistPxFront = (() => {
    // use midpoint between left/right hip y and left/right shoulder y to estimate waist y
    if (!leftHipF || !rightHipF || !leftShoulderF || !rightShoulderF) return (hipPxFront);
    const hipY = (leftHipF.y + rightHipF.y) / 2;
    const shoulderY = (leftShoulderF.y + rightShoulderF.y) / 2;
    const waistY = shoulderY * 0.55 + hipY * 0.45; // heuristic: waist is below shoulders, above hips
    // approximate width at waist by linear interpolation between shoulder and hip widths
    const t = (waistY - shoulderY) / (hipY - shoulderY || 1);
    return shoulderPxFront * (1 - t) + hipPxFront * t;
  })();

  // bust width: approximate as shoulder width * 0.9 or use shoulders and chest spacing
  const bustPxFront = shoulderPxFront * 0.9;

  // For depth (front-to-back) use side view widths:
  const leftShoulderS = getLM(side, 'left_shoulder');
  const rightShoulderS = getLM(side, 'right_shoulder');
  // In side view, shoulders map roughly to front/back thickness distance as x-distance between nose/hip in side capture.
  // We'll use distance between nose and mid-hip in side view as "depth" proxy.
  const noseS = getLM(side, 'nose');
  const leftHipS = getLM(side, 'left_hip') || getLM(side, 'right_hip');
  let depthPxShoulder = 0;
  if (noseS && leftHipS) {
    depthPxShoulder = Math.abs((noseS.x - leftHipS.x) * videoWidth); // absolute x difference
  } else {
    depthPxShoulder = shoulderPxFront * 0.4; // fallback heuristic
  }

  // For hips: use side capture distance between belly and mid-back — approximate via nose and hip x diff
  const depthPxHip = depthPxShoulder;

  // Convert pixel widths to cm using front pixelHeight and user height
  const shoulderCm = pixelsToCm(shoulderPxFront, frontPixelHeight, userH);
  const bustWidthCm = pixelsToCm(bustPxFront, frontPixelHeight, userH);
  const waistWidthCm = pixelsToCm(waistPxFront, frontPixelHeight, userH);
  const hipWidthCm = pixelsToCm(hipPxFront, frontPixelHeight, userH);

  // Convert depth (side) pixels to cm using side pixelHeight
  const shoulderDepthCm = pixelsToCm(depthPxShoulder, sidePixelHeight, userH);
  const hipDepthCm = pixelsToCm(depthPxHip, sidePixelHeight, userH);

  // Compute circumferences using ellipse approx: a = half-width, b = half-depth
  const shoulderCirc = ellipseCircumference(shoulderCm/2, shoulderDepthCm/2);
  const bustCirc = ellipseCircumference(bustWidthCm/2, shoulderDepthCm/2);
  const waistCirc = ellipseCircumference(waistWidthCm/2, hipDepthCm/2);
  const hipCirc = ellipseCircumference(hipWidthCm/2, hipDepthCm/2);

  // Arm length: shoulder to wrist (use front capture)
  const leftWristF = getLM(front, 'left_wrist');
  const leftElbowF = getLM(front, 'left_elbow');
  const leftShoulderF2 = leftShoulderF;
  const armPx = distPixels(leftShoulderF2, leftWristF);
  const armCm = pixelsToCm(armPx, frontPixelHeight, userH);

  // Neck circumference: approximate from head width in front capture (nose to left_eye distance scaled)
  const noseF = getLM(front, 'nose');
  const leftEyeF = getLM(front, 'left_eye');
  let neckCm = 0;
  if (noseF && leftEyeF) {
    const neckPx = Math.abs((noseF.x - leftEyeF.x) * videoWidth) * 2.2; // heuristic multiplier
    neckCm = pixelsToCm(neckPx, frontPixelHeight, userH);
  }

  const results = {
    "Shoulder width (cm)": round2(shoulderCm),
    "Shoulder circumference (cm)": round2(shoulderCirc),
    "Bust width (cm)": round2(bustWidthCm),
    "Bust circumference (cm)": round2(bustCirc),
    "Waist width (cm)": round2(waistWidthCm),
    "Waist circumference (cm)": round2(waistCirc),
    "Hip width (cm)": round2(hipWidthCm),
    "Hip circumference (cm)": round2(hipCirc),
    "Upper arm length (cm)": round2(armCm),
    "Neck circumference (cm, est.)": round2(neckCm)
  };

  // show results
  let html = '<table>';
  for (const k in results) {
    html += `<tr><td>${k}</td><td style="text-align:right">${results[k]}</td></tr>`;
  }
  html += '</table>';
  measurementsList.innerHTML = html;

  // enable export
  exportBtn.disabled = false;

  return {results, userH};
}

function round2(x){ return Math.round(x*100)/100; }

calcBtn.addEventListener('click', () => {
  const out = computeMeasurements();
  console.log('Measurements computed', out);
});

// Export CSV
exportBtn.addEventListener('click', () => {
  const obj = computeMeasurements();
  if (!obj) return;
  const rows = Object.entries(obj.results).map(([k,v]) => `${k},${v}`);
  const csv = 'Measurement,Value (cm)\\n' + rows.join('\\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tripple_fasion_measurements.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Safety: disable buttons until camera starts
stopBtn.disabled = true;
captureFront.disabled = true;
captureSide.disabled = true;
calcBtn.disabled = true;
exportBtn.disabled = true;
