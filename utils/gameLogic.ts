
import { Tile, TileColor, TileSet } from '../types';

export const createDeck = (): Tile[] => {
  const deck: Tile[] = [];
  const colors = [TileColor.Red, TileColor.Blue, TileColor.Orange, TileColor.Black];
  
  for (let set = 0; set < 2; set++) {
    for (const color of colors) {
      for (let num = 1; num <= 13; num++) {
        deck.push({
          id: `${color}-${num}-${set}`,
          number: num,
          color,
          isJoker: false
        });
      }
    }
  }
  
  deck.push({ id: 'joker-1', number: 0, color: TileColor.Joker, isJoker: true });
  deck.push({ id: 'joker-2', number: 0, color: TileColor.Joker, isJoker: true });
  
  return shuffle(deck);
};

export const shuffle = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

/**
 * Sorts a set of tiles based on whether it is a Run (same color, sequential numbers)
 * or a Group (same number, different colors).
 */
export const sortTileSet = (set: TileSet): TileSet => {
  const nonJokers = set.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return set;

  // Check if it's likely a group (all same number)
  const isGroup = nonJokers.every(t => t.number === nonJokers[0].number);
  
  return [...set].sort((a, b) => {
    if (a.isJoker && !b.isJoker) return 1;
    if (!a.isJoker && b.isJoker) return -1;
    if (a.isJoker && b.isJoker) return 0;
    
    if (isGroup) {
      return a.color.localeCompare(b.color);
    } else {
      return a.number - b.number;
    }
  });
};

export const sortHand = (hand: Tile[], type: 'number' | 'color'): Tile[] => {
  return [...hand].sort((a, b) => {
    if (a.isJoker && !b.isJoker) return 1;
    if (!a.isJoker && b.isJoker) return -1;
    if (a.isJoker && b.isJoker) return 0;

    if (type === 'number') {
      if (a.number !== b.number) return a.number - b.number;
      return a.color.localeCompare(b.color);
    } else {
      if (a.color !== b.color) return a.color.localeCompare(b.color);
      return a.number - b.number;
    }
  });
};

export const isValidSet = (set: TileSet): boolean => {
  if (set.length < 3) return false;

  const nonJokers = set.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return set.length <= 4;

  const isGroup = () => {
    if (set.length > 4) return false;
    const num = nonJokers[0].number;
    const colors = new Set<TileColor>();
    for (const t of set) {
      if (!t.isJoker) {
        if (t.number !== num) return false;
        if (colors.has(t.color)) return false;
        colors.add(t.color);
      }
    }
    return true;
  };

  const isRun = () => {
    if (set.length > 13) return false;
    const color = nonJokers[0].color;
    if (nonJokers.some(t => t.color !== color)) return false;

    const sortedNonJokers = [...nonJokers].sort((a, b) => a.number - b.number);
    for (let i = 0; i < sortedNonJokers.length - 1; i++) {
      if (sortedNonJokers[i].number === sortedNonJokers[i+1].number) return false;
    }

    const minNum = sortedNonJokers[0].number;
    const maxNum = sortedNonJokers[sortedNonJokers.length - 1].number;
    const span = maxNum - minNum + 1;
    if (span > set.length) return false;
    return Math.max(1, maxNum - set.length + 1) <= Math.min(13 - set.length + 1, minNum);
  };

  return isGroup() || isRun();
};

export const calculateSetPoints = (set: TileSet): number => {
  const nonJokers = set.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return 0;

  const firstNum = nonJokers[0].number;
  const isGroup = nonJokers.every(t => !t.isJoker && t.number === firstNum);

  if (isGroup) {
    return firstNum * set.length;
  } else {
    const sorted = [...nonJokers].sort((a, b) => a.number - b.number);
    let internalGaps = 0;
    for(let i=0; i<sorted.length-1; i++) {
        internalGaps += (sorted[i+1].number - sorted[i].number - 1);
    }
    let jokersLeft = set.length - nonJokers.length - internalGaps;
    const leftPush = Math.min(jokersLeft, sorted[0].number - 1);
    const start = sorted[0].number - leftPush;
    return (set.length / 2) * (2 * start + set.length - 1);
  }
};

export const aiPlayTurn = (hand: Tile[], board: TileSet[], hasMeld: boolean): { newHand: Tile[], newBoard: TileSet[], madeMove: boolean } => {
  let currentHand = [...hand];
  let currentBoard = board.map(s => [...s]);
  let madeMove = false;
  let currentTurnPoints = 0;

  const tryPlaySet = (set: TileSet) => {
    const points = calculateSetPoints(set);
    if (hasMeld || (currentTurnPoints + points >= 30)) {
      currentBoard.push(set);
      const setIds = new Set(set.map(s => s.id));
      currentHand = currentHand.filter(t => !setIds.has(t.id));
      currentTurnPoints += points;
      madeMove = true;
      if (currentTurnPoints >= 30) hasMeld = true;
      return true;
    }
    return false;
  };

  // 1. Try to find groups (Greedy)
  const numMap: Record<number, Tile[]> = {};
  currentHand.forEach(t => {
    if (!t.isJoker) {
      if (!numMap[t.number]) numMap[t.number] = [];
      numMap[t.number].push(t);
    }
  });

  for (const numStr in numMap) {
    const tiles = numMap[parseInt(numStr)];
    const uniqueByColor: Tile[] = [];
    const colors = new Set();
    tiles.forEach(t => { if (!colors.has(t.color)) { colors.add(t.color); uniqueByColor.push(t); }});
    
    if (uniqueByColor.length >= 3) {
      tryPlaySet(uniqueByColor.slice(0, 3));
    } else if (uniqueByColor.length === 2 && currentHand.some(t => t.isJoker)) {
      const joker = currentHand.find(t => t.isJoker)!;
      tryPlaySet([...uniqueByColor.slice(0, 2), joker]);
    }
  }

  // 2. Try to find runs
  const colors = [TileColor.Red, TileColor.Blue, TileColor.Orange, TileColor.Black];
  colors.forEach(color => {
    const colorTiles = currentHand.filter(t => t.color === color).sort((a, b) => a.number - b.number);
    for (let i = 0; i < colorTiles.length; i++) {
      let run = [colorTiles[i]];
      for (let j = i + 1; j < colorTiles.length; j++) {
        if (colorTiles[j].number === run[run.length - 1].number + 1) {
          run.push(colorTiles[j]);
        } else if (colorTiles[j].number > run[run.length - 1].number + 1) {
          break;
        }
      }
      if (run.length >= 3) {
        if (tryPlaySet(run)) break;
      }
    }
  });

  // 3. Try to append to existing board sets
  if (hasMeld) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < currentBoard.length; i++) {
        for (let j = 0; j < currentHand.length; j++) {
          const tile = currentHand[j];
          const testSet = [...currentBoard[i], tile];
          if (isValidSet(testSet)) {
            currentBoard[i] = sortTileSet(testSet);
            currentHand.splice(j, 1);
            madeMove = true;
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
  }

  return { newHand: currentHand, newBoard: currentBoard, madeMove };
};
