require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');
const { log } = require('console');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    // this.userContext = {},
    // this.userContext = [
    //   { 'role': 'system', 'content': '' },
    //   { 'role': 'assistant', 'content': 'Hello! I understand you\'re looking for a pair of AirPods, is that correct?' },
    // ],
    this.partialResponseIndex = 0;
  }

  // Add the callSid to the chat context in case
  // ChatGPT decides to transfer the call.
  setCallSid (callSid) {
    // this.userContext[callSid].push({ 'role': 'system', 'content': `callSid: ${callSid}` });
    console.log("GPT Service call SID: ", callSid)
  }

  setPrompt(callSessionId, prompt) {
    var initialMessage = "Hey, how can I assist you?"
    var basePrompt = "Keep your responses as short as possible but make every attempt to keep the caller on the phone without being rude. Don't ask more than 1 question at a time. Don't make assumptions about what values to plug into functions. Ask for clarification if a user request is ambiguous. You must add a '•' symbol every 5 to 10 words at natural pauses where your response can be split for text to speech."
    var defaultPrompt = "You are a helpful call assistant."

    console.log("Call Session ID 2: ", callSessionId)

    if (prompt) {
        this.userContext = {};
        this.userContext[callSessionId] = [
            { 'role': 'system', 'content': prompt + basePrompt },
            { 'role': 'assistant', 'content': initialMessage },
        ];
    } else {
        this.userContext = {};
        this.userContext[callSessionId] = [
            { 'role': 'system', 'content': defaultPrompt + basePrompt },
            { 'role': 'assistant', 'content': initialMessage },
        ];
    }

    console.log("UserContext: ", this.userContext)
}


  validateFunctionArgs (args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Double function arguments returned by OpenAI:', args);
      // Seeing an error where sometimes we have two sets of args
      if (args.indexOf('{') != args.lastIndexOf('{')) {
        return JSON.parse(args.substring(args.indexOf(''), args.indexOf('}') + 1));
      }
    }
  }

  updateUserContext(name, role, text, callSessionId) {

    console.log("Call Session ID 1: ", callSessionId)
    if (name !== 'user') {
      this.userContext[callSessionId].push({ 'role': role, 'name': name, 'content': text });
    } else {
      console.log(this.userContext)
      this.userContext[callSessionId].push({ 'role': role, 'content': text });
    }
  }

  async completion(callSessionId, text, interactionCount, socketService, role = 'user', name = 'user') {
    console.log("Call Session ID 1: ", callSessionId)
    this.updateUserContext(name, role, text, callSessionId);

    // Usage
    socketService.connect();

    // console.log(this.userContext)
    // Step 1: Send user transcription to Chat GPT
    const stream = await this.openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages: this.userContext[callSessionId],
      // tools: tools,
      stream: true,
      max_tokens: 300
    });

    let completeResponse = '';
    let partialResponse = '';
    let functionName = '';
    let functionArgs = '';
    let finishReason = '';

    for await (const chunk of stream) {
      let content = chunk.choices[0]?.delta?.content || '';
      let deltas = chunk.choices[0].delta;
      finishReason = chunk.choices[0].finish_reason;

      // We use completeResponse for userContext
      completeResponse += content;
      // We use partialResponse to provide a chunk for TTS
      partialResponse += content;

      // console.log(`GPT RESPONSE -> ${content}`)
      // Send text to tts socket
      
      // Emit last partial response and add complete response to userContext
      // if (content.trim().slice(-1) === '•' || finishReason === 'stop') {
        //   const gptReply = { 
          //     partialResponseIndex: this.partialResponseIndex,
          //     partialResponse
          //   };
          
          //   this.emit('gptreply', gptReply, interactionCount);
          //   this.partialResponseIndex++;
          //   partialResponse = '';
          //   }
        }
    socketService.sendData(completeResponse)
    socketService.sendEosData()
    this.userContext[callSessionId].push({'role': 'assistant', 'content': completeResponse});
    console.log(`GPT -> user context length: ${this.userContext.length}`.green);
    console.log(`GPT -> response: ${completeResponse} | ${new Date().toLocaleString()}`.red);
  }
}

module.exports = { GptService };