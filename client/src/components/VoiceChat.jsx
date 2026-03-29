/**
 * VoiceChat.jsx
 * Discord-like voice channel bar.
 * Join/leave voice, mute/unmute.
 * Shows who's currently in voice.
 */
import styles from './VoiceChat.module.css';

export default function VoiceChat({ users, inVoice, isMuted, onJoin, onLeave, onToggleMute }) {
  const voiceUsers = users.filter((u) => u.inVoice);

  return (
    <div className={styles.bar}>
      {/* Voice channel label */}
      <div className={styles.label}>
        <span className={styles.waveIcon}>🔊</span>
        <span className={styles.labelText}>Voice</span>
        {voiceUsers.length > 0 && (
          <span className={styles.count}>{voiceUsers.length}</span>
        )}
      </div>

      {/* Users in voice */}
      {voiceUsers.length > 0 && (
        <div className={styles.voiceUsers}>
          {voiceUsers.map((u) => (
            <div key={u.id} className={styles.voiceUser}>
              <div className={`${styles.avatar} ${u.isMuted ? styles.muted : styles.speaking}`}>
                {u.name[0].toUpperCase()}
              </div>
              <span className={styles.voiceName}>{u.name}</span>
              {u.isMuted && <span className={styles.mutedIcon}>🔇</span>}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className={styles.controls}>
        {!inVoice ? (
          <button className="btn btn-success btn-sm" onClick={onJoin}>
            📞 Join Voice
          </button>
        ) : (
          <>
            <button
              className={`btn btn-sm ${isMuted ? 'btn-secondary' : 'btn-success'}`}
              onClick={onToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇 Unmuted' : '🎙 Muted'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={onLeave} title="Leave voice">
              📵 Leave
            </button>
          </>
        )}
      </div>
    </div>
  );
}
