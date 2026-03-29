/**
 * Home.jsx
 *
 * FIX: Room join no longer calls GET /api/rooms/:id before navigating.
 * Instead we pass isCreating=true/false to the socket join-room event.
 * The server returns an error-msg only when the room truly doesn't exist.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Home.module.css';

export default function Home() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState('');
  const [joinId,   setJoinId]   = useState('');
  const [tab,      setTab]      = useState('create'); // 'create' | 'join'
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!userName.trim()) return setError('Enter your name first');
    setLoading(true);
    try {
      const res  = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName }) });
      const data = await res.json();
      // Navigate with isCreating=true so socket creates the room
      navigate(`/room/${data.roomId}`, { state: { userName: userName.trim(), isCreating: true } });
    } catch {
      setError('Could not reach server. Is it running?');
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e) {
    e.preventDefault();
    setError('');
    if (!userName.trim()) return setError('Enter your name first');
    if (!joinId.trim())   return setError('Enter a Room ID');
    // Navigate with isCreating=false — server will error if room doesn't exist
    navigate(`/room/${joinId.trim().toUpperCase()}`, {
      state: { userName: userName.trim(), isCreating: false },
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.logo}>🎬</div>
        <h1 className={styles.title}>Watch Party</h1>
        <p className={styles.sub}>Watch together · Chat · Voice · Screen Share</p>
      </div>

      <div className={styles.card}>
        <div className={styles.tabs}>
          {['create','join'].map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => { setTab(t); setError(''); }}
            >
              {t === 'create' ? 'Create Room' : 'Join Room'}
            </button>
          ))}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Your Name</label>
          <input className="input" placeholder="Display name" value={userName} maxLength={30}
            onChange={(e) => setUserName(e.target.value)} autoFocus />
        </div>

        {tab === 'create' ? (
          <form onSubmit={handleCreate}>
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={`btn btn-primary btn-lg ${styles.fullBtn}`} disabled={loading}>
              {loading ? 'Creating…' : '✨ Create Room'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <div className={styles.field}>
              <label className={styles.label}>Room ID</label>
              <input className="input" placeholder="e.g. A1B2C3D4" value={joinId} maxLength={8}
                onChange={(e) => setJoinId(e.target.value.toUpperCase())} />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={`btn btn-primary btn-lg ${styles.fullBtn}`}>
              🚀 Join Room
            </button>
          </form>
        )}
      </div>
      <p className={styles.footer}>Free · No account needed</p>
    </div>
  );
}
