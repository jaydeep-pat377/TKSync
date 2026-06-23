import {Platform, PermissionsAndroid} from 'react-native';
import LiveAudioStream from 'react-native-live-audio-stream';
import Config from 'react-native-config';

// ─── TYPES ───

export type DeepgramEvent =
  | {type: 'partial'; text: string}
  | {type: 'final'; text: string}
  | {type: 'error'; message: string}
  | {type: 'ready'}
  | {type: 'closed'};

type Listener = (event: DeepgramEvent) => void;

// ─── AUDIO CONFIG ───

const AUDIO_CONFIG = {
  sampleRate: 16000,
  channels: 1 as 1 | 2,
  bitsPerSample: 16 as 8 | 16,
  audioSource: 6, // VOICE_RECOGNITION on Android
  wavFile: '', // not saving to file, streaming only
};

// ─── SERVICE ───

class DeepgramSpeechService {
  private ws: WebSocket | null = null;
  private listener: Listener | null = null;
  private isStreaming = false;

  /** Request microphone permission (Android runtime, iOS via Info.plist) */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'TKSync needs microphone access for voice input.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    // iOS: permission is requested automatically by the OS on first mic use
    return true;
  }

  /** Start streaming mic audio to Deepgram */
  async start(listener: Listener, keywords?: string[]): Promise<void> {
    this.listener = listener;

    // 1. Check permission
    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      listener({type: 'error', message: 'Microphone permission denied. Enable it in Settings.'});
      return;
    }

    // 2. Build Deepgram WebSocket URL with features
    const apiKey = Config.DEEPGRAM_API_KEY;
    if (!apiKey || apiKey === 'YOUR_DEEPGRAM_API_KEY_HERE') {
      listener({type: 'error', message: 'Deepgram API key not configured.'});
      return;
    }

    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'en-US',
      smart_format: 'true',
      numerals: 'true',        // "fifteen" → "15"
      punctuate: 'true',
      interim_results: 'true', // partial results while speaking
      utterance_end_ms: '1500',
      encoding: 'linear16',
      sample_rate: String(AUDIO_CONFIG.sampleRate),
      channels: String(AUDIO_CONFIG.channels),
    });

    // Add keyword boosting for plant-specific terms
    if (keywords?.length) {
      keywords.forEach(kw => params.append('keywords', `${kw}:2`));
    }

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    // 3. Open WebSocket
    try {
      await this.connectWebSocket(url, apiKey);
    } catch (err: any) {
      listener({type: 'error', message: err?.message || 'Failed to connect to Deepgram.'});
      return;
    }

    // 4. Start mic capture and stream audio chunks
    this.startAudioStream();
  }

  /** Stop streaming and close connection */
  async stop(): Promise<void> {
    this.stopAudioStream();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send CloseStream message per Deepgram protocol
      try {
        this.ws.send(JSON.stringify({type: 'CloseStream'}));
      } catch {}
      // Give Deepgram a moment to send final results before closing
      await new Promise<void>(r => setTimeout(r, 500));
      this.ws.close();
    }
    this.ws = null;
  }

  /** Destroy — force-close everything */
  destroy(): void {
    this.stopAudioStream();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.listener = null;
  }

  // ─── PRIVATE ───

  private connectWebSocket(url: string, apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, undefined, {
        headers: {Authorization: `Token ${apiKey}`},
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        ws.close();
      }, 10000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.listener?.({type: 'ready'});
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === 'Results') {
            const transcript = data.channel?.alternatives?.[0]?.transcript || '';
            if (!transcript) return;

            if (data.is_final) {
              this.listener?.({type: 'final', text: transcript});
            } else {
              this.listener?.({type: 'partial', text: transcript});
            }
          } else if (data.type === 'UtteranceEnd') {
            // Deepgram detected end of speech — useful for auto-advance
          }
        } catch {}
      };

      ws.onerror = (err: any) => {
        clearTimeout(timeout);
        const msg = err?.message || 'WebSocket error';
        this.listener?.({type: 'error', message: msg});
        reject(new Error(msg));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        this.listener?.({type: 'closed'});
        this.isStreaming = false;
      };
    });
  }

  private startAudioStream(): void {
    if (this.isStreaming) return;

    LiveAudioStream.init(AUDIO_CONFIG);

    LiveAudioStream.on('data', (base64Data: string) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Convert base64 to binary and send
        const binary = (globalThis as any).atob(base64Data);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        this.ws.send(bytes.buffer);
      }
    });

    LiveAudioStream.start();
    this.isStreaming = true;
  }

  private stopAudioStream(): void {
    if (!this.isStreaming) return;
    try {
      LiveAudioStream.stop();
    } catch {}
    this.isStreaming = false;
  }
}

// ─── TEXT-TO-SPEECH SERVICE ───

class DeepgramTTSService {
  private currentSound: any = null; // Sound instance
  private isSpeaking = false;

  /** Speak text aloud using Deepgram Aura TTS */
  async speak(text: string): Promise<void> {
    const apiKey = Config.DEEPGRAM_API_KEY;
    if (!apiKey || apiKey === 'YOUR_DEEPGRAM_API_KEY_HERE') {
      throw new Error('Deepgram API key not configured.');
    }

    // Stop any currently playing audio
    this.stopPlayback();

    const params = new URLSearchParams({
      model: 'aura-asteria-en', // clear female voice, good for prompts
    });

    const url = `https://api.deepgram.com/v1/speak?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({text}),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      // Get audio as base64 for React Native Sound playback
      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      await this.playBase64Audio(base64);
    } catch (err: any) {
      this.isSpeaking = false;
      throw err;
    }
  }

  /** Stop current playback */
  stopPlayback(): void {
    if (this.currentSound) {
      try {
        this.currentSound.stop();
        this.currentSound.release();
      } catch {}
      this.currentSound = null;
    }
    this.isSpeaking = false;
  }

  /** Check if currently speaking */
  get speaking(): boolean {
    return this.isSpeaking;
  }

  private playBase64Audio(base64Data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Write base64 to a temp file for Sound to play
      const RNFS = require('react-native-fs') as typeof import('react-native-fs');
      const filePath = `${RNFS.CachesDirectoryPath}/tts_prompt_${Date.now()}.mp3`;

      RNFS.writeFile(filePath, base64Data, 'base64')
        .then(() => {
          const Sound = require('react-native-sound').default;
          Sound.setCategory('Playback');

          const sound = new Sound(filePath, '', (err: any) => {
            if (err) {
              reject(new Error('Failed to load TTS audio'));
              return;
            }
            this.currentSound = sound;
            this.isSpeaking = true;

            sound.play((success: boolean) => {
              this.isSpeaking = false;
              sound.release();
              this.currentSound = null;
              // Clean up temp file
              RNFS.unlink(filePath).catch(() => {});
              resolve();
            });
          });
        })
        .catch(reject);
    });
  }
}

/** Convert Blob to base64 string */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data:audio/...;base64, prefix
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const deepgramSpeech = new DeepgramSpeechService();
export const deepgramTTS = new DeepgramTTSService();
