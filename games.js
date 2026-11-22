'use strict';
/*
 * Playbooks and small offline solvers for on-screen games.
 * start_game hands the model the playbook that matches the game's name, so the main prompt stays short
 * and every game still gets specific advice. Unknown games get the general playbook.
 */

const GENERAL = [
  'GENERAL: ONE look_at_screen first. Read the whole screen (rules, timer, score, buttons) before acting.',
  'Then loop with no chatter: decide, act, read the screenshot that comes back with game_keys / click_many / drag_screen / chess_play. Never call look_at_screen right after those: they already return a picture.',
  'Batch actions: type a whole word in one game_keys call, click several tiles in ONE click_many call, drag a whole path in ONE drag_screen call. Fewer calls is faster and uses fewer steps.',
  'Accuracy beats speed unless there is a visible timer. Think properly about each move; a wrong move often costs a life or the game.',
  'Never repeat a move the game already rejected. If a screenshot shows the same state twice, something is wrong: look for a pop-up, a closed keyboard focus, or the wrong window in front, then fix that.',
  'Use the game\'s keyboard controls where they exist, because they are faster and more reliable than clicking.',
  'Only single-player, practice or casual games. Never anything with money, an account, a login, a purchase or an ad: stop and tell the user. Do not ask the user between moves; only speak when the game ends (end_game), then give the result in one or two lines.',
].join('\n');

const BOOKS = [
  { id: 'wordle', re: /wordle|quordle|octordle|dordle|^word game$/i, text:
`WORDLE: 6 tries, 5-letter real English words. Open with "crane" or "slate". Green = right letter, right place; yellow = in the word but elsewhere; grey = not in the word (careful with repeated letters: a grey copy of a letter that is also green/yellow only means no EXTRA copy).
After each result write down: known greens by position, yellows with the positions they are NOT in, greys. Never repeat a guess. Guess only words that fit ALL the clues so far; by guess 3-4 prefer a word that also splits the remaining candidates. Type the whole word with game_keys text and keys ["enter"]. If a word is rejected, backspace it (keys 5x "backspace") and try another real word.
Variants: Quordle/Octordle = several boards share each guess (9 or 13 guesses): pick words that help all open boards. Waffle/Letter Boxed/Heardle are different games: read their rules first.` },
  { id: 'connections', re: /connections/i, text:
`CONNECTIONS (NYT): 16 words, find four groups of four that share a link. 4 mistakes allowed. Groups run from easy (yellow) to tricky (purple); words are chosen to fit several groups (red herrings), so a group is only safe when its four words fit and no other word fits it better.
Read all 16 words, list the possible themes (synonyms, hidden words, things that can precede/follow a word, homophones, anagrams, category members), and build the group you are MOST sure of first. Solve easy ones first; the last group is whatever is left.
Select the 4 tiles with ONE click_many call (one point per word, centre of each tile), then click Submit/ Shuffle as needed with a click. "One away" means 3 of the 4 are right: swap exactly one word, do not start over. Never submit the same four words twice. If a click selected the wrong tile, click it again to deselect.` },
  { id: 'spellingbee', re: /spelling ?bee/i, text:
`SPELLING BEE (NYT): 7 letters, one in the centre that EVERY word must contain. Words are at least 4 letters, letters can repeat, no proper nouns, no hyphens. A pangram uses all 7 letters and is worth the most: look for it first.
Type each word with game_keys text "word" and keys ["enter"] (it returns the screenshot). Accepted words appear in the list and the score rises; rejected ones shake and say why (too short, missing the centre letter, not in word list). Do not spam guesses that are likely not in the list (obscure or offensive words are excluded). Work through common endings (-ing, -ed, -er, -ly) and prefixes (re-, un-). Stop when you reach "Genius", run out of ideas, or hit the step limit, and report the rank.` },
  { id: 'crossword', re: /crossword|the mini|nyt mini|mini cross/i, text:
`CROSSWORD / THE MINI: ONE look to read ALL clues (Across and Down) and the grid shape. Answer the clues you are sure of first (fill-in-the-blank, short ones), then use crossing letters to solve the rest. A letter count and the crossings must agree.
Click the first cell of an answer (clicking the same cell again switches Across/Down) and then type the whole answer with game_keys text "answer": the cursor advances by itself. For a check, look at the screenshot returned. Do not use Reveal or Check buttons unless the user asked. If a timer is running there is no penalty for thinking, but be quick. Finish by confirming the puzzle shows as solved.` },
  { id: 'strands', re: /strands/i, text:
`STRANDS (NYT): a 6-wide, 8-tall letter grid with a hidden theme. Find theme words (at least 4 letters) by drawing a path through ADJACENT letters (up, down, left, right AND diagonals, each letter once). One word, the SPANGRAM, crosses the whole grid and describes the theme; every letter is used by exactly one word.
Read the theme clue and the grid carefully with ONE look (use region to zoom if the letters are small). Work out a word, then trace it with ONE drag_screen call: the points are the centre of each letter in order (the first letter first). A valid theme word turns blue; the spangram turns yellow. Words that are real but not in the theme count towards hints, not progress, so do not guess randomly: 3 such words give a hint. Use the spangram and the letters near the edges to find the rest.` },
  { id: 'sudoku', re: /sudoku/i, text:
`SUDOKU: read the 9x9 grid VERY carefully with one look (zoom with region if needed), write it as 81 characters row by row, 0 for empty, and call sudoku_solve. It returns the full solution instantly; do not solve by hand.
Then fill in: click the first empty cell, type its digit with game_keys, and move with the arrow keys ("right", "down"); skip filled cells by pressing the arrow key once more for each. Cells you fill must match the solution exactly. If the board has pencil-mark mode on, turn it off first. After filling, look at the screenshot to confirm the puzzle shows as complete. If sudoku_solve says the grid is invalid you misread a digit: look again, zoomed in.` },
  { id: '2048', re: /2048|sliding tile|slide.?puzzle|threes/i, text:
`2048 / sliding tiles with arrow keys: use game_keys keys with up to 10 arrow presses per call, then read the returned screenshot.
Strategy for 2048: keep your biggest tile in one corner (say bottom-left). Mostly alternate "down" and "left"; use "right" only when you cannot move otherwise (then go "left" again at once); almost never use "up". Keep the bottom row full and ordered. Take 3-5 moves per call while the board is calm and 1-2 when it is crowded. Stop when no move changes the board (game over) and report the highest tile.` },
  { id: 'minesweeper', re: /minesweeper/i, text:
`MINESWEEPER: you can only LEFT-click (reveal); there is no right-click for flags, so mentally keep track of mines instead. A number tells how many of its 8 neighbours are mines. If a number equals the count of hidden neighbours, all are mines; if it equals the mines you have already identified, the other neighbours are safe: reveal them (click_many for several at once). The first click is always safe, so start in the middle. Only click squares you can prove safe; if none, pick the hidden square with the lowest mine probability. Report win or loss.` },
  { id: 'boardgame', re: /tic.?tac.?toe|noughts|connect ?4|connect ?four|checkers|draughts|othello|reversi|gomoku|battleship|mastermind|codebreaker|backgammon/i, text:
`BOARD GAMES (tic-tac-toe, Connect Four, checkers, Othello, ...): after each of your moves wait for the opponent (the screenshot shows their reply; if it still shows your move, call look_at_screen once more after a second). Re-read the whole board from the picture every turn and write it as a grid before choosing a move; do not rely on memory.
Tic-tac-toe: win if you can, else block, else centre, else a corner. Connect Four: win if you can, else block a three-in-a-row, prefer the centre column, avoid giving the opponent a win by stacking on top of your move. Checkers: forced captures are compulsory, keep the back row, king when you can. Click the piece, then the square with ONE click_many call.
Chess has its own tool: chess_play.` },
  { id: 'trivia', re: /trivia|quiz|krillion|jeopardy|game ?show|family feud|millionaire|kahoot|geoguess|worldle|flagle|globle|heardle|guess the|who am i|20 questions|twenty questions|hangman/i, text:
`TRIVIA / QUIZ / GAME SHOWS (Krillion, Jeopardy-style, "guess the ..."): each prompt may have a short timer (Krillion about 25 seconds), so do ONE look per prompt and answer straight away. After game_keys the screenshot of the next prompt comes back with it: use it, do not look again.
Multiple choice: pick the answer, click it (or press its key). Typed answers: spell plainly, no extra words, in the format the prompt asks for (a year, a surname, a country). In rare-answer games like Krillion a valid but LESS obvious answer scores more than the first one everyone thinks of, but never risk an invalid one. In list games (name things in a category) give distinct valid answers. For picture or flag questions describe what you see first, then decide.
Hangman / 20 questions: guess common letters first (e, a, r, i, o, t, n, s), then use the pattern. If you do not know, give your best guess; do not stall. Report the final score.` },
  { id: 'cards', re: /memory|matching|concentration|pairs|solitaire|klondike|freecell|jigsaw|word ?search/i, text:
`MEMORY / MATCHING / SOLITAIRE / WORD SEARCH: memory pairs: turn two cards with ONE click_many call (two points), read the screenshot, REMEMBER every card you have seen with its position, and match known pairs first. Word search: find a word's first letter, follow a straight line (8 directions) and trace it with ONE drag_screen call (first letter to last). Solitaire: dragging a card is drag_screen from the card's centre to the target pile's centre; double-click is not available, so use drag. Read the layout carefully every move.` },
];

function playbookFor(game) {
  const name = String(game || '').toLowerCase().trim();
  const compact = name.replace(/[^a-z0-9 ]/g, '');
  const hit = BOOKS.find((b) => b.re.test(name) || b.re.test(compact) || b.re.test(compact.replace(/ /g, '')));
  return { id: hit ? hit.id : 'general', text: hit ? `${hit.text}\n\n${GENERAL}` : GENERAL };
}

// ---------------------------------------------------------------- Sudoku solver (exact, offline)
function parseGrid(input) {
  const s = String(input == null ? '' : input).replace(/[\s|+\-_,]/g, '').replace(/[.xX*?]/g, '0');
  if (!/^[0-9]{81}$/.test(s)) throw new Error('grid must be exactly 81 characters (digits 1-9, and 0 or . for empty cells), row by row, left to right.');
  return s.split('').map(Number);
}

function solveSudoku(input) {
  const g = parseGrid(input);
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  const bit = (d) => 1 << d;
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    if ((rows[r] | cols[c] | boxes[b]) & bit(d)) throw new Error(`The given digits clash (a ${d} repeats in row ${r + 1}, column ${c + 1} or its box). A digit was probably misread: look again, zoomed in.`);
    rows[r] |= bit(d); cols[c] |= bit(d); boxes[b] |= bit(d);
  }
  const count = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  let solutions = 0, first = null;
  const search = () => {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const r = (i / 9) | 0, c = i % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
      const free = ~(rows[r] | cols[c] | boxes[b]) & 0x3fe; // bits 1..9
      const n = count(free);
      if (n < bestN) { best = i; bestMask = free; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { solutions++; if (!first) first = g.slice(); return solutions > 1; }
    if (bestN === 0) return false;
    const r = (best / 9) | 0, c = best % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & bit(d))) continue;
      g[best] = d; rows[r] |= bit(d); cols[c] |= bit(d); boxes[b] |= bit(d);
      const stop = search();
      g[best] = 0; rows[r] &= ~bit(d); cols[c] &= ~bit(d); boxes[b] &= ~bit(d);
      if (stop) return true;
    }
    return false;
  };
  search();
  if (!first) throw new Error('No solution exists for that grid, so a digit was probably misread. Look again, zoomed in, and check every row.');
  const rowsOut = [];
  for (let r = 0; r < 9; r++) rowsOut.push(first.slice(r * 9, r * 9 + 9).join(''));
  return { solution: rowsOut.join(''), rows: rowsOut, unique: solutions === 1 };
}

module.exports = { playbookFor, solveSudoku, parseGrid, GENERAL, BOOKS };
