import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getParticipants,
  getRoomCode,
  insertCoin,
  isHost,
  myPlayer,
  onPlayerJoin,
  usePlayersList,
  useMultiplayerState,
} from 'playroomkit';
import { buildGuessResultsFromAssignments, calculateVoteScoreFromAssignments } from './scoreUtils';

type Phase = 'lobby' | 'round' | 'results';

type Submission = {
  playerId: string;
  playerName: string;
  text: string;
};

type GuessResult = {
  playerId: string;
  guess: string;
  correct: boolean;
};

type VoteEntry = {
  voterId: string;
  guessedPlayerId: string;
};

const PICTURES = [
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
];

const PLAYER_COLORS = [
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#a855f7',
  '#14b8a6',
  '#f97316',
  '#ec4899',
];

function App() {
  const players = usePlayersList();
  const [roomCode, setRoomCode] = useState<string | undefined>(undefined);
  const [joined, setJoined] = useState(false);
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('picture-clue-player-name') || '';
  });
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useMultiplayerState<Phase>('phase', 'lobby');
  const [imageIndex, setImageIndex] = useMultiplayerState<number>('imageIndex', 0);
  const [submissions, setSubmissions] = useMultiplayerState<Submission[]>('submissions', []);
  const [activePrompt, setActivePrompt] = useMultiplayerState<string>('activePrompt', '');
  const [guesses, setGuesses] = useMultiplayerState<GuessResult[]>('guesses', []);
  const [scoreBoard, setScoreBoard] = useMultiplayerState<Record<string, number>>('scores', {});
  const [mySubmission, setMySubmission] = useState('');
  const [mySubmittedThisRound, setMySubmittedThisRound] = useState(false);
  const [guessMap, setGuessMap] = useState<Record<string, string>>({});
  const [localAssignments, setLocalAssignments] = useState<Record<string, string[]>>({});
  const [playerNumbers, setPlayerNumbers] = useMultiplayerState<Record<string, number>>('playerNumbers', {});
  const [sharedAssignments, setSharedAssignments] = useMultiplayerState<Record<string, VoteEntry[]>>('sharedAssignments', {});
  const [voteFinishedByPlayer, setVoteFinishedByPlayer] = useMultiplayerState<Record<string, boolean>>('voteFinishedByPlayer', {});
  const [scoreCelebration, setScoreCelebration] = useMultiplayerState<{ playerId: string; points: number } | null>('scoreCelebration', null);
  const [dragState, setDragState] = useState<{ playerId: string; sourceSubmissionId: string | null; x: number; y: number } | null>(null);

  const me = myPlayer();
  const musicIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousPhaseRef = useRef<Phase | null>(null);

  const ensureMusicContext = async () => {
    if (typeof window === 'undefined') return;

    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  };

  const playAmbientNote = async () => {
    if (typeof window === 'undefined') return;
    await ensureMusicContext();

    const context = audioContextRef.current;
    if (!context) return;

    const notes = [261.63, 329.63, 392, 523.25, 392, 329.63];
    const frequency = notes[Math.floor(Math.random() * notes.length)];
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.022, context.currentTime + 0.08);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + 0.95);
  };

  const playHappyScoreTone = async () => {
    if (typeof window === 'undefined') return;
    await ensureMusicContext();

    const context = audioContextRef.current;
    if (!context) return;

    const frequencies = [523.25, 659.25, 783.99];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.08);

      gainNode.gain.setValueAtTime(0.0001, context.currentTime + index * 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.05, context.currentTime + index * 0.08 + 0.06);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.08 + 0.38);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(context.currentTime + index * 0.08);
      oscillator.stop(context.currentTime + index * 0.08 + 0.42);
    });
  };

  const normalizePlayerName = (value: string) => value.trim().toLowerCase();

  const hasNameTaken = (candidateName: string, ignoredPlayerId?: string) => {
    const normalized = normalizePlayerName(candidateName);
    if (!normalized) return false;

    return players.some((player) => {
      if (ignoredPlayerId && player.id === ignoredPlayerId) return false;
      return normalizePlayerName(player.getProfile().name) === normalized;
    });
  };

  useEffect(() => {
    setRoomCode(getRoomCode());
  }, []);

  useEffect(() => {
    if (!joined) return;

    const cleanup = onPlayerJoin((player) => {
      const participantNames = getParticipants();
      if (Object.keys(participantNames).length > 0) {
        setJoined(true);
      }
    });

    return cleanup;
  }, [joined]);

  useEffect(() => {
    if (!joined || phase === 'lobby') {
      if (musicIntervalRef.current) {
        window.clearInterval(musicIntervalRef.current);
        musicIntervalRef.current = null;
      }
      return;
    }

    void playAmbientNote();
    musicIntervalRef.current = window.setInterval(() => {
      void playAmbientNote();
    }, 480);

    return () => {
      if (musicIntervalRef.current) {
        window.clearInterval(musicIntervalRef.current);
        musicIntervalRef.current = null;
      }
    };
  }, [joined, phase]);

  useEffect(() => {
    if (!joined || !me?.id) return;

    const trimmedName = playerName.trim();
    if (!trimmedName) return;

    if (hasNameTaken(trimmedName, me.id)) {
      setError(`The name "${trimmedName}" is already in use. Please choose a different name.`);
      setJoined(false);
      setRoomCode(undefined);
      me.leaveRoom();
    }
  }, [joined, me, playerName, players]);

  const isCurrentHost = isHost();

  const normalizeRoomCode = (value?: string) => {
    const digits = (value || '').replace(/\D/g, '').slice(0, 3);
    return digits.length === 3 ? digits : undefined;
  };

  const generateRoomCode = () => {
    return String(Math.floor(100 + Math.random() * 900));
  };

  const setupRoom = async (code?: string) => {
    setError('');
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setError('Choose a name first.');
      return;
    }

    localStorage.setItem('picture-clue-player-name', trimmedName);

    const normalizedCode = normalizeRoomCode(code);
    if (code && !normalizedCode) {
      setError('Room code must be a 3-digit number.');
      return;
    }

    try {
      const customProfile = { name: playerName.trim() };

      await insertCoin({
        roomCode: normalizedCode || generateRoomCode(),
        gameId: 'picture-clue-party',
        skipLobby: true,
        profile: customProfile,
      } as any);

      if (hasNameTaken(trimmedName, me?.id)) {
        setError(`The name "${trimmedName}" is already in use. Please choose a different name.`);
        me?.leaveRoom();
        setJoined(false);
        setRoomCode(undefined);
        return;
      }

      setJoined(true);
      setRoomCode(getRoomCode());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to room.');
    }
  };

  const dropPlayer = (playerId: string) => {
    if (!isCurrentHost) return;
    const playerToDrop = players.find((player) => player.id === playerId);
    if (!playerToDrop || playerToDrop.id === me?.id) return;

    const nameToDrop = playerToDrop.getProfile().name || 'this player';
    if (window.confirm(`Remove ${nameToDrop} from the room?`)) {
      playerToDrop.kick();
    }
  };

  const createRoom = () => {
    setupRoom(generateRoomCode());
  };

  const joinRoom = () => {
    setupRoom(joinInput.trim());
  };

  useEffect(() => {
    localStorage.setItem('picture-clue-player-name', playerName.trim());
  }, [playerName]);

  useEffect(() => {
    if (previousPhaseRef.current !== phase && phase === 'round') {
      setSubmissions([]);
      setGuesses([]);
      setGuessMap({});
      setMySubmission('');
      setMySubmittedThisRound(false);
      setLocalAssignments({});
      setSharedAssignments({});
      setVoteFinishedByPlayer({});
      setScoreCelebration(null);
    }

    previousPhaseRef.current = phase;
  }, [phase, setSharedAssignments, setScoreCelebration, setVoteFinishedByPlayer, setSubmissions, setGuesses]);

  const resetRoundVoteState = () => {
    setSubmissions([]);
    setGuesses([]);
    setGuessMap({});
    setMySubmission('');
    setMySubmittedThisRound(false);
    setLocalAssignments({});
    setSharedAssignments({});
    setVoteFinishedByPlayer({});
    setScoreCelebration(null);

    if (me) {
      me.setState('submitted', false);
      me.setState('myText', '');
    }
  };

  const startRound = () => {
    const roundPlayers = players;
    const prompt = `Describe the element you add to this scene`;
    setActivePrompt(prompt);
    setSubmissions([]);
    setGuesses([]);
    resetRoundVoteState();
    setError('');
    setPhase('round');
    setImageIndex((imageIndex + 1) % PICTURES.length);

    roundPlayers.forEach((player) => {
      player.setState('submitted', false);
      player.setState('myText', '');
      player.setState('guess', '');
      player.setState('voteAssignments', {});
    });
  };

  const submitText = () => {
    const trimmedText = mySubmission.trim();
    if (!trimmedText) return;
    if (submissions.some((submission) => submission.playerId === me?.id)) return;
    if (submissions.some((submission) => submission.text.toLowerCase() === trimmedText.toLowerCase())) {
      setError('That clue is already in use by another player.');
      return;
    }

    const authorName = me?.getProfile().name || playerName || 'Player';
    const entry: Submission = {
      playerId: me?.id || 'me',
      playerName: authorName,
      text: trimmedText,
    };

    const existing = submissions.filter((item) => item.playerId !== entry.playerId);
    setSubmissions([...existing, entry]);
    setMySubmittedThisRound(true);
    me?.setState('submitted', true);
    me?.setState('myText', entry.text);
    setMySubmission('');
    setError('');
  };

  const submitGuess = (submission: Submission, guessedPlayerId?: string) => {
    const currentMe = myPlayer();
    const finalGuessId = guessedPlayerId || submission.playerId;
    const guessResult: GuessResult = {
      playerId: currentMe?.id || 'me',
      guess: finalGuessId,
      correct: finalGuessId === submission.playerId,
    };

    setGuesses([...guesses, guessResult]);
    setGuessMap((prev) => ({ ...prev, [currentMe?.id || 'me']: finalGuessId }));
    currentMe?.setState('guess', finalGuessId);
  };

  const finishRound = () => {
    setPhase('results');
  };

  useEffect(() => {
    if (!players.length) return;

    const nextNumbers = { ...playerNumbers };
    let changed = false;

    players.forEach((player) => {
      if (nextNumbers[player.id] === undefined) {
        const nextNumber = Object.keys(nextNumbers).length + 1;
        nextNumbers[player.id] = nextNumber;
        changed = true;
      }
    });

    if (changed) {
      setPlayerNumbers(nextNumbers);
    }
  }, [players, playerNumbers, setPlayerNumbers]);

  const currentPlayers = useMemo(() => players.map((player, index) => ({
    id: player.id,
    name: player.getProfile().name || 'Player',
    number: playerNumbers[player.id] ?? index + 1,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
  })), [players, playerNumbers]);

  const hasCurrentPlayerFinished = !!me?.id && !!voteFinishedByPlayer[me.id];
  const allVotesLocked = currentPlayers.length > 0 && currentPlayers.every((player) => voteFinishedByPlayer[player.id]);
  const canEditVotes = !hasCurrentPlayerFinished && !allVotesLocked;

  const otherPlayers = currentPlayers.filter((player) => player.id !== me?.id);
  const usedGuessIds = Object.values(localAssignments ?? {}).flat();
  const hasAllCardsDispatched = otherPlayers.length === 0 || otherPlayers.every((player) => usedGuessIds.includes(player.id));
  const guessCards = useMemo(
    () => currentPlayers.filter((player) => player.id !== me?.id && !usedGuessIds.includes(player.id)),
    [currentPlayers, me?.id, usedGuessIds],
  );

  const handleGuessDrop = (targetSubmissionId: string, guessedPlayerId: string, sourceSubmissionId: string | null = null) => {
    if (!canEditVotes || guessedPlayerId === me?.id) return;

    setLocalAssignments((current) => {
      const next = { ...current };
      next[targetSubmissionId] = [guessedPlayerId];

      if (sourceSubmissionId && sourceSubmissionId !== targetSubmissionId) {
        const sourceList = (next[sourceSubmissionId] ?? []).filter((id) => id !== guessedPlayerId);
        if (sourceList.length > 0) {
          next[sourceSubmissionId] = sourceList;
        } else {
          delete next[sourceSubmissionId];
        }
      }

      return next;
    });
  };

  const withdrawGuess = (submissionId: string, guessedPlayerId: string) => {
    if (!canEditVotes) return;

    setLocalAssignments((current) => {
      const next = { ...current };
      const sourceList = (next[submissionId] ?? []).filter((id) => id !== guessedPlayerId);

      if (sourceList.length > 0) {
        next[submissionId] = sourceList;
      } else {
        delete next[submissionId];
      }

      return next;
    });
  };

  const finishVote = () => {
    if (!me?.id || hasCurrentPlayerFinished || allVotesLocked || !hasAllCardsDispatched) return;

    me.setState('voteAssignments', localAssignments);

    const pointsEarned = calculateVoteScoreFromAssignments(localAssignments);
    if (pointsEarned > 0) {
      const nextScores: Record<string, number> = { ...(scoreBoard ?? {}) };
      nextScores[me.id] = (nextScores[me.id] || 0) + pointsEarned;
      setScoreBoard(nextScores);
      setScoreCelebration({ playerId: me.id, points: pointsEarned });
      void playHappyScoreTone();
      window.setTimeout(() => {
        if (scoreCelebration?.playerId === me.id) {
          setScoreCelebration(null);
        }
      }, 1800);
    }

    const nextVoteState: Record<string, boolean> = { ...(voteFinishedByPlayer ?? {}) };
    nextVoteState[me.id] = true;
    setVoteFinishedByPlayer(nextVoteState);
  };

  useEffect(() => {
    if (!allVotesLocked) return;

    const nextSharedAssignments: Record<string, VoteEntry[]> = {};
    const nextGuesses = buildGuessResultsFromAssignments(players);

    players.forEach((player) => {
      const voteAssignments = (player.getState('voteAssignments') ?? {}) as Record<string, string[]>;

      Object.entries(voteAssignments).forEach(([submissionId, guessedPlayerIds]) => {
        const primaryGuess = guessedPlayerIds.slice(0, 1);
        primaryGuess.forEach((guessedPlayerId) => {
          nextSharedAssignments[submissionId] = [
            ...(nextSharedAssignments[submissionId] ?? []),
            { voterId: player.id, guessedPlayerId },
          ];
        });
      });
    });

    setGuesses(nextGuesses);
    setSharedAssignments(nextSharedAssignments);
    setPhase('results');
  }, [allVotesLocked, players, setGuesses, setSharedAssignments, setPhase]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      setDragState((current) => current
        ? { ...current, x: event.clientX, y: event.clientY }
        : current);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const slot = target?.closest('[data-drop-slot="true"]');
      const submissionId = slot?.getAttribute('data-submission-id');

      if (slot && submissionId) {
        handleGuessDrop(submissionId, dragState.playerId, dragState.sourceSubmissionId);
        setDragState(null);
        return;
      }

      if (dragState.sourceSubmissionId) {
        withdrawGuess(dragState.sourceSubmissionId, dragState.playerId);
      }

      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, submissions, localAssignments, sharedAssignments, me?.id]);

  const myDisplayName = me?.getProfile().name || playerName || 'Player';
  const mySubmittedText = submissions.find((submission) => submission.playerId === me?.id)?.text || '';
  const hasMySubmissionLocked = mySubmittedThisRound;
  const showLobby = !joined;
  const roomLabel = roomCode ? `Room code: ${roomCode}` : 'No room yet';
  const celebratingPlayerId = scoreCelebration?.playerId ?? null;

  if (showLobby) {
    return (
      <div className="app-shell">
        <div className="panel">
          <h1>Picture Clue Party</h1>
          <p>Create a room or join with a code to start a guessing round.</p>

          <label>
            Player name
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Your name" />
          </label>

          <div className="button-row">
            <button onClick={createRoom}>Create room</button>
          </div>

          <div className="join-row">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="Enter 3-digit room code"
              inputMode="numeric"
            />
            <button onClick={joinRoom}>Join</button>
          </div>

          {error && <div className="error">{error}</div>}
          {roomCode && <div className="room-badge">{roomLabel}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="player-top-name-wrap">
        <div className="player-top-name">{myDisplayName}</div>
        {mySubmittedText && <div className="player-top-text">{mySubmittedText}</div>}
      </div>
      <div className="panel">
        <header className="top-bar">
          <div>
            <strong>{roomLabel}</strong>
          </div>
          <div className="host-pill">{isCurrentHost ? 'Host' : 'Player'}</div>
        </header>

        {scoreCelebration && scoreCelebration.playerId === me?.id && (
          <div className="score-celebration" role="status" aria-live="polite">
            +{scoreCelebration.points} point{scoreCelebration.points === 1 ? '' : 's'}! Great guess!
          </div>
        )}

        <div className="scoreboard">
          {currentPlayers.map((player) => (
            <div key={player.id} className={`score-card ${celebratingPlayerId === player.id ? 'score-card-celebrate' : ''}`}>
              <div className="player-label-wrap">
                <span className="player-index-badge" style={{ background: player.color }}>{player.number}</span>
                <span>{player.name}</span>
              </div>
              <strong>{scoreBoard[player.id] || 0}</strong>
            </div>
          ))}
        </div>

        {phase === 'lobby' && (
          <div className="section">
            <h2>Waiting for players</h2>
            <ul className="player-list">
              {currentPlayers.map((player) => (
                <li key={player.id} className="player-list-item">
                  <div className="player-list-main">
                    <span className="player-index-badge" style={{ background: player.color }}>{player.number}</span>
                    <span>{player.name}</span>
                  </div>
                  {isCurrentHost && player.id !== me?.id && (
                    <button type="button" className="kick-button" onClick={() => dropPlayer(player.id)}>
                      Drop
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isCurrentHost && (
              <button onClick={startRound}>Start round</button>
            )}
          </div>
        )}

        {phase === 'round' && (
          <div className="section">
            <img src={PICTURES[imageIndex]} alt="Scene prompt" className="prompt-image" />
            <p className="prompt-text">{activePrompt}</p>

            <div className="submit-box">
              <input
                value={mySubmission}
                onChange={(e) => {
                  if (!hasMySubmissionLocked) {
                    setMySubmission(e.target.value);
                    if (error) setError('');
                  }
                }}
                placeholder="Add a few words"
                disabled={hasMySubmissionLocked}
              />
              <button onClick={submitText} disabled={hasMySubmissionLocked}>
                {hasMySubmissionLocked ? 'Submitted' : 'Submit'}
              </button>
            </div>
            {error && <div className="submit-error">{error}</div>}

            {canEditVotes && (
              <div className="guess-card-tray">
                {guessCards.map((player) => (
                  <div
                    key={player.id}
                    className="guess-card"
                    draggable={false}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setDragState({ playerId: player.id, sourceSubmissionId: null, x: event.clientX, y: event.clientY });
                    }}
                    style={dragState?.playerId === player.id ? {
                      opacity: 0,
                      pointerEvents: 'none',
                    } : {
                      borderColor: `${player.color}99`,
                      boxShadow: `0 0 0 1px ${player.color}55`,
                    }}
                  >
                    <span className="player-index-badge small-badge" style={{ background: player.color }}>{player.number}</span>
                    <span className="guess-card-name">{player.name}</span>
                  </div>
                ))}

                {dragState && (() => {
                  const draggingPlayer = currentPlayers.find((player) => player.id === dragState.playerId);
                  if (!draggingPlayer) return null;

                  return (
                    <div
                      className="guess-card dragging-card"
                      style={{
                        position: 'fixed',
                        left: dragState.x - 60,
                        top: dragState.y - 18,
                        zIndex: 1000,
                        pointerEvents: 'none',
                        borderColor: `${draggingPlayer.color}99`,
                        boxShadow: `0 0 0 1px ${draggingPlayer.color}55`,
                      }}
                    >
                      <span className="player-index-badge small-badge" style={{ background: draggingPlayer.color }}>{draggingPlayer.number}</span>
                      <span>{draggingPlayer.name}</span>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="guess-panel">
              {submissions.map((submission) => {
                const isOwnSubmission = submission.playerId === me?.id;
                const visibleVotes = allVotesLocked
                  ? (sharedAssignments?.[submission.playerId] ?? [])
                  : (localAssignments?.[submission.playerId] ?? []).map((guessedPlayerId) => ({
                      voterId: me?.id || 'me',
                      guessedPlayerId,
                    }));

                return (
                  <div key={submission.playerId} className="submission-item anonymous-item">
                    <div className="anonymous-text">{submission.text}</div>

                    <div className="guess-slot-row">
                      {visibleVotes.map((vote) => {
                        const player = currentPlayers.find((item) => item.id === vote.guessedPlayerId);
                        if (!player) return null;

                        const isCorrectGuess = vote.guessedPlayerId === submission.playerId;
                        const shouldRevealName = allVotesLocked || vote.voterId === me?.id;
                        const showResult = (allVotesLocked || hasCurrentPlayerFinished) && vote.voterId === me?.id && !!vote;

                        return (
                          <div
                            key={`${submission.playerId}-${vote.voterId}-${vote.guessedPlayerId}`}
                            className={`guess-card mini-card ${showResult && isCorrectGuess ? 'correct-card' : ''} ${showResult && !isCorrectGuess ? 'incorrect-card' : ''} ${!shouldRevealName ? 'hidden-card-back' : ''}`}
                            style={shouldRevealName ? { borderColor: `${player.color}99`, boxShadow: `0 0 0 1px ${player.color}44` } : undefined}
                            onPointerDown={(event) => {
                              if (!canEditVotes) return;
                              event.preventDefault();
                              setDragState({
                                playerId: player.id,
                                sourceSubmissionId: submission.playerId,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          >
                            <span className="player-index-badge small-badge" style={{ background: player.color, display: shouldRevealName ? 'inline-flex' : 'none' }}>{player.number}</span>
                            <span className="guess-card-name">{shouldRevealName ? player.name : 'Hidden'}</span>
                            {showResult && (
                              <span className="vote-badge" aria-label={isCorrectGuess ? 'Correct guess' : 'Incorrect guess'}>
                                {isCorrectGuess ? '✓' : '✕'}
                              </span>
                            )}
                          </div>
                        );
                      })}

                      {!isOwnSubmission && canEditVotes && visibleVotes.length === 0 && (
                        <div
                          className="drop-slot"
                          data-drop-slot="true"
                          data-submission-id={submission.playerId}
                        >
                          <span>Drop name</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!hasCurrentPlayerFinished && !allVotesLocked && (
              <button onClick={finishVote} disabled={!hasAllCardsDispatched}>
                Finish vote
              </button>
            )}

            {!allVotesLocked && Object.values(voteFinishedByPlayer).filter(Boolean).length > 0 && (
              <div className="submit-error" style={{ marginTop: '0.75rem' }}>
                Waiting for the other players to finish voting.
              </div>
            )}

            {allVotesLocked && (
              <div className="section" style={{ marginTop: '1rem' }}>
                <h3>Final vote summary</h3>
                {submissions.map((submission) => (
                  <div key={submission.playerId} className="result-item">
                    <strong>{submission.playerName}</strong>
                    <span>{submission.text}</span>
                    <small>{(sharedAssignments?.[submission.playerId] ?? []).length} vote{(sharedAssignments?.[submission.playerId] ?? []).length === 1 ? '' : 's'}</small>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {phase === 'results' && (
          <div className="section">
            <h2>Round results</h2>

            <div className="results-grid">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Text</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => (
                    <tr key={submission.playerId}>
                      <td>{submission.text}</td>
                      <td>{submission.playerName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="votes-table-wrap">
                <table className="votes-table">
                  <thead>
                    <tr>
                      <th>Votes</th>
                      {currentPlayers.map((player) => (
                        <th key={player.id}>{player.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((submission) => (
                      <tr key={submission.playerId}>
                        <th>{submission.text}</th>
                        {currentPlayers.map((player) => {
                          const vote = (sharedAssignments?.[submission.playerId] ?? []).find((entry) => entry.voterId === player.id);
                          const guessedPlayer = currentPlayers.find((candidate) => candidate.id === vote?.guessedPlayerId);
                          const isCorrect = vote?.guessedPlayerId === submission.playerId;

                          return (
                            <td
                              key={`${submission.playerId}-${player.id}`}
                              className={isCorrect ? 'correct-vote-cell' : 'incorrect-vote-cell'}
                            >
                              <span className="vote-result-badge" aria-label={isCorrect ? 'Correct vote' : 'Incorrect vote'}>
                                {isCorrect ? '✓' : '✕'}
                              </span>
                              {guessedPlayer ? guessedPlayer.name : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {isCurrentHost && (
              <button onClick={() => {
                resetRoundVoteState();
                setPhase('lobby');
              }}>Next round</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
