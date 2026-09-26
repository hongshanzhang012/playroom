type RoundSubmission = {
  playerId: string;
  playerName?: string;
  text?: string;
};

type RoundGuess = {
  playerId: string;
  guess: string;
  correct: boolean;
};

type RoundPlayer = {
  id: string;
  getState?: (key: string) => unknown;
};

export function buildGuessResultsFromAssignments(
  players: RoundPlayer[],
): RoundGuess[] {
  const results: RoundGuess[] = [];

  players.forEach((player) => {
    const voteAssignments = (player.getState?.('voteAssignments') ?? {}) as Record<string, string[]>;

    Object.entries(voteAssignments).forEach(([submissionId, guessedPlayerIds]) => {
      const scopedGuesses = Array.isArray(guessedPlayerIds) ? guessedPlayerIds : [guessedPlayerIds];

      scopedGuesses.slice(0, 1).forEach((guessedPlayerId) => {
        results.push({
          playerId: player.id,
          guess: guessedPlayerId,
          correct: guessedPlayerId === submissionId,
        });
      });
    });
  });

  return results;
}

export function calculateVoteScoreFromAssignments(
  voteAssignments: Record<string, string[]>,
): number {
  return Object.entries(voteAssignments).reduce((total, [submissionId, guessedPlayerIds]) => {
    const selected = Array.isArray(guessedPlayerIds) ? guessedPlayerIds[0] : guessedPlayerIds;
    if (selected === submissionId) {
      return total + 1;
    }

    return total;
  }, 0);
}

export function calculateRoundScores(
  submissions: RoundSubmission[],
  guesses: RoundGuess[],
  currentScores: Record<string, number> = {},
): Record<string, number> {
  const nextScores: Record<string, number> = { ...currentScores };

  guesses.forEach((guess) => {
    if (!guess.correct) return;
    nextScores[guess.playerId] = (nextScores[guess.playerId] || 0) + 1;
  });

  return nextScores;
}
