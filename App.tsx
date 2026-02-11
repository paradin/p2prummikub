
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Tile, TileSet, GameState, NetworkMessage, TileColor } from './types';
import { createDeck, isValidSet, calculateSetPoints, sortHand, aiPlayTurn } from './utils/gameLogic';
import TileComponent from './components/TileComponent';
import { P2PConnection } from './utils/webrtc';

const INITIAL_HAND_SIZE = 14;

const getInitialGameState = (role: 'host' | 'client' | 'single' = 'single'): GameState => {
  return {
    board: [],
    playerHand: [],
    aiHands: [[], [], []],
    pool: [],
    currentPlayerIndex: 0,
    hasMeld: [false, false, false, false],
    winner: null,
    message: role === 'client' ? "Connected! Waiting for host to start..." : "Welcome! Invite friends or play against AI.",
    isMultiplayer: role !== 'single',
    playerRole: role,
    myPlayerIndex: 0,
    gameStarted: false,
  };
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(() => getInitialGameState());
  const [gameId, setGameId] = useState(0);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Network State
  const connections = useRef<Map<number, P2PConnection>>(new Map());
  const [offerText, setOfferText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [remoteOffer, setRemoteOffer] = useState("");
  const [connectedPlayers, setConnectedPlayers] = useState<number[]>([]);

  const [selectedInHand, setSelectedInHand] = useState<Set<string>>(new Set());
  const [turnPoints, setTurnPoints] = useState(0);

  const isMyTurn = gameState.currentPlayerIndex === gameState.myPlayerIndex && gameState.gameStarted && gameState.winner === null;
  const isHost = gameState.playerRole === 'host' || gameState.playerRole === 'single';

  // Broadcast state to all clients (Host only)
  const broadcastState = useCallback((state: GameState) => {
    if (state.playerRole !== 'host') return;
    connections.current.forEach((conn, index) => {
      const clientView: GameState = {
        ...state,
        playerHand: state.aiHands[index - 1],
        aiHands: [
          state.playerHand,
          ...state.aiHands.filter((_, i) => i !== index - 1)
        ],
        myPlayerIndex: index,
        playerRole: 'client'
      };
      conn.send({ type: 'UPDATE_STATE', payload: clientView });
    });
  }, []);

  const handleStartGame = () => {
    if (!isHost) return;
    const deck = createDeck();
    const newState: GameState = {
      ...gameState,
      gameStarted: true,
      pool: deck,
      playerHand: deck.splice(0, INITIAL_HAND_SIZE),
      aiHands: [
        deck.splice(0, INITIAL_HAND_SIZE),
        deck.splice(0, INITIAL_HAND_SIZE),
        deck.splice(0, INITIAL_HAND_SIZE),
      ],
      currentPlayerIndex: 0,
      board: [],
      hasMeld: [false, false, false, false],
      winner: null,
      message: "Game started! Good luck.",
    };
    setGameState(newState);
    broadcastState(newState);
  };

  const handleResetGame = () => {
    if (!isHost) return;
    setGameId(prev => prev + 1);
    const deck = createDeck();
    const newState: GameState = {
      ...gameState,
      gameStarted: true,
      pool: deck,
      playerHand: deck.splice(0, INITIAL_HAND_SIZE),
      aiHands: [
        deck.splice(0, INITIAL_HAND_SIZE),
        deck.splice(0, INITIAL_HAND_SIZE),
        deck.splice(0, INITIAL_HAND_SIZE),
      ],
      currentPlayerIndex: 0,
      board: [],
      hasMeld: [false, false, false, false],
      winner: null,
      message: "Game reset! New round started.",
    };
    setGameState(newState);
    setTurnPoints(0);
    setSelectedInHand(new Set());
    broadcastState(newState);
  };

  const handleClientMessage = useCallback((connIdx: number, msg: NetworkMessage) => {
    setGameState(prev => {
      if (prev.playerRole !== 'host') return prev;
      let newState = { ...prev };

      switch (msg.type) {
        case 'ACTION_DRAW':
          if (newState.currentPlayerIndex !== connIdx) return prev;
          const newPool = [...newState.pool];
          if (newPool.length > 0) {
            const drawn = newPool.pop()!;
            const newAiHands = [...newState.aiHands];
            newAiHands[connIdx - 1] = [...newAiHands[connIdx - 1], drawn];
            newState = { ...newState, pool: newPool, aiHands: newAiHands, currentPlayerIndex: (connIdx + 1) % 4, message: `Player ${connIdx} drew.` };
          }
          break;
        case 'ACTION_MOVE':
          if (newState.currentPlayerIndex !== connIdx) return prev;
          const { board, hand, hasMeld } = msg.payload;
          const updatedAiHands = [...newState.aiHands];
          updatedAiHands[connIdx - 1] = hand;
          const updatedHasMeld = [...newState.hasMeld];
          updatedHasMeld[connIdx] = hasMeld;
          newState = { ...newState, board, aiHands: updatedAiHands, hasMeld: updatedHasMeld };
          if (hand.length === 0) newState.winner = connIdx;
          break;
        case 'ACTION_END_TURN':
           if (newState.currentPlayerIndex !== connIdx) return prev;
           newState.currentPlayerIndex = (connIdx + 1) % 4;
           break;
      }
      
      broadcastState(newState);
      return newState;
    });
  }, [broadcastState]); // Completed dependency array and callback body

  // AI Logic for handling computer turns in host or single player mode
  useEffect(() => {
    if (!gameState.gameStarted || gameState.winner !== null) return;
    
    if (gameState.currentPlayerIndex !== 0 && (gameState.playerRole === 'single' || gameState.playerRole === 'host')) {
      const aiIdx = gameState.currentPlayerIndex - 1;
      if (gameState.playerRole === 'host' && connectedPlayers.includes(gameState.currentPlayerIndex)) return;

      const timer = setTimeout(() => {
        setGameState(prev => {
          const currentAiHand = prev.aiHands[aiIdx];
          const hasMeld = prev.hasMeld[prev.currentPlayerIndex];
          
          const { newHand, newBoard, madeMove } = aiPlayTurn(currentAiHand, prev.board, hasMeld);
          
          let nextState = { ...prev };
          if (madeMove) {
            const newAiHands = [...prev.aiHands];
            newAiHands[aiIdx] = newHand;
            const newHasMeld = [...prev.hasMeld];
            newHasMeld[prev.currentPlayerIndex] = true;
            
            nextState = {
              ...prev,
              board: newBoard,
              aiHands: newAiHands,
              hasMeld: newHasMeld,
              message: `AI Player ${prev.currentPlayerIndex} made a move.`
            };
            
            if (newHand.length === 0) {
              nextState.winner = prev.currentPlayerIndex;
            } else {
              nextState.currentPlayerIndex = (prev.currentPlayerIndex + 1) % 4;
            }
          } else {
            const newPool = [...prev.pool];
            if (newPool.length > 0) {
              const drawn = newPool.pop()!;
              const newAiHands = [...prev.aiHands];
              newAiHands[aiIdx] = [...newAiHands[aiIdx], drawn];
              nextState = {
                ...prev,
                pool: newPool,
                aiHands: newAiHands,
                message: `AI Player ${prev.currentPlayerIndex} drew a tile.`
              };
            }
            nextState.currentPlayerIndex = (prev.currentPlayerIndex + 1) % 4;
          }
          
          if (prev.playerRole === 'host') broadcastState(nextState);
          return nextState;
        });
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [gameState.currentPlayerIndex, gameState.gameStarted, gameState.winner, gameState.playerRole, broadcastState, connectedPlayers]);

  const toggleSelect = (id: string) => {
    if (!isMyTurn) return;
    setSelectedInHand(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePlaySet = () => {
    if (!isMyTurn) return;
    const selectedTiles = gameState.playerHand.filter(t => selectedInHand.has(t.id));
    if (selectedTiles.length < 3) {
      setGameState(prev => ({ ...prev, message: "Select at least 3 tiles to form a set." }));
      return;
    }

    if (!isValidSet(selectedTiles)) {
      setGameState(prev => ({ ...prev, message: "Invalid set! Run or Group required." }));
      return;
    }

    const points = calculateSetPoints(selectedTiles);
    const alreadyMelded = gameState.hasMeld[gameState.myPlayerIndex];

    if (!alreadyMelded && turnPoints + points < 30) {
      setGameState(prev => ({ ...prev, message: `Initial meld must be 30+. Current turn points: ${turnPoints + points}` }));
      return;
    }

    setGameState(prev => {
      const newHand = prev.playerHand.filter(t => !selectedInHand.has(t.id));
      const newState = {
        ...prev,
        board: [...prev.board, selectedTiles],
        playerHand: newHand,
        hasMeld: prev.hasMeld.map((m, i) => i === prev.myPlayerIndex ? true : m),
        message: `Played set (${points} pts).`
      };

      if (newHand.length === 0) newState.winner = prev.myPlayerIndex;
      
      if (prev.playerRole === 'client') {
        const conn = Array.from(connections.current.values())[0];
        conn?.send({ 
          type: 'ACTION_MOVE', 
          payload: { board: newState.board, hand: newState.playerHand, hasMeld: true },
          fromIndex: prev.myPlayerIndex
        });
      } else if (prev.playerRole === 'host') {
        broadcastState(newState);
      }

      return newState;
    });

    setTurnPoints(prev => prev + points);
    setSelectedInHand(new Set());
  };

  const handleDraw = () => {
    if (!isMyTurn || turnPoints > 0) return;
    
    setGameState(prev => {
      const newPool = [...prev.pool];
      if (newPool.length === 0) return { ...prev, message: "Pool is empty!" };
      
      const drawn = newPool.pop()!;
      const newState = {
        ...prev,
        playerHand: [...prev.playerHand, drawn],
        pool: newPool,
        currentPlayerIndex: (prev.currentPlayerIndex + 1) % 4,
        message: "Drawn. Next player's turn."
      };

      if (prev.playerRole === 'client') {
        const conn = Array.from(connections.current.values())[0];
        conn?.send({ type: 'ACTION_DRAW', payload: null, fromIndex: prev.myPlayerIndex });
      } else if (prev.playerRole === 'host') {
        broadcastState(newState);
      }

      return newState;
    });
    setTurnPoints(0);
    setSelectedInHand(new Set());
  };

  const handleEndTurn = () => {
    if (!isMyTurn || turnPoints === 0) return;
    setGameState(prev => {
      const newState = {
        ...prev,
        currentPlayerIndex: (prev.currentPlayerIndex + 1) % 4,
        message: "End of turn."
      };
      if (prev.playerRole === 'client') {
        const conn = Array.from(connections.current.values())[0];
        conn?.send({ type: 'ACTION_END_TURN', payload: null, fromIndex: prev.myPlayerIndex });
      } else if (prev.playerRole === 'host') {
        broadcastState(newState);
      }
      return newState;
    });
    setTurnPoints(0);
    setSelectedInHand(new Set());
  };

  const handleSort = (type: 'number' | 'color') => {
    setGameState(prev => ({
      ...prev,
      playerHand: sortHand(prev.playerHand, type)
    }));
  };

  // UI Render Section
  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-6 font-sans text-slate-800">
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-6">
        <h1 className="text-3xl font-extrabold text-indigo-600 tracking-tight">RummyTile</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowHelp(!showHelp)} className="bg-white border px-3 py-1 rounded shadow-sm hover:bg-slate-50">Help</button>
          <button onClick={() => setShowNetwork(!showNetwork)} className="bg-indigo-600 text-white px-3 py-1 rounded shadow hover:bg-indigo-700">Network</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto flex flex-col gap-6">
        <section className="bg-white rounded-xl p-4 min-h-[300px] border shadow-sm relative overflow-auto">
          <h2 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">Game Board</h2>
          <div className="flex flex-wrap gap-4 content-start">
            {gameState.board.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-slate-300 italic py-20">
                Board is empty. Play sets to score!
              </div>
            ) : (
              gameState.board.map((set, i) => (
                <div key={i} className="flex bg-slate-50 p-1.5 rounded-lg border-2 border-slate-100 shadow-sm">
                  {set.map(tile => <TileComponent key={tile.id} tile={tile} size="sm" disabled />)}
                </div>
              ))
            )}
          </div>
        </section>

        <div className={`p-3 rounded-lg text-center font-medium transition-all ${gameState.winner !== null ? 'bg-green-100 text-green-700' : 'bg-indigo-50 text-indigo-600'}`}>
          {gameState.winner !== null 
            ? `Game Over! Player ${gameState.winner} wins!` 
            : `${gameState.message} ${isMyTurn ? '(Your Turn)' : ''}`}
        </div>

        <section className="bg-white rounded-xl p-4 border shadow-sm relative">
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Your Hand ({gameState.playerHand.length})</h2>
            <div className="flex gap-2">
              <button onClick={() => handleSort('number')} className="text-xs bg-slate-100 px-2 py-1 rounded border">Sort 123</button>
              <button onClick={() => handleSort('color')} className="text-xs bg-slate-100 px-2 py-1 rounded border">Sort RGB</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 justify-center min-h-[80px]">
            {gameState.playerHand.map(tile => (
              <TileComponent 
                key={tile.id} 
                tile={tile} 
                onClick={() => toggleSelect(tile.id)}
                selected={selectedInHand.has(tile.id)}
                disabled={!isMyTurn}
              />
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-3 justify-center">
          {!gameState.gameStarted && isHost && (
            <button onClick={handleStartGame} className="bg-green-600 text-white px-8 py-3 rounded-lg font-bold shadow-lg hover:bg-green-700 active:scale-95 transition-all">
              START GAME
            </button>
          )}
          {gameState.gameStarted && (
            <>
              <button onClick={handlePlaySet} disabled={!isMyTurn || selectedInHand.size < 3} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-indigo-700 disabled:opacity-50">PLAY SET</button>
              <button onClick={handleDraw} disabled={!isMyTurn || turnPoints > 0 || gameState.pool.length === 0} className="bg-orange-500 text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-orange-600 disabled:opacity-50">DRAW TILE ({gameState.pool.length})</button>
              <button onClick={handleEndTurn} disabled={!isMyTurn || turnPoints === 0} className="bg-slate-700 text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-slate-800 disabled:opacity-50">END TURN</button>
              {isHost && <button onClick={handleResetGame} className="bg-red-500 text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-red-600">RESET</button>}
            </>
          )}
        </div>
      </main>

      {showNetwork && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Multiplayer Setup</h3>
            <div className="space-y-4">
               <div>
                 <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Role: {gameState.playerRole}</label>
                 {connectedPlayers.length > 0 && <p className="text-sm text-green-600">Connected Clients: {connectedPlayers.join(', ')}</p>}
               </div>
               <button onClick={async () => {
                  const conn = new P2PConnection();
                  const index = connectedPlayers.length + 1;
                  conn.onMessage = (msg) => handleClientMessage(index, msg);
                  conn.onConnectionStateChange = (state) => {
                    if (state === 'connected') setConnectedPlayers(p => [...p, index]);
                  };
                  const offer = await conn.createOffer();
                  setOfferText(offer);
                  connections.current.set(index, conn);
                  setGameState(prev => ({...prev, playerRole: 'host', isMultiplayer: true}));
               }} className="w-full bg-slate-100 py-2 rounded border hover:bg-slate-200">Host: Generate Invite Code</button>
               {offerText && (
                 <div>
                   <label className="block text-xs font-bold text-slate-400 mb-1">Your Invite Code:</label>
                   <textarea readOnly value={offerText} className="w-full h-20 text-[10px] p-2 bg-slate-50 border rounded font-mono" />
                 </div>
               )}
               <div className="pt-4 border-t">
                 <label className="block text-xs font-bold text-slate-400 mb-1">Join as Client (Paste Code):</label>
                 <textarea value={remoteOffer} onChange={e => setRemoteOffer(e.target.value)} className="w-full h-20 text-[10px] p-2 border rounded font-mono" />
                 <div className="flex gap-2 mt-2">
                    <button onClick={async () => {
                       const conn = new P2PConnection();
                       conn.onMessage = (msg) => { if (msg.type === 'UPDATE_STATE') setGameState(msg.payload); };
                       const answer = await conn.handleOffer(remoteOffer);
                       setAnswerText(answer);
                       connections.current.set(0, conn);
                    }} className="flex-1 bg-indigo-600 text-white py-2 rounded">Join Host</button>
                    <button onClick={async () => {
                       const conn = connections.current.get(connectedPlayers.length + 1);
                       if (conn) await conn.handleAnswer(remoteOffer);
                    }} className="flex-1 bg-green-600 text-white py-2 rounded">Finalize Client</button>
                 </div>
               </div>
               {answerText && (
                 <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">Your Answer Code:</label>
                    <textarea readOnly value={answerText} className="w-full h-20 text-[10px] p-2 bg-slate-50 border rounded font-mono" />
                 </div>
               )}
            </div>
            <button onClick={() => setShowNetwork(false)} className="w-full mt-6 bg-slate-800 text-white py-3 rounded-xl font-bold">CLOSE</button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl overflow-auto max-h-[90vh]">
            <h3 className="text-xl font-bold mb-4">How to Play</h3>
            <ul className="space-y-2 text-sm text-slate-600 list-disc pl-4">
              <li><strong>Objective:</strong> Be the first to empty your hand.</li>
              <li><strong>Sets:</strong> Runs (same color, consecutive) or Groups (same number, diff colors).</li>
              <li><strong>Initial Meld:</strong> First move must total 30+ points.</li>
              <li><strong>Turns:</strong> Play a set or draw a tile.</li>
            </ul>
            <button onClick={() => setShowHelp(false)} className="w-full mt-6 bg-slate-800 text-white py-3 rounded-xl font-bold">GOT IT</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
