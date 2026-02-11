
export class P2PConnection {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  onMessage?: (data: any) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;

  constructor() {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };
  }

  async createOffer(): Promise<string> {
    this.dc = this.pc.createDataChannel('game-data');
    this.setupDataChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pc.localDescription) {
          resolve(btoa(JSON.stringify(this.pc.localDescription)));
        } else {
          reject(new Error("ICE gathering timeout"));
        }
      }, 5000);

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

  async handleOffer(offerB64: string): Promise<string> {
    const offer = JSON.parse(atob(offerB64));
    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel();
    };
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pc.localDescription) {
          resolve(btoa(JSON.stringify(this.pc.localDescription)));
        } else {
          reject(new Error("ICE gathering timeout"));
        }
      }, 5000);

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
    const answer = JSON.parse(atob(answerB64));
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  setupDataChannel() {
    if (!this.dc) return;
    this.dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.onMessage?.(data);
      } catch (err) {
        console.error("Failed to parse P2P message", err);
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
