
export class P2PConnection {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  onMessage?: (data: any) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;

  constructor() {
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ],
      iceCandidatePoolSize: 10
    });

    this.pc.onconnectionstatechange = () => {
      console.log("WebRTC State:", this.pc.connectionState);
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log("ICE State:", this.pc.iceConnectionState);
    };
  }

  async createOffer(): Promise<string> {
    this.dc = this.pc.createDataChannel('game-data', { negotiated: false });
    this.setupDataChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    
    return this.waitForIceGathering();
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

    return this.waitForIceGathering();
  }

  private waitForIceGathering(): Promise<string> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("ICE gathering timed out, sending partial candidates");
        resolve(btoa(JSON.stringify(this.pc.localDescription)));
      }, 10000); // 延长到 10 秒以适应移动网络

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
      console.error("Failed to set remote description", e);
      throw e;
    }
  }

  setupDataChannel() {
    if (!this.dc) return;
    this.dc.onopen = () => console.log("DataChannel Open");
    this.dc.onclose = () => console.log("DataChannel Closed");
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
