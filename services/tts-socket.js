require("dotenv").config();
const WebSocket = require("ws");
const uuid = require('uuid');
const EventEmitter = require('events');
const { log } = require("console");

class TextToSpeechWebSocket extends EventEmitter {
  constructor(websocket) {
    super();
    this.myws = websocket;
    console.log("This: ", this.myws.url)
    this.expectedAudioIndex = 0;
    this.audioBuffer = {};
    this.streamSid = "";
    this.connect();
  }

  setStreamSid(streamSid) {
    this.streamSid = streamSid;
    console.log("Socket service stream SID: ", this.streamSid)
  }

  connect() {
    const voiceId = process.env.VOICE_ID; // replace with your voice_id
    const model = process.env.XI_MODEL_ID;
    const outputFormat = 'ulaw_8000';
    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?output_format=${outputFormat}&model_id=${model}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = this.handleOpen.bind(this);
    this.socket.onmessage = this.handleMessage.bind(this);
    this.socket.onerror = this.handleError.bind(this);
    this.socket.onclose = this.handleClose.bind(this);
  }

  sendData(textData) {
    // console.log("Sending Message...");
    console.log(`TTS -> ${textData} `)
    const textMessage = {
      "text": `${textData} `,
      "try_trigger_generation": true,
    };

    this.socket.send(JSON.stringify(textMessage));
  }

  sendEosData() {
    // console.log("Sending EOS message...")
    const eosMessage = {
      "text": ""
    };

    this.socket.send(JSON.stringify(eosMessage));
  }

  handleOpen(event) {
    console.log("Opening tts socket...");
    const bosMessage = {
      text: " ",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
      },
      xi_api_key: process.env.XI_API_KEY, // replace with your API key
      accept: 'audio/wav',
    };

    this.socket.send(JSON.stringify(bosMessage));
  }

  async handleMessage(event) {
    const response = JSON.parse(event.data);

    if (response.audio) {
      // decode and handle the audio data (e.g., play it)
      const audioChunk = atob(response.audio); // decode base64

      // Convert the decoded audio data into an ArrayBuffer
      const arrayBuffer = new Uint8Array(audioChunk.length);
      for (let i = 0; i < audioChunk.length; i++) {
          arrayBuffer[i] = audioChunk.charCodeAt(i);
      }

      this.buffer(null, Buffer.from(arrayBuffer).toString('base64'))

      // console.log("Received audio chunk");
    } else {
      console.log("No audio data in the response");
    }

    if (response.isFinal) {
      // the generation is complete
    }

    if (response.normalizedAlignment) {
      // use the alignment info if needed
    }
  }

  handleError(error) {
    console.error("WebSocket Error:", error.message);
  }

  handleClose(event) {
    if (event.wasClean) {
      console.info(
        `Connection closed cleanly, code=${event.code}, reason=${event.reason}`
      );
    } else {
      console.warn("Connection died");
    }
  }

  buffer(index, audio) {
    // console.log("In Buffer...");
    // Escape hatch for intro message, which doesn't have an index
    if (index === null) {
      this.sendAudio(audio);
    } else if (index === this.expectedAudioIndex) {
      this.sendAudio(audio);
      this.expectedAudioIndex++;

      while (
        Object.prototype.hasOwnProperty.call(
          this.audioBuffer,
          this.expectedAudioIndex
        )
      ) {
        const bufferedAudio = this.audioBuffer[this.expectedAudioIndex];
        this.sendAudio(bufferedAudio);
        this.expectedAudioIndex++;
      }
    } else {
      this.audioBuffer[index] = audio;
    }
  }

  sendAudio(audio) {
    // console.log("Audio to send: ", audio)
    // console.log("Sending Audio...")
    // console.log(this.streamSid)
    // if (this.myws.readyState === WebSocket.OPEN) {
    //   console.log(this.myws.url)
    // }
    this.myws.send(
      JSON.stringify({
        streamSid: this.streamSid,
        event: "media",
        media: {
          payload: audio,
        },
      })
    );
    // When the media completes you will receive a `mark` message with the label
    const markLabel = uuid.v4();
    this.myws.send(
      JSON.stringify({
        streamSid: this.streamSid,
        event: "mark",
        mark: {
          name: markLabel,
        },
      })
    );
    this.emit("audiosent", markLabel);
  }
}


module.exports = { TextToSpeechWebSocket };
