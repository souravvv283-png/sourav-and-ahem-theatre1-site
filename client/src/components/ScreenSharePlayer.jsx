/**
 * ScreenSharePlayer.jsx — v3.1
 *
 * AUDIO FIX — two-pronged approach:
 *
 * Problem 1 (Receiver): Browser autoplay policy silently blocks audio even
 *   on unmuted video elements. Fix: pull audio tracks out of the stream and
 *   feed them through a Web AudioContext which is NOT subject to autoplay
 *   restrictions after the first user gesture on the page.
 *
 * Problem 2 (Sender): Chrome requires user to tick "Share system audio"
 *   checkbox in the screen picker. We can't force this but we show a clear
 *   instruction before the picker opens (handled in Controls/Room).
 *
 * Flow:
 *   stream arrives → split into videoOnlyStream + audio tracks
 *   videoOnlyStream → <video> element (muted, for display)
 *   audio tracks → AudioContext → destination (plays audio without autoplay block)
 *   User clicks "Enable Audio" once → AudioContext.resume() → audio plays
 */
import { useEffect, useRef, useState } from 'react';
import styles from './ScreenSharePlayer.module.css';

export default function ScreenSharePlayer({ stream, sharerName }) {
  const videoRef       = useRef(null);
  const containerRef   = useRef(null);
  const audioCtxRef    = useRef(null);
  const audioSourceRef = useRef(null);

  const [isFullscreen,  setIsFullscreen]  = useState(false);
  const [audioEnabled,  setAudioEnabled]  = useState(false);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);

  // ── Attach stream when it arrives ──────────────────────────────────────────
  useEffect(() => {
    if (!stream) return;

    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    console.log('[audio] stream audio tracks:', audioTracks.map((t) => t.label));
    console.log('[audio] stream video tracks:', videoTracks.map((t) => t.label));

    setHasAudioTrack(audioTracks.length > 0);

    // Attach only video tracks to <video> element — keep it muted to avoid
    // double audio and autoplay issues
    if (videoRef.current) {
      const videoOnly = new MediaStream(videoTracks);
      videoRef.current.srcObject = videoOnly;
      videoRef.current.play().catch(console.error);
    }

    // Route audio tracks through AudioContext
    // AudioContext can play audio after any user gesture on the page —
    // much more permissive than the <video> autoplay policy
    if (audioTracks.length > 0) {
      try {
        const ctx    = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
        source.connect(ctx.destination);

        audioCtxRef.current    = ctx;
        audioSourceRef.current = source;

        // AudioContext starts suspended — resume on first user gesture
        if (ctx.state === 'suspended') {
          // Will be resumed when user clicks "Enable Audio"
          setAudioEnabled(false);
        } else {
          setAudioEnabled(true);
        }
      } catch (err) {
        console.warn('[audio] AudioContext setup failed:', err);
      }
    }

    return () => {
      // Cleanup AudioContext when stream changes or component unmounts
      try {
        audioSourceRef.current?.disconnect();
        audioCtxRef.current?.close();
      } catch (_) {}
    };
  }, [stream]);

  // ── Fullscreen change tracking ──────────────────────────────────────────────
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Enable audio (resumes AudioContext after user gesture) ─────────────────
  function enableAudio() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    ctx.resume().then(() => {
      console.log('[audio] AudioContext resumed, audio playing');
      setAudioEnabled(true);
    }).catch(console.error);
  }

  // ── Fullscreen toggle ───────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  // ── No stream yet ──────────────────────────────────────────────────────────
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
      {/* Video element — muted, audio handled by AudioContext separately */}
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
        muted
      />

      {/* Live badge */}
      <div className={styles.live}>● LIVE — {sharerName}</div>

      {/* Audio enable button — shown when audio track exists but context is suspended */}
      {hasAudioTrack && !audioEnabled && (
        <button className={styles.audioBtn} onClick={enableAudio}>
          🔊 Click to enable audio
        </button>
      )}

      {/* No audio track indicator */}
      {!hasAudioTrack && (
        <div className={styles.noAudio} title="Sharer did not share system audio">
          🔇 No audio
        </div>
      )}

      {/* Fullscreen button — visible to ALL users on hover */}
      <button
        className={styles.fsBtn}
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen'}
      </button>
    </div>
  );
}
