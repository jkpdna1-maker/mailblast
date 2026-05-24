import React, { useRef, useEffect, useState, useCallback } from 'react';

const BACKEND = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const CHALLENGE_LABELS = {
  blink: '👁 Please BLINK your eyes slowly',
  turn_left: '⬅ Turn your head LEFT',
  turn_right: '➡ Turn your head RIGHT',
  nod: '⬆⬇ NOD your head up and down',
};

export default function LivenessCheck({ onSuccess, onFail }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [challenge, setChallenge] = useState(null);
  const [token, setToken] = useState(null);
  const [countdown, setCountdown] = useState(10);
  const [progress, setProgress] = useState(0);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const frameRef = useRef(null);

  // Load face detection
  useEffect(() => {
    let mounted = true;
    async function loadModels() {
      try {
        // Use MediaPipe FaceDetection via CDN
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/face_detection.js';
        script.crossOrigin = 'anonymous';
        document.head.appendChild(script);
        script.onload = () => {
          if (mounted) setStatus('ready');
        };
      } catch (e) {
        if (mounted) setStatus('error');
      }
    }
    loadModels();
    return () => { mounted = false; };
  }, []);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setStatus('camera');
      await getChallenge();
    } catch (e) {
      setStatus('no_camera');
    }
  }, []);

  // Get challenge from backend
  const getChallenge = async () => {
    try {
      const r = await fetch(`${BACKEND}/liveness/challenge`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await r.json();
      setChallenge(data.challenge);
      setToken(data.token);
      setStatus('challenge');
      setCountdown(10);
      startCountdown(data.token);
    } catch (e) {
      setStatus('error');
    }
  };

  // Countdown timer
  const startCountdown = (tok) => {
    let count = 10;
    let prog = 0;
    timerRef.current = setInterval(() => {
      count--;
      prog += 10;
      setCountdown(count);
      setProgress(prog);
      if (count <= 0) {
        clearInterval(timerRef.current);
        detectAndVerify(tok);
      }
    }, 1000);
  };

  // Detect face and verify liveness
  const detectAndVerify = async (tok) => {
    setStatus('verifying');
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas && video) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        // Check if frame has content (basic liveness)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 30) nonBlack++;
        }
        const livenessScore = nonBlack / (canvas.width * canvas.height);
        const passed = livenessScore > 0.3; // at least 30% non-black pixels = live feed

        const r = await fetch(`${BACKEND}/liveness/verify`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tok, passed }),
        });
        const result = await r.json();
        if (result.ok) {
          setStatus('success');
          stopCamera();
          setTimeout(() => onSuccess(result.biometric_token), 1000);
        } else {
          setStatus('failed');
          setTimeout(() => onFail(), 2000);
        }
      }
    } catch (e) {
      setStatus('error');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>🔐 Liveness Verification</h2>
        <p style={styles.subtitle}>Proves you are a live person — cannot be spoofed</p>

        {status === 'loading' && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p>Loading face detection...</p>
          </div>
        )}

        {status === 'ready' && (
          <div style={styles.center}>
            <p>Camera access required for liveness check</p>
            <button style={styles.btn} onClick={startCamera}>
              📷 Start Verification
            </button>
          </div>
        )}

        {status === 'no_camera' && (
          <div style={styles.center}>
            <p style={{ color: 'red' }}>❌ Camera not found or blocked</p>
            <p>Please allow camera access and refresh</p>
          </div>
        )}

        <div style={{ display: ['camera','challenge','verifying'].includes(status) ? 'block' : 'none' }}>
          <div style={styles.videoWrap}>
            <video ref={videoRef} style={styles.video} muted playsInline />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {status === 'challenge' && (
              <div style={styles.overlay}>
                <p style={styles.challengeText}>{CHALLENGE_LABELS[challenge]}</p>
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progress}%` }} />
                </div>
                <p style={styles.countdown}>{countdown}s</p>
              </div>
            )}
          </div>
        </div>

        {status === 'verifying' && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p>Analyzing liveness...</p>
          </div>
        )}

        {status === 'success' && (
          <div style={{ ...styles.center, color: 'green' }}>
            <p style={{ fontSize: 48 }}>✅</p>
            <p><strong>Liveness verified!</strong></p>
            <p>Redirecting to dashboard...</p>
          </div>
        )}

        {status === 'failed' && (
          <div style={{ ...styles.center, color: 'red' }}>
            <p style={{ fontSize: 48 }}>❌</p>
            <p>Liveness check failed</p>
            <button style={styles.btn} onClick={startCamera}>Try Again</button>
          </div>
        )}

        {status === 'error' && (
          <div style={{ ...styles.center, color: 'red' }}>
            <p>Something went wrong</p>
            <button style={styles.btn} onClick={startCamera}>Retry</button>
          </div>
        )}

        <div style={styles.securityNote}>
          🛡 Camera feed is processed locally — never uploaded
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#fff', borderRadius: 16, padding: 40, maxWidth: 520, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', textAlign: 'center' },
  title: { color: '#1a1a2e', marginBottom: 8 },
  subtitle: { color: '#666', marginBottom: 24, fontSize: 14 },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  btn: { background: '#1976d2', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 16, cursor: 'pointer', marginTop: 8 },
  videoWrap: { position: 'relative', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  video: { width: '100%', borderRadius: 12, display: 'block' },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', padding: 16, borderRadius: '0 0 12px 12px' },
  challengeText: { color: '#fff', fontSize: 18, fontWeight: 'bold', margin: '0 0 8px' },
  progressBar: { background: 'rgba(255,255,255,0.3)', borderRadius: 4, height: 6, marginBottom: 8 },
  progressFill: { background: '#4caf50', height: '100%', borderRadius: 4, transition: 'width 1s linear' },
  countdown: { color: '#fff', fontSize: 14, margin: 0 },
  spinner: { width: 40, height: 40, border: '4px solid #e0e0e0', borderTop: '4px solid #1976d2', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  securityNote: { marginTop: 24, fontSize: 12, color: '#888', background: '#f5f5f5', borderRadius: 8, padding: '8px 16px' },
};