/**
 * Room.jsx — Watch Party v2
 *
 * BUG FIXES:
 *  1. Room join: uses isCreating flag, no REST pre-validation
 *  2. Screen share: localStreamRef set synchronously BEFORE emitting socket event
 *     so when viewers respond with screen-share-ready, the stream is always available
 *
 * NEW: Voice chat — WebRTC mesh for audio (each user ↔ each other user)
 *
 * WebRTC Signaling Flow:
 *
 *  SCREEN SHARE:
 *   Sharer: getDisplayMedia → set localStreamRef.current (sync!) → emit screen-share-start
 *   Viewers: receive screen-share-start → emit screen-share-ready → server forwards to sharer
 *   Sharer: receives screen-share-ready → createOffer → emit screen-share-offer
 *   Viewer: receives screen-share-offer → createAnswer → emit screen-share-answer
 *   Sharer: receives screen-share-answer → setRemoteDescription
 *   Both: exchange ICE candidates via ice-candidate (kind='screen')
 *
 *  VOICE CHAT:
 *   Joiner: getUserMedia(audio) → emit voice-join
 *   Server: sends back list of existing voice users
 *   Joiner: for each existing user → createOffer → emit voice-offer
 *   Existing: receives voice-offer → createAnswer → emit voice-answer
 *   Joiner: setRemoteDescription on answer
 *   Both: exchange ICE candidates (kind='voice')
 *   ontrack → attach to <audio> element → play
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import socket from '../socket';
import VideoPlayer     from '../components/VideoPlayer';
import ScreenSharePlayer from '../components/ScreenSharePlayer';
import Chat            from '../components/Chat';
import UserList        from '../components/UserList';
import Controls        from '../components/Controls';
import VoiceChat       from '../components/VoiceChat';
import styles          from './Room.module.css';

const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]};

export default function Room() {
  const { roomId } = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();

  const [userName]   = useState(() => location.state?.userName || window.prompt('Your name:') || 'Guest');
  const isCreating   = location.state?.isCreating ?? false;

  // ── Room state ──────────────────────────────────────────────────────────────
  const [connected,  setConnected]  = useState(false);
  const [isHost,     setIsHost]     = useState(false);
  const [hostId,     setHostId]     = useState(null);
  const [users,      setUsers]      = useState([]);
  const [videoId,    setVideoId]    = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [error,      setError]      = useState('');
  const [copied,     setCopied]     = useState(false);
  const [isReady,    setIsReady]    = useState(false);

  // ── Screen share state ──────────────────────────────────────────────────────
  const [isSharing,    setIsSharing]    = useState(false);
  const [localStream,  setLocalStream]  = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [viewMode,     setViewMode]     = useState('youtube'); // 'youtube' | 'screenshare'
  const [sharerName,   setSharerName]   = useState('');

  // ── Voice state ─────────────────────────────────────────────────────────────
  const [inVoice,      setInVoice]      = useState(false);
  const [isMuted,      setIsMuted]      = useState(true);
  const [voiceStream,  setVoiceStream]  = useState(null); // local mic stream
  const voicePeers    = useRef(new Map()); // socketId → RTCPeerConnection
  const remoteAudios  = useRef(new Map()); // socketId → HTMLAudioElement

  // ── Refs ────────────────────────────────────────────────────────────────────
  const playerRef       = useRef(null);
  const screenPeers     = useRef(new Map()); // socketId → RTCPeerConnection (screen share)
  const localStreamRef  = useRef(null);   // set SYNCHRONOUSLY before any socket emit
  const voiceStreamRef  = useRef(null);
  const isSharingRef    = useRef(false);
  const inVoiceRef      = useRef(false);
  const isHostRef       = useRef(false);

  useEffect(() => { localStreamRef.current = localStream; },  [localStream]);
  useEffect(() => { isSharingRef.current   = isSharing;   },  [isSharing]);
  useEffect(() => { inVoiceRef.current     = inVoice;     },  [inVoice]);
  useEffect(() => { isHostRef.current      = isHost;      },  [isHost]);
  useEffect(() => { voiceStreamRef.current = voiceStream; },  [voiceStream]);

  // ── WebRTC: screen share peer (sharer → one viewer) ────────────────────────
  function createScreenPeerForViewer(viewerId) {
    if (screenPeers.current.has(viewerId)) screenPeers.current.get(viewerId).close();
    const stream = localStreamRef.current;
    if (!stream) return;

    const pc = new RTCPeerConnection(ICE);
    screenPeers.current.set(viewerId, pc);

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice-candidate', { targetId: viewerId, candidate, kind: 'screen' });
    };

    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => socket.emit('screen-share-offer', { targetId: viewerId, offer: pc.localDescription }))
      .catch(console.error);

    return pc;
  }

  // ── WebRTC: screen share peer (viewer side) ─────────────────────────────────
  function createScreenPeerForViewing(sharerId, offer) {
    const existing = screenPeers.current.get(sharerId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE);
    screenPeers.current.set(sharerId, pc);

    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
      setViewMode('screenshare');
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice-candidate', { targetId: sharerId, candidate, kind: 'screen' });
    };

    pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(() => pc.createAnswer())
      .then((a) => pc.setLocalDescription(a))
      .then(() => socket.emit('screen-share-answer', { sharerId, answer: pc.localDescription }))
      .catch(console.error);

    return pc;
  }

  // ── WebRTC: voice peer (initiator side — creates offer) ────────────────────
  function createVoicePeerAsInitiator(remoteId, stream) {
    const existing = voicePeers.current.get(remoteId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE);
    voicePeers.current.set(remoteId, pc);

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.ontrack = (e) => attachRemoteAudio(remoteId, e.streams[0]);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice-candidate', { targetId: remoteId, candidate, kind: 'voice' });
    };

    pc.createOffer({ offerToReceiveAudio: true })
      .then((o) => pc.setLocalDescription(o))
      .then(() => socket.emit('voice-offer', { targetId: remoteId, offer: pc.localDescription }))
      .catch(console.error);

    return pc;
  }

  // ── WebRTC: voice peer (receiver side — answers offer) ─────────────────────
  function createVoicePeerAsReceiver(remoteId, offer, stream) {
    const existing = voicePeers.current.get(remoteId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE);
    voicePeers.current.set(remoteId, pc);

    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.ontrack = (e) => attachRemoteAudio(remoteId, e.streams[0]);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice-candidate', { targetId: remoteId, candidate, kind: 'voice' });
    };

    pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(() => pc.createAnswer({ offerToReceiveAudio: true }))
      .then((a) => pc.setLocalDescription(a))
      .then(() => socket.emit('voice-answer', { targetId: remoteId, answer: pc.localDescription }))
      .catch(console.error);

    return pc;
  }

  function attachRemoteAudio(userId, stream) {
    let audio = remoteAudios.current.get(userId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      remoteAudios.current.set(userId, audio);
    }
    audio.srcObject = stream;
  }

  function cleanupVoicePeer(userId) {
    const pc = voicePeers.current.get(userId);
    if (pc) { pc.close(); voicePeers.current.delete(userId); }
    const audio = remoteAudios.current.get(userId);
    if (audio) { audio.srcObject = null; remoteAudios.current.delete(userId); }
  }

  // ── Stop screen share ───────────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenPeers.current.forEach((pc) => pc.close());
    screenPeers.current.clear();
    localStreamRef.current = null;
    setLocalStream(null);
    setIsSharing(false);
    setViewMode('youtube');
    socket.emit('screen-share-stop', { roomId });
  }, [roomId]);

  // ── Start screen share (BUG FIX: set ref sync before emit) ─────────────────
  async function startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return alert('Screen sharing not supported. Use Chrome or Edge.');
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });

      // ✅ FIX: set the ref SYNCHRONOUSLY before any socket emit
      // This ensures when viewers respond with screen-share-ready,
      // localStreamRef.current is already populated.
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsSharing(true);
      setViewMode('screenshare');

      stream.getVideoTracks()[0].onended = stopScreenShare;

      socket.emit('screen-share-start', { roomId });
    } catch (err) {
      if (err.name !== 'NotAllowedError') alert('Screen share error: ' + err.message);
    }
  }

  // ── Join voice ──────────────────────────────────────────────────────────────
  async function joinVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      voiceStreamRef.current = stream;
      setVoiceStream(stream);
      setInVoice(true);
      setIsMuted(false);
      socket.emit('voice-join', { roomId });
    } catch (err) {
      alert('Could not access microphone: ' + err.message);
    }
  }

  // ── Leave voice ─────────────────────────────────────────────────────────────
  function leaveVoice() {
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    setVoiceStream(null);
    voicePeers.current.forEach((_, id) => cleanupVoicePeer(id));
    voicePeers.current.clear();
    setInVoice(false);
    setIsMuted(true);
    socket.emit('voice-leave', { roomId });
  }

  // ── Toggle mute ─────────────────────────────────────────────────────────────
  function toggleMute() {
    const stream = voiceStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setIsMuted(next);
    socket.emit('voice-mute', { roomId, isMuted: next });
  }

  // ── Chat notification sound ─────────────────────────────────────────────────
  function playChatSound() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.22);
    } catch (_) {}
  }

  // ── Socket events ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket.connected) socket.connect();

    function onConnect() {
      setConnected(true);
      // ✅ FIX: pass isCreating flag — no REST pre-validation needed
      socket.emit('join-room', { roomId, userName, isCreating });
    }
    function onDisconnect() { setConnected(false); }

    function onRoomJoined({ isHost: host, hostId: hid, users: us, videoId: vid, currentTime, isPlaying }) {
      setIsHost(host); isHostRef.current = host;
      setHostId(hid);
      setUsers(us);
      if (vid) setVideoId(vid);
    }

    function onErrorMsg({ message }) { setError(message); }

    function onUserJoined({ users: us }) {
      setUsers(us);
      addSysMsg('Someone joined 👋');
    }

    function onUserLeft({ userName: n, users: us, newHostId }) {
      setUsers(us);
      addSysMsg(`${n} left`);
      if (newHostId === socket.id) {
        setIsHost(true); isHostRef.current = true;
        setHostId(newHostId); addSysMsg("You're now the host 👑");
      } else { setHostId(newHostId); }
    }

    function onUsersUpdated({ users: us }) { setUsers(us); }

    // ── YouTube sync ──────────────────────────────────────────────────────────
    function onVideoChanged({ videoId: v }) { setVideoId(v); }
    function onPlay({ currentTime })  { playerRef.current?.seekTo(currentTime); playerRef.current?.play(); }
    function onPause({ currentTime }) { playerRef.current?.seekTo(currentTime); playerRef.current?.pause(); }
    function onSeek({ currentTime })  { playerRef.current?.seekTo(currentTime); }
    function onSync({ currentTime, isPlaying }) {
      const p = playerRef.current;
      if (!p) return;
      if (Math.abs((p.getCurrentTime?.() ?? 0) - currentTime) > 2) p.seekTo(currentTime);
      isPlaying ? p.play() : p.pause();
    }

    // ── Screen share ──────────────────────────────────────────────────────────
    function onScreenShareStart({ sharerId, sharerName: sn }) {
      setSharerName(sn);
      addSysMsg(`${sn} started screen sharing 📡`);
      // Tell sharer we're ready — they'll send us an offer
      socket.emit('screen-share-ready', { sharerId });
    }

    function onScreenShareReady({ viewerId }) {
      // We are the sharer — a viewer is ready; create offer for them
      if (!isSharingRef.current || !localStreamRef.current) return;
      createScreenPeerForViewer(viewerId);
    }

    function onScreenShareOffer({ offer, sharerId }) {
      createScreenPeerForViewing(sharerId, offer);
    }

    function onScreenShareAnswer({ answer, viewerId }) {
      const pc = screenPeers.current.get(viewerId);
      pc?.setRemoteDescription(new RTCSessionDescription(answer)).catch(console.error);
    }

    function onScreenShareStop() {
      screenPeers.current.forEach((pc) => pc.close());
      screenPeers.current.clear();
      setRemoteStream(null);
      setViewMode('youtube');
      setSharerName('');
      addSysMsg('Screen sharing ended');
    }

    // ── Voice ──────────────────────────────────────────────────────────────────
    // Server sends list of users already in voice → we create offers to all of them
    function onVoiceUsers({ users: ids }) {
      const stream = voiceStreamRef.current;
      if (!stream) return;
      ids.forEach((id) => createVoicePeerAsInitiator(id, stream));
    }

    // A new user joined voice → we wait; they will create offer to us
    function onVoiceUserJoined({ userId }) {
      // Nothing to do here — the joiner will send us an offer via voice-offer
    }

    function onVoiceOffer({ offer, fromId }) {
      const stream = voiceStreamRef.current;
      createVoicePeerAsReceiver(fromId, offer, stream);
    }

    function onVoiceAnswer({ answer, fromId }) {
      const pc = voicePeers.current.get(fromId);
      pc?.setRemoteDescription(new RTCSessionDescription(answer)).catch(console.error);
    }

    function onVoiceUserLeft({ userId }) {
      cleanupVoicePeer(userId);
    }

    // ── Shared ICE candidate router ────────────────────────────────────────────
    function onIceCandidate({ candidate, fromId, kind }) {
      let pc;
      if (kind === 'screen') {
        // Could be sharer side (key = viewerId) or viewer side (key = sharerId)
        pc = screenPeers.current.get(fromId);
      } else if (kind === 'voice') {
        pc = voicePeers.current.get(fromId);
      }
      if (pc && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
    }

    // ── Chat ──────────────────────────────────────────────────────────────────
    function onChatMessage(msg) {
      setMessages((p) => [...p, msg]);
      if (msg.userId !== socket.id) playChatSound();
    }

    socket.on('connect',              onConnect);
    socket.on('disconnect',           onDisconnect);
    socket.on('room-joined',          onRoomJoined);
    socket.on('error-msg',            onErrorMsg);
    socket.on('user-joined',          onUserJoined);
    socket.on('user-left',            onUserLeft);
    socket.on('users-updated',        onUsersUpdated);
    socket.on('video-changed',        onVideoChanged);
    socket.on('play',                 onPlay);
    socket.on('pause',                onPause);
    socket.on('seek',                 onSeek);
    socket.on('sync',                 onSync);
    socket.on('screen-share-start',   onScreenShareStart);
    socket.on('screen-share-ready',   onScreenShareReady);
    socket.on('screen-share-offer',   onScreenShareOffer);
    socket.on('screen-share-answer',  onScreenShareAnswer);
    socket.on('screen-share-stop',    onScreenShareStop);
    socket.on('voice-users',          onVoiceUsers);
    socket.on('voice-user-joined',    onVoiceUserJoined);
    socket.on('voice-offer',          onVoiceOffer);
    socket.on('voice-answer',         onVoiceAnswer);
    socket.on('voice-user-left',      onVoiceUserLeft);
    socket.on('ice-candidate',        onIceCandidate);
    socket.on('chat-message',         onChatMessage);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect',             onConnect);
      socket.off('disconnect',          onDisconnect);
      socket.off('room-joined',         onRoomJoined);
      socket.off('error-msg',           onErrorMsg);
      socket.off('user-joined',         onUserJoined);
      socket.off('user-left',           onUserLeft);
      socket.off('users-updated',       onUsersUpdated);
      socket.off('video-changed',       onVideoChanged);
      socket.off('play',                onPlay);
      socket.off('pause',               onPause);
      socket.off('seek',                onSeek);
      socket.off('sync',                onSync);
      socket.off('screen-share-start',  onScreenShareStart);
      socket.off('screen-share-ready',  onScreenShareReady);
      socket.off('screen-share-offer',  onScreenShareOffer);
      socket.off('screen-share-answer', onScreenShareAnswer);
      socket.off('screen-share-stop',   onScreenShareStop);
      socket.off('voice-users',         onVoiceUsers);
      socket.off('voice-user-joined',   onVoiceUserJoined);
      socket.off('voice-offer',         onVoiceOffer);
      socket.off('voice-answer',        onVoiceAnswer);
      socket.off('voice-user-left',     onVoiceUserLeft);
      socket.off('ice-candidate',       onIceCandidate);
      socket.off('chat-message',        onChatMessage);
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Host periodic sync ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost || isSharing) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      socket.emit('sync', { roomId, currentTime: p.getCurrentTime?.() ?? 0, isPlaying: p.isPlaying?.() ?? false });
    }, 3000);
    return () => clearInterval(id);
  }, [isHost, isSharing, roomId]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenPeers.current.forEach((pc) => pc.close());
    voicePeers.current.forEach((pc) => pc.close());
    remoteAudios.current.forEach((a) => { a.srcObject = null; });
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function addSysMsg(text) {
    setMessages((p) => [...p, { id: Date.now().toString(), system: true, message: text, timestamp: Date.now() }]);
  }
  function sendChat(msg)    { socket.emit('chat-message', { roomId, message: msg }); }
  function handleSetVideo(v){ socket.emit('set-video', { roomId, videoId: v }); }
  function handlePlay()     { socket.emit('play',  { roomId, currentTime: playerRef.current?.getCurrentTime?.() ?? 0 }); }
  function handlePause()    { socket.emit('pause', { roomId, currentTime: playerRef.current?.getCurrentTime?.() ?? 0 }); }
  function handleSeek(t)    { socket.emit('seek',  { roomId, currentTime: t }); playerRef.current?.seekTo(t); }
  function handleToggleReady() {
    const next = !isReady; setIsReady(next);
    socket.emit('toggle-ready', { roomId, isReady: next });
  }
  function copyRoom() {
    navigator.clipboard.writeText(roomId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  // ── Error page ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={styles.errPage}>
        <div className={styles.errCard}>
          <div style={{ fontSize: 48 }}>😕</div>
          <h2>Oops!</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>
        </div>
      </div>
    );
  }

  const showScreenViewer = !isSharing && viewMode === 'screenshare';

  return (
    <div className={styles.layout}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.hLeft}>
          <span className={styles.logo}>🎬</span>
          <span className={styles.brand}>Watch Party</span>
        </div>
        <div className={styles.hCenter}>
          <span className={styles.roomLabel}>Room</span>
          <button className={styles.roomId} onClick={copyRoom} title="Copy ID">
            {roomId}<span className={styles.copyIcon}>{copied ? '✓' : '⎘'}</span>
          </button>
          {!connected && <span className={styles.dot} style={{ background: 'var(--red)' }} title="Reconnecting…" />}
          {(isSharing || viewMode === 'screenshare') && (
            <span className={styles.liveChip}>● {isSharing ? 'You are sharing' : `${sharerName} sharing`}</span>
          )}
        </div>
        <div className={styles.hRight}>
          {isHost && <span className="badge badge-host">👑 Host</span>}
          <span className={styles.userName}>{userName}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')}>Leave</button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className={styles.body}>
        {/* Main column */}
        <div className={styles.mainCol}>
          <div className={styles.videoWrap}>
            {showScreenViewer
              ? <ScreenSharePlayer stream={remoteStream} sharerName={sharerName} />
              : <VideoPlayer ref={playerRef} videoId={videoId} isHost={isHost}
                  onPlay={handlePlay} onPause={handlePause} onSeek={handleSeek}
                  mode={viewMode} localStream={localStream} />
            }
          </div>

          {/* Voice chat bar */}
          <VoiceChat
            users={users}
            inVoice={inVoice}
            isMuted={isMuted}
            onJoin={joinVoice}
            onLeave={leaveVoice}
            onToggleMute={toggleMute}
          />

          {/* Playback controls */}
          <Controls
            isHost={isHost}
            onSetVideo={handleSetVideo}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeek={handleSeek}
            isReady={isReady}
            onToggleReady={handleToggleReady}
            isSharing={isSharing}
            onStartShare={startScreenShare}
            onStopShare={stopScreenShare}
          />
        </div>

        {/* Side column */}
        <div className={styles.sideCol}>
          <UserList users={users} hostId={hostId} myId={socket.id} />
          <Chat messages={messages} onSend={sendChat} />
        </div>
      </div>
    </div>
  );
}
