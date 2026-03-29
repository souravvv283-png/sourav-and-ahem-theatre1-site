import { useEffect, useRef } from 'react';
import styles from './ScreenSharePlayer.module.css';

export default function ScreenSharePlayer({ stream, sharerName }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!stream) {
    return (
      <div className={styles.waiting}>
        <div className={styles.pulse}>📡</div>
        <p>Connecting to {sharerName || 'screen share'}…</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <video ref={videoRef} className={styles.video} autoPlay playsInline />
      <div className={styles.live}>● LIVE — {sharerName}</div>
    </div>
  );
}
