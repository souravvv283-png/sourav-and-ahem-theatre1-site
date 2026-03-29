/**
 * VideoPlayer.jsx
 * mode="youtube"      → YouTube IFrame player
 * mode="screenshare"  → host's own screen preview (local stream)
 */
import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import styles from './VideoPlayer.module.css';

function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    if (document.getElementById('yt-script')) {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      return;
    }
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.id  = 'yt-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

const VideoPlayer = forwardRef(function VideoPlayer(
  { videoId, isHost, onPlay, onPause, onSeek, mode, localStream },
  ref
) {
  const containerRef = useRef(null);
  const previewRef   = useRef(null);
  const playerRef    = useRef(null);
  const readyRef     = useRef(false);
  const cbRef        = useRef({ onPlay, onPause, onSeek });
  const [ready, setReady] = useState(false);
  const [apiErr, setApiErr] = useState(false);

  useEffect(() => { cbRef.current = { onPlay, onPause, onSeek }; }, [onPlay, onPause, onSeek]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    play()           { readyRef.current && playerRef.current?.playVideo(); },
    pause()          { readyRef.current && playerRef.current?.pauseVideo(); },
    seekTo(s)        { readyRef.current && playerRef.current?.seekTo(s, true); },
    getCurrentTime() { return readyRef.current ? (playerRef.current?.getCurrentTime() ?? 0) : 0; },
    isPlaying()      { return readyRef.current && playerRef.current?.getPlayerState() === 1; },
  }));

  // Host preview for screen share
  useEffect(() => {
    if (previewRef.current && localStream) previewRef.current.srcObject = localStream;
  }, [localStream]);

  // YouTube player lifecycle
  useEffect(() => {
    if (!videoId || mode === 'screenshare') return;
    let dead = false;

    loadYT().then(() => {
      if (dead) return;
      if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; readyRef.current = false; setReady(false); }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: 0, controls: isHost ? 1 : 0, disablekb: isHost ? 0 : 1, modestbranding: 1, rel: 0 },
        events: {
          onReady() { if (!dead) { readyRef.current = true; setReady(true); } },
          onStateChange(e) {
            if (!isHost) return;
            if (e.data === window.YT.PlayerState.PLAYING) cbRef.current.onPlay();
            if (e.data === window.YT.PlayerState.PAUSED)  cbRef.current.onPause();
          },
          onError() { setApiErr(true); },
        },
      });
    }).catch(() => setApiErr(true));

    return () => { dead = true; try { playerRef.current?.destroy(); } catch (_) {} playerRef.current = null; readyRef.current = false; };
  }, [videoId, isHost, mode]);

  // ── Screen share host preview ────────────────────────────────────────────
  if (mode === 'screenshare') {
    return (
      <div className={styles.wrap}>
        {localStream
          ? <><video ref={previewRef} className={styles.player} autoPlay playsInline muted />
              <div className={styles.previewBadge}>📡 Sharing your screen</div></>
          : <div className={styles.placeholder}><span>📡</span><p>Starting capture…</p></div>
        }
      </div>
    );
  }

  // ── YouTube player ────────────────────────────────────────────────────────
  if (!videoId) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.icon}>📺</span>
        <p>{isHost ? 'Paste a YouTube URL below to start' : 'Waiting for host to load a video…'}</p>
      </div>
    );
  }

  if (apiErr) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.icon}>⚠️</span>
        <p>Could not load video. Check the URL is valid and public.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.player} />
      {!ready && <div className={styles.loading}><div className={styles.spinner} /><span>Loading…</span></div>}
      {!isHost && ready && <div className={styles.overlay} title="Host controls playback" />}
    </div>
  );
});

export default VideoPlayer;
