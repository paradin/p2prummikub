
export class P2PConnection {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  onMessage?: (data: any) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;

  constructor(customIceServers?: RTCIceServer[]) {
    const defaultServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' }
    ];

    this.pc = new RTCPeerConnection({
      iceServers: customIceServers && customIceServers.length > 0 ? customIceServers : defaultServers,
      iceCandidatePoolSize: 20, // Increased for better discovery
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    this.pc.onconnectionstatechange = () => {
      console.log("WebRTC State Change:", this.pc.connectionState);
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("ICE Connection State:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'failed') {
        this.onConnectionStateChange?.('failed');
      }
    };
  }

  async createOffer(): Promise<string> {
    this.dc = this.pc.createDataChannel('game-data', { 
      ordered: true,
      maxRetransmits: 3 
    });
    this.setupDataChannel();
    
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    
    return this.waitForIceGathering();
  }

  async handleOffer(offerB64: string): Promise<string> {
    try {
      const offer = JSON.parse(atob(offerB64));
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.setupDataChannel();
      };
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      return this.waitForIceGathering();
    } catch (e) {
      console.error("Error handling offer:", e);
      throw e;
    }
  }

  private waitForIceGathering(): Promise<string> {
    return new Promise((resolve) => {
      // Wait for iceGatheringState to be complete or a timeout
      const timeout = setTimeout(() => {
        console.warn("ICE gathering timed out, resolving with current localDescription");
        resolve(btoa(JSON.stringify(this.pc.localDescription)));
      }, 8000); 

      const checkState = () => {
        if (this.pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve(btoa(JSON.stringify(this.pc.localDescription)));
        }
      };

      if (this.pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve(btoa(JSON.stringify(this.pc.localDescription)));
      } else {
        this.pc.addEventListener('icegatheringstatechange', checkState);
      }
    });
  }

  async handleAnswer(answerB64: string) {
    try {
      const answer = JSON.parse(atob(answerB64));
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) {
      console.error("Failed to set remote description (Answer)", e);
      throw e;
    }
  }

  setupDataChannel() {
    if (!this.dc) return;
    this.dc.onopen = () => {
      console.log("DataChannel Open ✅");
      this.onConnectionStateChange?.('connected');
    };
    this.dc.onclose = () => {
      console.log("DataChannel Closed ❌");
      this.onConnectionStateChange?.('disconnected');
    };
    this.dc.onerror = (e) => console.error("DataChannel Error:", e);
    this.dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.onMessage?.(data);
      } catch (err) {
        console.error("P2P Message Parse Error:", err);
      }
    };
  }

  send(data: any) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
    }
  }

  close() {
    this.pc.close();
  }
}
