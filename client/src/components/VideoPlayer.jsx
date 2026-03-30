/**
 * VideoPlayer.jsx
 *
 * Two modes:
 *   mode="youtube"     → YouTube IFrame player (host controls, viewer watches)
 *   mode="screenshare" → Host's own screen preview (local stream, muted)
 *
 * FULLSCREEN: available to all users via fullscreen button on the container.
 * SEEK BAR: removed — no seek UI exposed.
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
    s.id = 'yt-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
}

const VideoPlayer = forwardRef(function VideoPlayer(
  { videoId, isHost, onPlay, onPause, mode, localStream },
  ref
) {
  const containerRef  = useRef(null);
  const wrapRef       = useRef(null);
  const previewRef    = useRef(null);
  const playerRef     = useRef(null);
  const readyRef      = useRef(false);
  const cbRef         = useRef({ onPlay, onPause });
  const [ready,       setReady]       = useState(false);
  const [apiErr,      setApiErr]      = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => { cbRef.current = { onPlay, onPause }; }, [onPlay, onPause]);

  // Expose imperative API to Room.jsx
  useImperativeHandle(ref, () => ({
    play()           { readyRef.current && playerRef.current?.playVideo(); },
    pause()          { readyRef.current && playerRef.current?.pauseVideo(); },
    seekTo(s)        { readyRef.current && playerRef.current?.seekTo(s, true); },
    getCurrentTime() { return readyRef.current ? (playerRef.current?.getCurrentTime() ?? 0) : 0; },
    isPlaying()      { return readyRef.current && playerRef.current?.getPlayerState() === 1; },
  }));

  // Attach local stream to host preview
  useEffect(() => {
    if (previewRef.current && localStream) {
      previewRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Track fullscreen changes
  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // YouTube player lifecycle
  useEffect(() => {
    if (!videoId || mode === 'screenshare') return;
    let dead = false;

    loadYT().then(() => {
      if (dead) return;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
        readyRef.current  = false;
        setReady(false);
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay:       0,
          controls:       isHost ? 1 : 0,
          disablekb:      isHost ? 0 : 1,
          modestbranding: 1,
          rel:            0,
          fs:             1, // allow YouTube's own fullscreen too
        },
        events: {
          onReady() {
            if (!dead) { readyRef.current = true; setReady(true); }
          },
          onStateChange(e) {
            if (!isHost) return;
            if (e.data === window.YT.PlayerState.PLAYING) cbRef.current.onPlay();
            if (e.data === window.YT.PlayerState.PAUSED)  cbRef.current.onPause();
          },
          onError() { setApiErr(true); },
        },
      });
    }).catch(() => setApiErr(true));

    return () => {
      dead = true;
      try { playerRef.current?.destroy(); } catch (_) {}
      playerRef.current = null;
      readyRef.current  = false;
    };
  }, [videoId, isHost, mode]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      wrapRef.current?.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  // ── Screen share host preview ──────────────────────────────────────────────
  if (mode === 'screenshare') {
    return (
      <div ref={wrapRef} className={styles.wrap}>
        {localStream ? (
          <>
            <video ref={previewRef} className={styles.player} autoPlay playsInline muted />
            <div className={styles.previewBadge}>📡 Sharing your screen</div>
            <button className={styles.fsBtn} onClick={toggleFullscreen}>
              {isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen'}
            </button>
          </>
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.icon}>📡</span>
            <p>Starting capture…</p>
          </div>
        )}
      </div>
    );
  }

  // ── No video yet ───────────────────────────────────────────────────────────
  if (!videoId) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.icon}>📺</span>
        <p>{isHost ? 'Paste a YouTube URL below to start watching' : 'Waiting for host to load a video…'}</p>
      </div>
    );
  }

  if (apiErr) {
    return (
      <div className={styles.placeholder}>
        <span className={styles.icon}>⚠️</span>
        <p>Could not load video. Check the URL is valid and the video is public.</p>
      </div>
    );
  }

  // ── YouTube player ─────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div ref={containerRef} className={styles.player} />
      {!ready && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading player…</span>
        </div>
      )}
      {/* Block viewer from interacting with YT controls */}
      {!isHost && ready && <div className={styles.overlay} title="Host controls playback" />}

      {/* Fullscreen button for ALL users */}
      {ready && (
        <button className={styles.fsBtn} onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : '⛶ Fullscreen'}
        </button>
      )}
    </div>
  );
});

export default VideoPlayer;
