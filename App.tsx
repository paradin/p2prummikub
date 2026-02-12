
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Tile, TileSet, GameState, NetworkMessage, TileColor } from './types';
import { createDeck, isValidSet, calculateSetPoints, sortHand, sortTileSet, aiPlayTurn } from './utils/gameLogic';
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
    message: role === 'client' ? "Waiting for connection..." : "Welcome! Invite friends or play against AI.",
    isMultiplayer: role !== 'single',
    playerRole: role,
    myPlayerIndex: 0,
    gameStarted: false,
    humanPlayers: [0], 
  };
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(() => getInitialGameState());
  const [showNetwork, setShowNetwork] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Network State
  const connections = useRef<Map<number, P2PConnection>>(new Map());
  const [offerText, setOfferText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [remoteOffer, setRemoteOffer] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [connStatus, setConnStatus] = useState<string>("idle");
  const [customIceJson, setCustomIceJson] = useState<string>("");

  const [selectedInHand, setSelectedInHand] = useState<Set<string>>(new Set());

  const isMyTurn = gameState.currentPlayerIndex === gameState.myPlayerIndex && gameState.gameStarted && gameState.winner === null;
  const isHost = gameState.playerRole === 'host' || gameState.playerRole === 'single';

  const getTurnMessage = (state: GameState) => {
    if (state.winner !== null) return `👑 Player ${state.winner} Wins! 👑`;
    const isMe = state.currentPlayerIndex === state.myPlayerIndex;
    const name = isMe ? "Your" : `Player ${state.currentPlayerIndex}'s`;
    return `${name} Turn`;
  };

  const broadcastState = useCallback((state: GameState) => {
    if (state.playerRole !== 'host') return;
    const updatedMessage = getTurnMessage(state);
    connections.current.forEach((conn, index) => {
      const clientView: GameState = {
        ...state,
        message: updatedMessage,
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
      message: getTurnMessage(gameState),
    };
    newState.message = getTurnMessage(newState);
    setGameState(newState);
    broadcastState(newState);
  };

  const handleAddToSet = (setIdx: number) => {
    if (!isMyTurn || selectedInHand.size === 0) return;

    if (!gameState.hasMeld[gameState.myPlayerIndex]) {
      alert("You must complete your Initial Meld (30 points) with new sets before adding to existing board tiles.");
      return;
    }

    const tilesToAdd = gameState.playerHand.filter(t => selectedInHand.has(t.id));
    const targetSet = [...gameState.board[setIdx], ...tilesToAdd];

    if (!isValidSet(targetSet)) {
      alert("Invalid move: This would make the set illegal.");
      return;
    }

    setGameState(prev => {
      const newBoard = [...prev.board];
      newBoard[setIdx] = sortTileSet(targetSet);
      const newHand = prev.playerHand.filter(t => !selectedInHand.has(t.id));
      const ns = {
        ...prev,
        board: newBoard,
        playerHand: newHand,
      };
      if (newHand.length === 0) ns.winner = prev.myPlayerIndex;
      ns.message = getTurnMessage(ns);
      if (prev.playerRole === 'client') {
        connections.current.get(0)?.send({ type: 'ACTION_MOVE', payload: { board: ns.board, hand: ns.playerHand, hasMeld: true }, fromIndex: prev.myPlayerIndex });
      } else {
        broadcastState(ns);
      }
      return ns;
    });
    setSelectedInHand(new Set());
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
            newState = { ...newState, pool: newPool, aiHands: newAiHands, currentPlayerIndex: (connIdx + 1) % 4 };
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
      newState.message = getTurnMessage(newState);
      broadcastState(newState);
      return newState;
    });
  }, [broadcastState]);

  useEffect(() => {
    if (!gameState.gameStarted || gameState.winner !== null) return;
    if (gameState.currentPlayerIndex !== 0 && (gameState.playerRole === 'single' || gameState.playerRole === 'host')) {
      const aiIdx = gameState.currentPlayerIndex - 1;
      if (gameState.humanPlayers.includes(gameState.currentPlayerIndex)) return;

      const timer = setTimeout(() => {
        setGameState(prev => {
          const { newHand, newBoard, madeMove } = aiPlayTurn(prev.aiHands[aiIdx], prev.board, prev.hasMeld[prev.currentPlayerIndex]);
          let nextState = { ...prev };
          if (madeMove) {
            const newAiHands = [...prev.aiHands];
            newAiHands[aiIdx] = newHand;
            const newHasMeld = [...prev.hasMeld];
            newHasMeld[prev.currentPlayerIndex] = true;
            nextState = { ...prev, board: newBoard, aiHands: newAiHands, hasMeld: newHasMeld };
            if (newHand.length === 0) nextState.winner = prev.currentPlayerIndex;
            else nextState.currentPlayerIndex = (prev.currentPlayerIndex + 1) % 4;
          } else {
            const newPool = [...prev.pool];
            if (newPool.length > 0) {
              const drawn = newPool.pop()!;
              const newAiHands = [...prev.aiHands];
              newAiHands[aiIdx] = [...newAiHands[aiIdx], drawn];
              nextState = { ...prev, pool: newPool, aiHands: newAiHands };
            }
            nextState.currentPlayerIndex = (prev.currentPlayerIndex + 1) % 4;
          }
          nextState.message = getTurnMessage(nextState);
          if (prev.playerRole === 'host') broadcastState(nextState);
          return nextState;
        });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentPlayerIndex, gameState.gameStarted, gameState.winner, gameState.playerRole, broadcastState, gameState.humanPlayers]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.readText().then(() => {
      alert("Code copied!");
    });
  };

  const pasteFromClipboard = (setter: (val: string) => void) => {
    navigator.clipboard.readText().then((text) => {
      setter(text);
    }).catch(err => {
      console.error('Failed to read clipboard contents: ', err);
    });
  };

  const getIceConfig = () => {
    try {
      if (!customIceJson.trim()) return undefined;
      return JSON.parse(customIceJson);
    } catch (e) {
      alert("Invalid JSON for Custom ICE Servers. Using defaults.");
      return undefined;
    }
  };

  const initHostConnection = async () => {
    setIsGenerating(true);
    setConnStatus("gathering");
    const conn = new P2PConnection(getIceConfig());
    const index = gameState.humanPlayers.length;
    if (index >= 4) { alert("Game full!"); setIsGenerating(false); return; }
    
    conn.onMessage = (msg) => handleClientMessage(index, msg);
    conn.onConnectionStateChange = (state) => {
      setConnStatus(state);
      if (state === 'connected') {
        setGameState(gs => {
          const newHumans = [...gs.humanPlayers, index];
          const next = { ...gs, humanPlayers: newHumans, message: `Player ${index} joined!` };
          setTimeout(() => broadcastState(next), 1000);
          return next;
        });
      }
    };

    try {
      const offer = await conn.createOffer();
      setOfferText(offer);
      connections.current.set(index, conn);
      setGameState(prev => ({...prev, playerRole: 'host', isMultiplayer: true}));
    } catch (e) {
      alert("Offer creation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const joinAsClient = async () => {
    if (!remoteOffer) { alert("Paste invite code first."); return; }
    setIsGenerating(true);
    setConnStatus("generating_answer");
    const conn = new P2PConnection(getIceConfig());
    
    conn.onMessage = (msg) => {
      if (msg.type === 'UPDATE_STATE') setGameState(msg.payload);
    };

    conn.onConnectionStateChange = (state) => {
      setConnStatus(state);
      if (state === 'connected') {
        setGameState(p => ({...p, message: "Connected to Host!"}));
      }
    };

    try {
      const ans = await conn.handleOffer(remoteOffer);
      setAnswerText(ans);
      connections.current.set(0, conn);
      setGameState(prev => ({...prev, playerRole: 'client', isMultiplayer: true}));
    } catch (e) {
      alert("Connection failed. Invite code might be malformed.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-6 font-sans text-slate-800">
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-extrabold text-indigo-600 tracking-tight">RummyTile</h1>
          <div className="flex gap-2 items-center bg-white px-3 py-1.5 rounded-full shadow-sm border border-slate-200">
             {[0,1,2,3].map(i => {
               const isHuman = gameState.humanPlayers.includes(i);
               const isMe = gameState.myPlayerIndex === i;
               return (
                 <div key={i} className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${
                   isMe ? 'bg-indigo-600' : (isHuman ? 'bg-green-500' : 'bg-slate-300')
                 }`} />
               );
             })}
          </div>
        </div>
        <button onClick={() => setShowNetwork(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg hover:bg-indigo-700 transition-all font-bold text-sm">
            Lobby
        </button>
      </header>

      <main className="max-w-6xl mx-auto flex flex-col gap-6">
        <section className="bg-white rounded-2xl p-6 min-h-[350px] border border-slate-200 shadow-sm relative overflow-auto">
          <div className="flex flex-wrap gap-4 content-start">
            {gameState.board.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 py-20">
                <p className="text-6xl mb-4">🀄</p>
                <p className="italic font-medium">Wait for Host to start.</p>
              </div>
            ) : (
              gameState.board.map((set, i) => (
                <div 
                  key={i} 
                  onClick={() => handleAddToSet(i)}
                  className={`flex bg-slate-50 p-2 rounded-xl border-2 shadow-sm transition-all ${
                    isMyTurn ? 'hover:border-indigo-400 cursor-pointer' : 'border-slate-100'
                  }`}
                >
                  {set.map(tile => <TileComponent key={tile.id} tile={tile} size="sm" disabled />)}
                </div>
              ))
            )}
          </div>
        </section>

        <div className={`p-4 rounded-2xl text-center font-bold shadow-sm border-2 transition-all ${
          isMyTurn ? 'bg-indigo-600 text-white border-indigo-400 animate-pulse' : 'bg-white text-slate-500 border-slate-200'
        }`}>
          <span className="text-lg">{gameState.message}</span>
          {isMyTurn && <span className="ml-2">👉 Action Required!</span>}
        </div>

        {gameState.gameStarted && (
          <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Your Tiles ({gameState.playerHand.length})</h2>
              <div className="flex gap-2">
                <button onClick={() => setGameState(p => ({...p, playerHand: sortHand(p.playerHand, 'number')}))} className="text-[10px] font-black bg-slate-100 px-3 py-1.5 rounded-lg border hover:bg-slate-200">123</button>
                <button onClick={() => setGameState(p => ({...p, playerHand: sortHand(p.playerHand, 'color')}))} className="text-[10px] font-black bg-slate-100 px-3 py-1.5 rounded-lg border hover:bg-slate-200">RGB</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {gameState.playerHand.map(tile => (
                <TileComponent 
                  key={tile.id} 
                  tile={tile} 
                  onClick={() => {
                    if (!isMyTurn) return;
                    const next = new Set(selectedInHand);
                    if (next.has(tile.id)) next.delete(tile.id); else next.add(tile.id);
                    setSelectedInHand(next);
                  }}
                  selected={selectedInHand.has(tile.id)}
                  disabled={!isMyTurn}
                />
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-4 justify-center pb-10">
          {!gameState.gameStarted && isHost && (
            <button onClick={handleStartGame} className="bg-indigo-600 text-white px-12 py-4 rounded-2xl font-black text-lg shadow-xl hover:bg-indigo-700">START GAME</button>
          )}
          {gameState.gameStarted && (
            <>
              <button onClick={() => {
                const selectedTiles = gameState.playerHand.filter(t => selectedInHand.has(t.id));
                if (selectedTiles.length < 3 || !isValidSet(selectedTiles)) {
                   alert("Invalid set."); return;
                }
                const pts = calculateSetPoints(selectedTiles);
                if (!gameState.hasMeld[gameState.myPlayerIndex] && pts < 30) {
                   alert(`Initial meld must be 30+ pts. Current: ${pts}`); return;
                }
                setGameState(prev => {
                  const newHand = prev.playerHand.filter(t => !selectedInHand.has(t.id));
                  const ns = {
                    ...prev,
                    board: [...prev.board, sortTileSet(selectedTiles)],
                    playerHand: newHand,
                    hasMeld: prev.hasMeld.map((m, i) => i === prev.myPlayerIndex ? true : m)
                  };
                  if (newHand.length === 0) ns.winner = prev.myPlayerIndex;
                  ns.message = getTurnMessage(ns);
                  if (prev.playerRole === 'client') connections.current.get(0)?.send({ type: 'ACTION_MOVE', payload: { board: ns.board, hand: ns.playerHand, hasMeld: true }, fromIndex: prev.myPlayerIndex });
                  else broadcastState(ns);
                  return ns;
                });
                setSelectedInHand(new Set());
              }} disabled={!isMyTurn || selectedInHand.size < 3} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg disabled:opacity-30">PLAY SET</button>
              
              <button onClick={() => {
                setGameState(prev => {
                  if (prev.pool.length === 0) return prev;
                  const pool = [...prev.pool];
                  const drawn = pool.pop()!;
                  const ns = { ...prev, pool, playerHand: [...prev.playerHand, drawn], currentPlayerIndex: (prev.currentPlayerIndex + 1) % 4 };
                  ns.message = getTurnMessage(ns);
                  if (prev.playerRole === 'client') connections.current.get(0)?.send({ type: 'ACTION_DRAW', fromIndex: prev.myPlayerIndex, payload: null });
                  else broadcastState(ns);
                  return ns;
                });
                setSelectedInHand(new Set());
              }} disabled={!isMyTurn || gameState.pool.length === 0} className="bg-amber-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg disabled:opacity-30">DRAW</button>
              
              <button onClick={() => {
                setGameState(prev => {
                  const ns = { ...prev, currentPlayerIndex: (prev.currentPlayerIndex + 1) % 4 };
                  ns.message = getTurnMessage(ns);
                  if (prev.playerRole === 'client') connections.current.get(0)?.send({ type: 'ACTION_END_TURN', fromIndex: prev.myPlayerIndex, payload: null });
                  else broadcastState(ns);
                  return ns;
                });
                setSelectedInHand(new Set());
              }} disabled={!isMyTurn} className="bg-slate-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg disabled:opacity-30">END TURN</button>
            </>
          )}
        </div>
      </main>

      {showNetwork && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-4">
               <h3 className="text-2xl font-black text-slate-800">Connection Center</h3>
               <button onClick={() => setShowNetwork(false)} className="text-slate-300 hover:text-slate-600 text-2xl">✕</button>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl">
               <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">WebRTC Link Status</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                    connStatus === 'connected' ? 'bg-green-500 text-white' : 
                    connStatus === 'failed' ? 'bg-red-500 text-white' : 'bg-amber-400 text-white'
                  }`}>{connStatus}</span>
               </div>
               <p className="text-[10px] text-indigo-600 mt-1 opacity-70">
                 {connStatus === 'gathering' ? 'Locating network paths... (Wait 8s)' : 
                  connStatus === 'checking' ? 'Testing connection routes...' : 
                  connStatus === 'failed' ? 'NAT traversal failed. Mobile hotspots often block P2P. Use Advanced -> TURN Server.' : 'Ready for connection.'}
               </p>
            </div>

            <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-widest">
              {showAdvanced ? 'Hide Advanced Settings' : 'Advanced: Add TURN Server'}
            </button>

            {showAdvanced && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Mobile networks (Hotspots/4G) often require a <strong>Relay (TURN)</strong> server to bypass Symmetric NAT. 
                  Paste an array of <code>iceServers</code> here:
                </p>
                <textarea 
                  value={customIceJson} 
                  onChange={(e) => setCustomIceJson(e.target.value)}
                  placeholder='[{"urls": "turn:your-server.com", "username": "...", "credential": "..."}]'
                  className="w-full h-24 text-[10px] font-mono p-3 bg-white border rounded-xl resize-none"
                />
              </div>
            )}

            <div className="space-y-6">
               <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 space-y-4">
                 <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">Host a Friend</h4>
                 <button disabled={isGenerating} onClick={initHostConnection} className="w-full bg-white border-2 border-indigo-100 py-3 rounded-2xl font-bold text-indigo-600 hover:bg-indigo-50 transition-all">
                    {isGenerating ? "Preparing Invite..." : "Create Invite Code"}
                 </button>
                 {offerText && (
                   <div className="space-y-3">
                     <p className="text-[10px] font-black text-slate-400 uppercase">1. Copy this to friend:</p>
                     <div className="flex gap-2">
                       <textarea readOnly value={offerText} className="flex-1 h-20 text-[10px] p-2 bg-white border rounded-xl font-mono" />
                       <button onClick={() => copyToClipboard(offerText)} className="bg-indigo-50 text-indigo-600 px-3 rounded-xl font-bold">Copy</button>
                     </div>
                     <p className="text-[10px] font-black text-slate-400 uppercase">2. Paste their Response:</p>
                     <div className="flex gap-2">
                       <textarea value={answerText} onChange={e => setAnswerText(e.target.value)} className="flex-1 h-20 text-[10px] p-2 border rounded-xl font-mono bg-white" placeholder="Paste response here..." />
                       <button onClick={() => pasteFromClipboard(setAnswerText)} className="bg-slate-100 px-3 rounded-xl font-bold">Paste</button>
                     </div>
                     <button onClick={async () => {
                       const nextIdx = gameState.humanPlayers.length;
                       const conn = connections.current.get(nextIdx);
                       if (conn && answerText) {
                          await conn.handleAnswer(answerText);
                          setOfferText(""); setAnswerText("");
                       } else {
                          alert("Invalid connection state.");
                       }
                     }} className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-black shadow-lg">Confirm Connection</button>
                   </div>
                 )}
               </div>

               <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 space-y-4">
                 <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">Join a Friend</h4>
                 <div className="flex gap-2">
                    <textarea value={remoteOffer} onChange={e => setRemoteOffer(e.target.value)} className="flex-1 h-20 text-[10px] p-2 border rounded-xl font-mono bg-white" placeholder="Paste invite code..." />
                    <button onClick={() => pasteFromClipboard(setRemoteOffer)} className="bg-slate-100 px-3 rounded-xl font-bold">Paste</button>
                 </div>
                 <button disabled={isGenerating} onClick={joinAsClient} className="w-full bg-slate-800 text-white py-3 rounded-2xl font-black shadow-lg">
                    {isGenerating ? "Analyzing..." : "Generate Answer Code"}
                 </button>
                 {answerText && gameState.playerRole === 'client' && (
                   <div className="space-y-3">
                     <p className="text-[10px] font-black text-slate-400 uppercase">Copy and send back to Host:</p>
                     <div className="flex gap-2">
                       <textarea readOnly value={answerText} className="flex-1 h-20 text-[10px] p-2 bg-white border rounded-xl font-mono" />
                       <button onClick={() => copyToClipboard(answerText)} className="bg-indigo-50 text-indigo-600 px-3 rounded-xl font-bold">Copy</button>
                     </div>
                   </div>
                 )}
               </div>
            </div>
            <button onClick={() => setShowNetwork(false)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black">BACK TO GAME</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
