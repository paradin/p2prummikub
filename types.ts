
export enum TileColor {
  Red = 'Red',
  Blue = 'Blue',
  Orange = 'Orange',
  Black = 'Black',
  Joker = 'Joker'
}

export interface Tile {
  id: string;
  number: number; // 1-13
  color: TileColor;
  isJoker: boolean;
}

export type TileSet = Tile[];

export interface GameState {
  board: TileSet[];
  playerHand: Tile[];
  aiHands: Tile[][]; 
  pool: Tile[];
  currentPlayerIndex: number;
  hasMeld: boolean[];
  winner: number | null;
  message: string;
  isMultiplayer: boolean;
  playerRole: 'host' | 'client' | 'single';
  myPlayerIndex: number;
  gameStarted: boolean;
  humanPlayers: number[]; // Indices of players controlled by humans (Host is always 0)
}

export interface NetworkMessage {
  type: 'UPDATE_STATE' | 'ACTION_MOVE' | 'ACTION_DRAW' | 'ACTION_END_TURN' | 'START_GAME';
  payload: any;
  fromIndex: number;
}
