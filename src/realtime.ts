import { SessionInfo } from './types';

type TextEventDetail = { text: string; raw: unknown };

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'closed';

export class RealtimeClient extends EventTarget {
  private readonly model: string;
  private readonly clientSecret: string;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private connectionState: ConnectionState = 'idle';
  private responseBuffers = new Map<string, string>();

  constructor(session: SessionInfo, audioElement: HTMLAudioElement) {
    super();
    this.model = session.model;
    this.clientSecret = session.client_secret.value;
    this.audioElement = audioElement;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    if (this.connectionState !== 'idle') {
      return;
    }

    this.connectionState = 'connecting';
    const pc = new RTCPeerConnection();
    this.pc = pc;

    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.audioElement.srcObject = remoteStream;
        this.audioElement
          .play()
          .catch(() => {
            /* autoplay might require user gesture */
          });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const { connectionState } = this.pc;
      if (connectionState === 'connected') {
        this.connectionState = 'connected';
      } else if (connectionState === 'failed' || connectionState === 'closed' || connectionState === 'disconnected') {
        this.connectionState = 'closed';
      }
    };

    const dataChannel = pc.createDataChannel('oai-events');
    this.dataChannel = dataChannel;
    dataChannel.onmessage = (event) => this.handleDataMessage(event);
    dataChannel.onopen = () => {
      this.connectionState = 'connected';
      if (this.resolveReady) {
        this.resolveReady();
        this.resolveReady = null;
      }
    };

    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = 'https://api.openai.com/v1/realtime';
    const url = `${baseUrl}?model=${encodeURIComponent(this.model)}`;

    const sdpResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.clientSecret}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: offer.sdp ?? '',
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      throw new Error(`Failed to initialize realtime session: ${errorText}`);
    }

    const answer = await sdpResponse.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  private handleDataMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'response.output_text.delta') {
        const { response_id: responseId, delta } = data;
        if (responseId) {
          const existing = this.responseBuffers.get(responseId) ?? '';
          this.responseBuffers.set(responseId, existing + (delta ?? ''));
        }
      } else if (data.type === 'response.output_text.done') {
        const { response_id: responseId } = data;
        if (responseId && this.responseBuffers.has(responseId)) {
          const text = this.responseBuffers.get(responseId) ?? '';
          this.responseBuffers.delete(responseId);
          this.emitText(text, data);
        }
      } else if (data.type === 'response.completed') {
        const { response: { id: responseId } = {} } = data;
        if (responseId && this.responseBuffers.has(responseId)) {
          const text = this.responseBuffers.get(responseId) ?? '';
          this.responseBuffers.delete(responseId);
          this.emitText(text, data);
        }
      }
    } catch (err) {
      console.error('Failed to parse realtime data message', err, event.data);
    }
  }

  private emitText(text: string, raw: unknown) {
    if (!text.trim()) return;
    const event = new CustomEvent<TextEventDetail>('text', { detail: { text, raw } });
    this.dispatchEvent(event);
  }

  async speak(text: string): Promise<void> {
    if (!text) return;
    if (!this.dataChannel) {
      throw new Error('Realtime session is not ready');
    }
    if (this.readyPromise) {
      await this.readyPromise;
    }

    const payload = {
      type: 'response.create',
      response: {
        instructions: text,
        modalities: ['audio', 'text'],
      },
    };

    // Using the data channel to send realtime events.
    this.dataChannel.send(JSON.stringify(payload));
  }

  close() {
    this.connectionState = 'closed';
    if (this.dataChannel && this.dataChannel.readyState !== 'closed') {
      this.dataChannel.close();
    }
    if (this.pc) {
      this.pc.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      this.pc.close();
      this.pc = null;
    }
    this.audioElement.srcObject = null;
  }
}

export async function createRealtimeClient(session: SessionInfo, audioElement: HTMLAudioElement): Promise<RealtimeClient> {
  const client = new RealtimeClient(session, audioElement);
  await client.connect();
  return client;
}
