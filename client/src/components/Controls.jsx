/**
 * Controls.jsx — v3
 * REMOVED: seek bar (this is a live/watch party app, not a scrubber)
 * KEPT: YouTube URL loader, play/pause, screen share toggle
 * Viewers see: screen share button + ready toggle
 */
import { useState } from 'react';
import styles from './Controls.module.css';

function extractVideoId(input) {
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.searchParams.has('v'))           return url.searchParams.get('v');
    if (url.hostname === 'youtu.be')         return url.pathname.slice(1).split('?')[0];
    if (url.pathname.startsWith('/embed/'))  return url.pathname.split('/embed/')[1].split('?')[0];
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/shorts/')[1].split('?')[0];
  } catch (_) {}
  return null;
}

export default function Controls({
  isHost, onSetVideo, onPlay, onPause,
  isReady, onToggleReady,
  isSharing, onStartShare, onStopShare,
}) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  function handleLoad(e) {
    e.preventDefault(); setErr('');
    const id = extractVideoId(url);
    if (!id) { setErr('Invalid YouTube URL or video ID'); return; }
    onSetVideo(id); setUrl('');
  }

  const shareBtn = isSharing
    ? <button className="btn btn-danger btn-sm" onClick={onStopShare}>⏹ Stop Sharing</button>
    : <button className="btn btn-secondary btn-sm" onClick={onStartShare}>🖥 Share Screen</button>;

  // ── Viewer ─────────────────────────────────────────────────────────────────
  if (!isHost) {
    return (
      <div className={styles.bar}>
        <span className={styles.viewerNote}>👁 Viewer — host controls playback</span>
        <div className={styles.barRight}>
          {shareBtn}
          <button
            className={`btn btn-sm ${isReady ? 'btn-success' : 'btn-secondary'}`}
            onClick={onToggleReady}
          >
            {isReady ? '✓ Ready' : 'Ready?'}
          </button>
        </div>
      </div>
    );
  }

  // ── Host ────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      {/* YouTube URL row */}
      <div className={styles.row}>
        <form className={styles.urlForm} onSubmit={handleLoad}>
          <input
            className={`input ${styles.urlInput}`}
            placeholder={isSharing ? 'Stop sharing to load YouTube' : 'Paste YouTube URL…'}
            value={url}
            disabled={isSharing}
            onChange={(e) => { setUrl(e.target.value); setErr(''); }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={isSharing}>
            Load
          </button>
        </form>
        {shareBtn}
      </div>

      {err && <p className={styles.err}>{err}</p>}

      {/* Playback controls (YouTube mode only) */}
      {!isSharing && (
        <div className={styles.row}>
          <button className="btn btn-primary btn-sm"   onClick={onPlay}>▶ Play</button>
          <button className="btn btn-secondary btn-sm" onClick={onPause}>⏸ Pause</button>
          <span className={styles.hostTag}>👑 Host controls</span>
        </div>
      )}

      {/* Screen share active indicator */}
      {isSharing && (
        <div className={styles.row}>
          <span className={styles.dot} />
          <span className={styles.sharingText}>Live — broadcasting to all viewers</span>
          <span className={styles.hostTag}>👑 Host</span>
        </div>
      )}
    </div>
  );
}
