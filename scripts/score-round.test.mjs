import assert from 'node:assert/strict';
import * as scoreUtils from '../src/scoreUtils.ts';

const { buildGuessResultsFromAssignments, calculateRoundScores, calculateVoteScoreFromAssignments } = scoreUtils;

const submissions = [
  { playerId: 'p1', playerName: 'Alice', text: 'sun' },
  { playerId: 'p2', playerName: 'Bob', text: 'tree' },
];

const players = [
  { id: 'p1', getState: () => ({ p1: ['p1'], p2: ['p2'] }) },
  { id: 'p2', getState: () => ({ p1: ['p1'], p2: ['p2'] }) },
  { id: 'p3', getState: () => ({ p1: ['p1'], p2: ['p1'] }) },
];

const guessResults = buildGuessResultsFromAssignments(players);

assert.deepEqual(
  guessResults,
  [
    { playerId: 'p1', guess: 'p1', correct: true },
    { playerId: 'p1', guess: 'p2', correct: true },
    { playerId: 'p2', guess: 'p1', correct: true },
    { playerId: 'p2', guess: 'p2', correct: true },
    { playerId: 'p3', guess: 'p1', correct: true },
    { playerId: 'p3', guess: 'p1', correct: false },
  ],
  'final guess results should be reconstructed from each player’s saved vote assignments',
);

const guesses = [
  { playerId: 'p2', guess: 'p1', correct: true },
  { playerId: 'p3', guess: 'p1', correct: true },
  { playerId: 'p1', guess: 'p2', correct: false },
];

const result = calculateRoundScores(submissions, guesses, { p1: 0, p2: 1, p3: 0 });

assert.equal(result.p1, 0, 'Alice should not receive a point just for writing the clue');
assert.equal(result.p2, 2, 'Bob should keep his prior score and only get points for correct guesses');
assert.equal(result.p3, 1, 'The correct guesser should receive one point');

const voteScore = calculateVoteScoreFromAssignments({
  p1: ['p1'],
  p2: ['p3'],
  p3: ['p3'],
}, { p1: 0, p2: 1, p3: 0 });

assert.equal(voteScore, 2, 'A player should score one point for each correct vote they submit immediately');

console.log('score-round regression test passed');
