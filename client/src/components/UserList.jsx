import styles from './UserList.module.css';

export default function UserList({ users, hostId, myId }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>👥 Members</span>
        <span className={styles.count}>{users.length}</span>
      </div>
      <ul className={styles.list}>
        {users.map((u) => (
          <li key={u.id} className={styles.user}>
            {/* Avatar with voice indicator */}
            <div className={`${styles.avatar} ${u.inVoice ? styles.inVoice : ''}`}
              data-initial={u.name[0].toUpperCase()} />

            <span className={`${styles.name} ${u.id === myId ? styles.mine : ''}`}>
              {u.name}{u.id === myId ? ' (you)' : ''}
            </span>

            <div className={styles.badges}>
              {u.id === hostId && <span className="badge badge-host">Host</span>}
              {u.inVoice && (
                <span className="badge badge-voice" title={u.isMuted ? 'Muted' : 'In voice'}>
                  {u.isMuted ? '🔇' : '🎙'}
                </span>
              )}
              <span className={`badge ${u.isReady ? 'badge-ready' : 'badge-waiting'}`}>
                {u.isReady ? '✓' : '…'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
