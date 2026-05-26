import React, { useRef, useEffect, useState, useCallback } from 'react';
const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const FACEAPI_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
const MODELS_URL = '/models';

export default function LivenessCheck({ onSuccess, onFail }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const blinkFrames = useRef([]);

  const [status, setStatus] = useState('loading');   // loading|ready|camera|enrolling|blinking|verifying|success|failed|locked|error
  const [message, setMessage] = useState('Loading face detection models...');
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [faceapiLoaded, setFaceapiLoaded] = useState(false);
  const cameraStarting = useRef(false);

  // ── Load face-api.js + models ──────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        // Inject face-api.js script
        if (!window.faceapi) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = FACEAPI_CDN;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const faceapi = window.faceapi;
        setMessage('Loading face models...');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
        ]);
        if (!mounted) return;
        setFaceapiLoaded(true);

        
        // Check if locked
        const lockRes = await fetch(`${BACKEND}/liveness/lock-status`, { credentials: 'include' });
        if (lockRes.ok) {
          const lockData = await lockRes.json();
          if (lockData.locked) { setStatus('locked'); return; }
        }

        // Check if enrolled — default to enrolling if 401
        const enrollRes = await fetch(`${BACKEND}/liveness/enrolled`, { credentials: 'include' });
        const enrollData = enrollRes.ok ? await enrollRes.json() : { enrolled: false };
        setIsEnrolling(!enrollData.enrolled);
        setStatus('ready');
        setMessage(enrollData.enrolled
          ? 'Face recognition ready. Look at the camera.'
          : 'First time setup: we need to scan your face.'
        );
      } catch (e) {
        console.error('[LivenessCheck] Load error:', e);
        if (mounted) { setStatus('error'); setMessage('Failed to load face models. Check internet connection.'); }
      }
    }
    load();
    return () => { mounted = false; stopCamera(); };
  }, []);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (streamRef.current || cameraStarting.current) return;
    cameraStarting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('camera');
        setMessage('Position your face in the frame...');
        setTimeout(() => beginVerification(), 3000);
      }
    } catch (e) {
      console.error('[Camera]', e);
      cameraStarting.current = false;
      setStatus('error');
      setMessage(e.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access.'
        : 'Camera not found or unavailable.'
      );
    }
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    cameraStarting.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // ── Blink detection via EAR (Eye Aspect Ratio) ─────────────────────────────
  function getEAR(eye) {
    // eye = array of 6 {x,y} points
    const A = dist(eye[1], eye[5]);
    const B = dist(eye[2], eye[4]);
    const C = dist(eye[0], eye[3]);
    return (A + B) / (2.0 * C);
  }
  function dist(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }

  // ── Main verification flow ─────────────────────────────────────────────────
  const beginVerification = useCallback(async () => {
    const faceapi = window.faceapi;
    if (!faceapi || !videoRef.current) return;

    if (isEnrolling) {
      setStatus('enrolling');
      setMessage('Hold still — capturing your face...');
      await captureAndEnroll(faceapi);
    } else {
      setStatus('blinking');
      setMessage('👁 Please BLINK slowly 2–3 times');
      blinkFrames.current = [];
      await detectBlinkAndVerify(faceapi);
    }
  }, [isEnrolling]);

  // ── Enrollment: capture face + eye descriptors ─────────────────────────────
  const captureAndEnroll = async (faceapi) => {
    try {
      let attempts = 0;
      let detection = null;

      // Try up to 10 times to get a clear detection
      while (attempts < 10 && !detection) {
        await sleep(500);
        detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        attempts++;
      }

      console.log('[enroll] attempts done, detection:', detection);
      if (!detection) {
        setStatus('error');
        setMessage('No face detected. Make sure your face is clearly visible.');
        return;
      }

      const landmarks = detection.landmarks;
      const leftEyePts = landmarks.getLeftEye();
      const rightEyePts = landmarks.getRightEye();

      // Get canvas region for each eye
      const leftEyeDesc = await getEyeDescriptor(faceapi, leftEyePts);
      const rightEyeDesc = await getEyeDescriptor(faceapi, rightEyePts);

      setMessage('Saving your face data...');
      const res = await fetch(`${BACKEND}/liveness/enroll`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          face_descriptor: Array.from(detection.descriptor),
          eye_left_descriptor: leftEyeDesc,
          eye_right_descriptor: rightEyeDesc,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('success');
        setMessage('✅ Face enrolled! You can now log in with your face.');
        stopCamera();
        setTimeout(() => {
          setIsEnrolling(false);
          setStatus('ready');
          setMessage('Enrollment complete. Click to log in with your face.');
        }, 2000);
      } else {
        setStatus('error');
        setMessage(data.error || 'Enrollment failed.');
      }
    } catch (e) {
      console.error('[Enroll]', e);
      setStatus('error');
      setMessage('Enrollment error. Please try again.');
    }
  };

  // ── Blink + face verify ────────────────────────────────────────────────────
  const detectBlinkAndVerify = async (faceapi) => {
    const EAR_THRESHOLD = 0.22;
    const BLINK_FRAMES = 3;
    let blinkCount = 0;
    let eyesClosed = false;
    let frames = 0;
    let faceSnapshot = null;
    let leftEyeSnapshot = null;
    let rightEyeSnapshot = null;
    const maxFrames = 150; // ~15 seconds at ~10fps

    setCountdown(15);
    let tick = 15;
    timerRef.current = setInterval(() => {
      tick--;
      setCountdown(tick);
      setProgress(((15 - tick) / 15) * 100);
      if (tick <= 0) clearInterval(timerRef.current);
    }, 1000);

    while (frames < maxFrames && blinkCount < 2) {
      await sleep(100);
      frames++;
      try {
        const detection = await faceapi
          .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) continue;

        // Store best face snapshot
        if (!faceSnapshot || detection.detection.score > 0.7) {
          faceSnapshot = Array.from(detection.descriptor);
          const lm = detection.landmarks;
          leftEyeSnapshot = lm.getLeftEye();
          rightEyeSnapshot = lm.getRightEye();
        }

        const lm = detection.landmarks;
        const leftEAR = getEAR(lm.getLeftEye());
        const rightEAR = getEAR(lm.getRightEye());
        const avgEAR = (leftEAR + rightEAR) / 2;

        if (avgEAR < EAR_THRESHOLD) {
          if (!eyesClosed) {
            eyesClosed = true;
          }
        } else {
          if (eyesClosed) {
            blinkCount++;
            eyesClosed = false;
            setMessage(`👁 Blink detected! ${blinkCount}/2`);
          }
        }
      } catch (e) {
        // continue on frame error
      }
    }

    clearInterval(timerRef.current);

    if (!faceSnapshot) {
      handleFail('No face detected. Try better lighting.');
      return;
    }

    const blinkDetected = blinkCount >= 1;
    if (!blinkDetected) {
      handleFail('No blink detected. Please blink naturally.');
      return;
    }

    // Get eye descriptors from snapshot points
    const leftEyeDesc = leftEyeSnapshot ? ptsToArray(leftEyeSnapshot) : null;
    const rightEyeDesc = rightEyeSnapshot ? ptsToArray(rightEyeSnapshot) : null;

    setStatus('verifying');
    setMessage('Matching your face...');

    try {
      // Get challenge token
      const chalRes = await fetch(`${BACKEND}/liveness/challenge`, {
        method: 'POST',
        credentials: 'include',
      });
      const { token } = await chalRes.json();

      const verRes = await fetch(`${BACKEND}/liveness/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          face_descriptor: faceSnapshot,
          eye_left_descriptor: leftEyeDesc,
          eye_right_descriptor: rightEyeDesc,
          blink_detected: blinkDetected,
        }),
      });
      const result = await verRes.json();

      if (result.ok) {
        setStatus('success');
        setMessage('✅ Identity verified! Marking attendance...');
        stopCamera();
        setTimeout(() => onSuccess(result.biometric_token), 1200);
      } else if (result.locked) {
        setStatus('locked');
        setMessage('🔒 System locked. Alert sent to admin email.');
        stopCamera();
      } else {
        setFailedAttempts(result.failed_attempts || 0);
        handleFail(
          result.remaining
            ? `Face not recognized. ${result.remaining} attempt(s) remaining.`
            : result.error
        );
      }
    } catch (e) {
      console.error('[Verify]', e);
      setStatus('error');
      setMessage('Verification error. Check connection.');
    }
  };

  const handleFail = (msg) => {
    setStatus('failed');
    setMessage(msg || 'Liveness check failed.');
    stopCamera();
    if (onFail) setTimeout(onFail, 3000);
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ptsToArray = pts => pts.map(p => [p.x, p.y]).flat();

  const getEyeDescriptor = async (faceapi, eyePts) => {
    // Use landmark points as a simple descriptor
    return ptsToArray(eyePts);
  };

  // ── Retry ──────────────────────────────────────────────────────────────────
  const retry = () => {
    stopCamera();
    blinkFrames.current = [];
    setProgress(0);
    setCountdown(15);
    setMessage('Position your face in the frame...');
    setTimeout(() => startCamera(), 500);
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const s = {
    wrap: { minHeight: '100vh', background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
    card: { background: '#fff', borderRadius: 20, padding: '36px 32px', maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' },
    title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 },
    sub: { fontSize: 13, color: '#666', marginBottom: 24 },
    msg: { fontSize: 15, color: '#333', margin: '16px 0', minHeight: 24 },
    btn: { background: '#1976d2', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 32px', fontSize: 16, cursor: 'pointer', marginTop: 16, width: '100%' },
    videoWrap: { position: 'relative', borderRadius: 14, overflow: 'hidden', marginBottom: 12, background: '#000' },
    video: { width: '100%', display: 'block', borderRadius: 14, transform: 'scaleX(-1)' },
    overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.65)', padding: 14, borderRadius: '0 0 14px 14px' },
    progressBg: { background: 'rgba(255,255,255,0.25)', borderRadius: 4, height: 6, marginBottom: 6 },
    progressFill: { background: '#4caf50', height: '100%', borderRadius: 4, transition: 'width 0.5s linear' },
    spinner: { width: 44, height: 44, border: '4px solid #e0e0e0', borderTop: '4px solid #1976d2', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '20px auto' },
    badge: (color) => ({ display: 'inline-block', background: color, borderRadius: 20, padding: '4px 14px', fontSize: 13, color: '#fff', marginBottom: 12 }),
    note: { fontSize: 12, color: '#aaa', marginTop: 20, background: '#f9f9f9', borderRadius: 8, padding: '8px 14px' },
  };

  const showCamera = ['camera', 'enrolling', 'blinking', 'verifying'].includes(status);

  return (
    <div style={s.wrap}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={s.card}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>
          {status === 'success' ? '✅' : status === 'locked' ? '🔒' : status === 'failed' ? '❌' : '🔐'}
        </div>
        <div style={s.title}>
          {isEnrolling ? 'Face Enrollment' : 'Identity Verification'}
        </div>
        <div style={s.sub}>
          {isEnrolling ? 'One-time setup — your face data stays secure' : 'Face + eye + blink required to login'}
        </div>

        {/* Status badge */}
        {failedAttempts > 0 && status !== 'locked' && (
          <div style={s.badge('#e53935')}>
            {failedAttempts}/3 failed attempts
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <>
            <div style={s.spinner} />
            <div style={s.msg}>{message}</div>
          </>
        )}

        {/* Ready */}
        {status === 'ready' && (
          <>
            <div style={s.msg}>{message}</div>
            <button style={s.btn} onClick={startCamera}>
              {isEnrolling ? '📷 Start Face Enrollment' : '📷 Start Face Scan'}
            </button>
          </>
        )}

        {/* Camera + overlay */}
        {showCamera && (
          <div style={s.videoWrap}>
            <video ref={videoRef} style={s.video} muted playsInline />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {status === 'blinking' && (
              <div style={s.overlay}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  👁 Blink slowly 2 times
                </div>
                <div style={s.progressBg}>
                  <div style={{ ...s.progressFill, width: `${progress}%` }} />
                </div>
                <div style={{ color: '#ccc', fontSize: 13 }}>{countdown}s remaining</div>
              </div>
            )}
            {(status === 'enrolling' || status === 'verifying') && (
              <div style={s.overlay}>
                <div style={{ color: '#fff', fontSize: 15 }}>{message}</div>
              </div>
            )}
          </div>
        )}

        {/* Verifying spinner */}
        {status === 'verifying' && (
          <>
            <div style={s.spinner} />
            <div style={s.msg}>Matching your face...</div>
          </>
        )}

        {/* Success */}
        {status === 'success' && (
          <div style={{ color: '#2e7d32', fontSize: 16 }}>{message}</div>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <>
            <div style={{ color: '#c62828', fontSize: 15, margin: '12px 0' }}>{message}</div>
            <button style={{ ...s.btn, background: '#e53935' }} onClick={retry}>
              Try Again
            </button>
          </>
        )}

        {/* Locked */}
        {status === 'locked' && (
          <div style={{ color: '#b71c1c', fontSize: 15, lineHeight: 1.6 }}>
            <strong>System locked after 3 failed face scans.</strong>
            <br />An alert has been sent to your admin email.
            <br /><br />
            <span style={{ fontSize: 13, color: '#888' }}>
              All scheduled campaigns continue running in the background.
            </span>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div style={{ color: '#c62828', margin: '12px 0' }}>{message}</div>
            <button style={s.btn} onClick={retry}>Retry</button>
          </>
        )}

        <div style={s.note}>
          🛡 Face data is encrypted and stored only on your server. Never shared.
        </div>
      </div>
    </div>
  );
}
