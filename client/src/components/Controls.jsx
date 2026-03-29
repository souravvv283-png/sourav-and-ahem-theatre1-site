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
  isHost, onSetVideo, onPlay, onPause, onSeek,
  isReady, onToggleReady,
  isSharing, onStartShare, onStopShare,
}) {
  const [url,  setUrl]  = useState('');
  const [err,  setErr]  = useState('');
  const [seek, setSeek] = useState('');

  function handleLoad(e) {
    e.preventDefault(); setErr('');
    const id = extractVideoId(url);
    if (!id) { setErr('Invalid YouTube URL'); return; }
    onSetVideo(id); setUrl('');
  }

  function handleSeek(e) {
    e.preventDefault();
    const s = parseFloat(seek);
    if (!isNaN(s) && s >= 0) { onSeek(s); setSeek(''); }
  }

  const shareBtn = isSharing
    ? <button className="btn btn-danger btn-sm" onClick={onStopShare}>⏹ Stop Share</button>
    : <button className="btn btn-secondary btn-sm" onClick={onStartShare}>🖥 Share Screen</button>;

  if (!isHost) {
    return (
      <div className={styles.bar}>
        <span className={styles.viewerNote}>👁 Viewer — host controls playback</span>
        <div className={styles.barRight}>
          {shareBtn}
          <button className={`btn btn-sm ${isReady ? 'btn-success' : 'btn-secondary'}`} onClick={onToggleReady}>
            {isReady ? '✓ Ready' : 'Ready?'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <form className={styles.urlForm} onSubmit={handleLoad}>
          <input className={`input ${styles.urlInput}`}
            placeholder={isSharing ? 'Stop sharing to load YouTube' : 'Paste YouTube URL…'}
            value={url} disabled={isSharing}
            onChange={(e) => { setUrl(e.target.value); setErr(''); }} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={isSharing}>Load</button>
        </form>
        {shareBtn}
      </div>
      {err && <p className={styles.err}>{err}</p>}

      {!isSharing && (
        <div className={styles.row}>
          <button className="btn btn-primary btn-sm"   onClick={onPlay}>▶ Play</button>
          <button className="btn btn-secondary btn-sm" onClick={onPause}>⏸ Pause</button>
          <form className={styles.seekForm} onSubmit={handleSeek}>
            <input className={`input ${styles.seekInput}`} type="number" placeholder="Seek (s)"
              value={seek} min="0" onChange={(e) => setSeek(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm">⏩</button>
          </form>
          <span className={styles.hostTag}>👑 Host</span>
        </div>
      )}

      {isSharing && (
        <div className={styles.row}>
          <span className={styles.sharingDot} />
          <span className={styles.sharingText}>Broadcasting screen to all viewers</span>
          <span className={styles.hostTag}>👑 Host</span>
        </div>
      )}
    </div>
  );
}
