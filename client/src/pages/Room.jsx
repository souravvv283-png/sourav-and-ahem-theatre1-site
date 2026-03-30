**
 * Room.jsx — Watch Party v3
 */
 * FIXES IN THIS VERSION:
 *
 * 1. LATE JOINER SCREEN SHARE (Critical fix)
 *    - onRoomJoined now checks if isScreenSharing === true
 *    - If yes, and we are NOT the sharer, we immediately emit screen-share-ready
 *    - This triggers the sharer to send us an offer automatically
 *    - No restart needed
 *
 * 2. AUDIO IN SCREEN SHARE
 *    - getDisplayMedia called with { video: true, audio: true }
 *    - ALL tracks (video + audio) added to each peer connection
 *    - Remote <video> element is NOT muted (was muted before — bug)
 *    - AudioContext workaround for autoplay policy
 *
 * 3. FULLSCREEN FOR ALL USERS
 *    - Each user has their own fullscreen button
 *    - Uses Fullscreen API (requestFullscreen / exitFullscreen)
 *    - Works independently per user
 *
 * 4. SEEK BAR REMOVED
 *    - Controls no longer show seek input
 *
 * WebRTC Screen Share Signaling:
 *
 *   SHARER:
 *     getDisplayMedia({ video:true, audio:true })
 *       → set localStreamRef.current SYNCHRONOUSLY (critical — React state is async)
 *       → emit screen-share-start
 *       → on screen-share-ready from each viewer → createOffer → send offer
 *       → on screen-share-answer → setRemoteDescription
 *       → on ice-candidate (kind=screen) → addIceCandidate
 *
 *   VIEWER (existing in room):
 *     on screen-share-start → emit screen-share-ready
 *     on screen-share-offer → createAnswer → send answer
 *     on ice-candidate → addIceCandidate
 *     pc.ontrack → attach stream to <video> (NOT muted)
 *
 *   VIEWER (late joiner):
 *     on room-joined with isScreenSharing=true → emit screen-share-ready to sharerId
 *     → same flow as above from that point
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import socket from '../socket';
import VideoPlayer       from '../components/VideoPlayer';
import ScreenSharePlayer from '../components/ScreenSharePlayer';
import Chat              from '../components/Chat';
import UserList          from '../components/UserList';
import Controls          from '../components/Controls';
import VoiceChat         from '../components/VoiceChat';
import styles            from './Room.module.css';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

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
  const [viewMode,     setViewMode]     = useState('youtube');
  const [sharerName,   setSharerName]   = useState('');

  // ── Voice state ─────────────────────────────────────────────────────────────
  const [inVoice,     setInVoice]     = useState(false);
  const [isMuted,     setIsMuted]     = useState(true);
  const [voiceStream, setVoiceStream] = useState(null);
  const voicePeers   = useRef(new Map());
  const remoteAudios = useRef(new Map());

  // ── Refs ────────────────────────────────────────────────────────────────────
  const playerRef       = useRef(null);
  const screenPeers     = useRef(new Map());
  const localStreamRef  = useRef(null);
  const voiceStreamRef  = useRef(null);
  const isSharingRef    = useRef(false);
  const isHostRef       = useRef(false);

  useEffect(() => { localStreamRef.current = localStream;  }, [localStream]);
  useEffect(() => { isSharingRef.current   = isSharing;    }, [isSharing]);
  useEffect(() => { isHostRef.current      = isHost;       }, [isHost]);
  useEffect(() => { voiceStreamRef.current = voiceStream;  }, [voiceStream]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN SHARE — SHARER SIDE
  // Creates a peer connection for one viewer and sends an offer
  // ═══════════════════════════════════════════════════════════════════════════
  function createScreenPeerForViewer(viewerId) {
    const stream = localStreamRef.current;
    if (!stream) {
      console.warn('[screen] createScreenPeerForViewer called but localStreamRef is null');
      return;
    }

    // Close existing connection to this viewer if any
    if (screenPeers.current.has(viewerId)) {
      screenPeers.current.get(viewerId).close();
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    screenPeers.current.set(viewerId, pc);

    // Add ALL tracks from stream (video + audio if captured)
    stream.getTracks().forEach((track) => {
      console.log(`[screen] adding ${track.kind} track to peer for ${viewerId}`);
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('ice-candidate', { targetId: viewerId, candidate, kind: 'screen' });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[screen] peer ${viewerId} state: ${pc.connectionState}`);
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('screen-share-offer', {
          targetId: viewerId,
          offer: pc.localDescription,
        });
      })
      .catch(console.error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN SHARE — VIEWER SIDE
  // Receives an offer from the sharer and sends back an answer
  // ═══════════════════════════════════════════════════════════════════════════
  function createScreenPeerForViewing(sharerId, offer) {
    const existing = screenPeers.current.get(sharerId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE_CONFIG);
    screenPeers.current.set(sharerId, pc);

    // When we receive tracks from the sharer, display them
    pc.ontrack = (event) => {
      console.log(`[screen] received ${event.track.kind} track from sharer`);
      // Use the first stream (contains both video and audio tracks)
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setViewMode('screenshare');
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('ice-candidate', { targetId: sharerId, candidate, kind: 'screen' });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[screen] viewer peer state: ${pc.connectionState}`);
    };

    pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => {
        socket.emit('screen-share-answer', {
          sharerId,
          answer: pc.localDescription,
        });
      })
      .catch(console.error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOICE — INITIATOR SIDE (creates offer to existing voice user)
  // ═══════════════════════════════════════════════════════════════════════════
  function createVoicePeerAsInitiator(remoteId, stream) {
    const existing = voicePeers.current.get(remoteId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE_CONFIG);
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
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOICE — RECEIVER SIDE (answers offer from joining user)
  // ═══════════════════════════════════════════════════════════════════════════
  function createVoicePeerAsReceiver(remoteId, offer, stream) {
    const existing = voicePeers.current.get(remoteId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection(ICE_CONFIG);
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
    voicePeers.current.get(userId)?.close();
    voicePeers.current.delete(userId);
    const audio = remoteAudios.current.get(userId);
    if (audio) { audio.srcObject = null; remoteAudios.current.delete(userId); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STOP SCREEN SHARE
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // START SCREEN SHARE
  // CRITICAL: localStreamRef.current MUST be set synchronously before
  // emitting screen-share-start, because viewers will respond immediately
  // with screen-share-ready and we need the stream ready at that point.
  // ═══════════════════════════════════════════════════════════════════════════
  async function startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert('Screen sharing not supported. Use Chrome or Edge on desktop.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        // FIX: request system audio capture
        // Works on Chrome (Windows/Mac with correct permissions)
        // Will silently fall back to video-only if browser doesn't support it
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        },
      });

      const tracks = stream.getTracks();
      console.log('[screen] captured tracks:', tracks.map((t) => `${t.kind}:${t.label}`));

      // ✅ CRITICAL FIX: set ref SYNCHRONOUSLY before any socket emit
      // React setState is async — if we only called setLocalStream(stream),
      // localStreamRef.current would still be null when viewers respond
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsSharing(true);
      setViewMode('screenshare');

      // Handle user clicking browser's native "Stop sharing" button
      stream.getVideoTracks()[0].onended = () => stopScreenShare();

      // Now safe to notify viewers — stream is ready
      socket.emit('screen-share-start', { roomId });

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('[screen] getDisplayMedia error:', err);
        alert('Screen share error: ' + err.message);
      }
      // NotAllowedError = user cancelled picker, do nothing
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
      alert('Microphone access denied: ' + err.message);
    }
  }

  function leaveVoice() {
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    setVoiceStream(null);
    voicePeers.current.forEach((_, id) => cleanupVoicePeer(id));
    setInVoice(false);
    setIsMuted(true);
    socket.emit('voice-leave', { roomId });
  }

  function toggleMute() {
    const stream = voiceStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setIsMuted(next);
    socket.emit('voice-mute', { roomId, isMuted: next });
  }

  // ── Chat sound ──────────────────────────────────────────────────────────────
  function playChatSound() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCKET EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!socket.connected) socket.connect();

    function onConnect() {
      setConnected(true);
      socket.emit('join-room', { roomId, userName, isCreating });
    }
    function onDisconnect() { setConnected(false); }

    function onRoomJoined({
      isHost: host, hostId: hid, users: us,
      videoId: vid, currentTime, isPlaying,
      isScreenSharing, sharerId, sharerName: sName,
    }) {
      setIsHost(host); isHostRef.current = host;
      setHostId(hid);
      setUsers(us);
      if (vid) setVideoId(vid);

      // ✅ FIX: Late joiner auto-connect to ongoing screen share
      // If someone is already sharing when we join, immediately tell them
      // we're ready to receive — no restart needed
      if (isScreenSharing && sharerId && sharerId !== socket.id) {
        console.log('[screen] room has active share, auto-connecting to sharer:', sharerId);
        setSharerName(sName || 'Someone');
        setViewMode('screenshare');
        socket.emit('screen-share-ready', { sharerId });
      }
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

    // ── YouTube ────────────────────────────────────────────────────────────
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

    // ── Screen share ───────────────────────────────────────────────────────
    function onScreenShareStart({ sharerId, sharerName: sn }) {
      console.log('[screen] share started by', sn);
      setSharerName(sn);
      addSysMsg(`${sn} started screen sharing 📡`);
      // Tell sharer we're ready to receive
      socket.emit('screen-share-ready', { sharerId });
    }

    function onScreenShareReady({ viewerId }) {
      // We are the sharer — send offer to this viewer
      if (!isSharingRef.current) return;
      console.log('[screen] viewer ready:', viewerId);
      createScreenPeerForViewer(viewerId);
    }

    function onScreenShareOffer({ offer, sharerId }) {
      console.log('[screen] received offer from sharer');
      createScreenPeerForViewing(sharerId, offer);
    }

    function onScreenShareAnswer({ answer, viewerId }) {
      const pc = screenPeers.current.get(viewerId);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(console.error);
    }

    function onScreenShareStop() {
      console.log('[screen] share ended');
      screenPeers.current.forEach((pc) => pc.close());
      screenPeers.current.clear();
      setRemoteStream(null);
      setViewMode('youtube');
      setSharerName('');
      addSysMsg('Screen sharing ended');
    }

    // ── Voice ─────────────────────────────────────────────────────────────
    function onVoiceUsers({ users: ids }) {
      const stream = voiceStreamRef.current;
      ids.forEach((id) => createVoicePeerAsInitiator(id, stream));
    }

    function onVoiceOffer({ offer, fromId }) {
      createVoicePeerAsReceiver(fromId, offer, voiceStreamRef.current);
    }

    function onVoiceAnswer({ answer, fromId }) {
      voicePeers.current.get(fromId)
        ?.setRemoteDescription(new RTCSessionDescription(answer))
        .catch(console.error);
    }

    function onVoiceUserLeft({ userId }) { cleanupVoicePeer(userId); }

    // ── ICE candidates (shared router for both screen and voice) ───────────
    function onIceCandidate({ candidate, fromId, kind }) {
      const pc = kind === 'screen'
        ? screenPeers.current.get(fromId)
        : voicePeers.current.get(fromId);
      if (pc && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
    }

    // ── Chat ──────────────────────────────────────────────────────────────
    function onChatMessage(msg) {
      setMessages((p) => [...p, msg]);
      if (msg.userId !== socket.id) playChatSound();
    }

    // Register
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
      socket.off('voice-offer',         onVoiceOffer);
      socket.off('voice-answer',        onVoiceAnswer);
      socket.off('voice-user-left',     onVoiceUserLeft);
      socket.off('ice-candidate',       onIceCandidate);
      socket.off('chat-message',        onChatMessage);
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Host YouTube sync heartbeat ─────────────────────────────────────────────
  useEffect(() => {
    if (!isHost || isSharing) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      socket.emit('sync', {
        roomId,
        currentTime: p.getCurrentTime?.() ?? 0,
        isPlaying:   p.isPlaying?.() ?? false,
      });
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

  // ── Action helpers ──────────────────────────────────────────────────────────
  function addSysMsg(text) {
    setMessages((p) => [...p, { id: Date.now().toString(), system: true, message: text, timestamp: Date.now() }]);
  }
  function sendChat(msg)    { socket.emit('chat-message', { roomId, message: msg }); }
  function handleSetVideo(v){ socket.emit('set-video',    { roomId, videoId: v }); }
  function handlePlay()     { socket.emit('play',  { roomId, currentTime: playerRef.current?.getCurrentTime?.() ?? 0 }); }
  function handlePause()    { socket.emit('pause', { roomId, currentTime: playerRef.current?.getCurrentTime?.() ?? 0 }); }
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
          <button className={styles.roomId} onClick={copyRoom} title="Copy Room ID">
            {roomId}<span className={styles.copyIcon}>{copied ? '✓' : '⎘'}</span>
          </button>
          {!connected && <span className={styles.offlineDot} title="Reconnecting…" />}
          {(isSharing || viewMode === 'screenshare') && (
            <span className={styles.liveChip}>
              ● {isSharing ? 'You are sharing' : `${sharerName} sharing`}
            </span>
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
        <div className={styles.mainCol}>
          <div className={styles.videoWrap}>
            {showScreenViewer
              ? <ScreenSharePlayer stream={remoteStream} sharerName={sharerName} />
              : <VideoPlayer
                  ref={playerRef}
                  videoId={videoId}
                  isHost={isHost}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  mode={viewMode}
                  localStream={localStream}
                />
            }
          </div>

          <VoiceChat
            users={users}
            inVoice={inVoice}
            isMuted={isMuted}
            onJoin={joinVoice}
            onLeave={leaveVoice}
            onToggleMute={toggleMute}
          />

          <Controls
            isHost={isHost}
            onSetVideo={handleSetVideo}
            onPlay={handlePlay}
            onPause={handlePause}
            isReady={isReady}
            onToggleReady={handleToggleReady}
            isSharing={isSharing}
            onStartShare={startScreenShare}
            onStopShare={stopScreenShare}
          />
        </div>

        <div className={styles.sideCol}>
          <UserList users={users} hostId={hostId} myId={socket.id} />
          <Chat messages={messages} onSend={sendChat} />
        </div>
      </div>
    </div>
  );
}
