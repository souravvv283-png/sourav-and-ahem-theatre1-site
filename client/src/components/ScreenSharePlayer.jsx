/**
 * ScreenSharePlayer.jsx
 * Renders the incoming WebRTC screen share stream.
 *
 * FIX: video element is NOT muted — audio from the sharer must play.
 * FIX: fullscreen button available to ALL users (not just host).
 *
 * Audio autoplay note:
 *   Browsers block autoplay with audio until the user has interacted with the page.
 *   The "Click to enable audio" button handles this edge case gracefully.
 */
import { useEffect, useRef, useState } from 'react';
import styles from './ScreenSharePlayer.module.css';

export default function ScreenSharePlayer({ stream, sharerName }) {
  const videoRef     = useRef(null);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [audioBlocked, setAudioBlocked]   = useState(false);

  // Attach stream to video element whenever stream changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;

    // Try to play — may be blocked by autoplay policy
    video.play().catch((err) => {
      if (err.name === 'NotAllowedError') {
        // Audio blocked by browser — show user a button to unblock
        setAudioBlocked(true);
        // Play without audio as fallback
        video.muted = true;
        video.play().catch(console.error);
      }
    });
  }, [stream]);

  // Track fullscreen changes (user pressing Escape, etc.)
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  function enableAudio() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().catch(console.error);
    setAudioBlocked(false);
  }

  if (!stream) {
    return (
      <div className={styles.waiting}>
        <div className={styles.pulse}>📡</div>
        <p>Connecting to {sharerName || 'screen share'}…</p>
        <p className={styles.hint}>This may take a few seconds</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      {/* FIX: NOT muted — audio must play through */}
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
      />

      {/* Live badge */}
      <div className={styles.live}>● LIVE — {sharerName}</div>

      {/* Audio unblock button (shown only when browser blocks autoplay audio) */}
      {audioBlocked && (
        <button className={styles.audioBtn} onClick={enableAudio}>
          🔊 Click to enable audio
        </button>
      )}

      {/* Fullscreen button — available to ALL users */}
      <button
        className={styles.fsBtn}
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? '⛶' : '⛶'}
        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </button>
    </div>
  );
}
