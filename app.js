require('dotenv').config();
require('colors');
const express = require('express');
const mongoose = require("mongoose");
const ExpressWs = require('express-ws');
const path = require('path');
const userRoutes = require('./routes/userRoutes')
const panelRoutes = require('./routes/panelRoutes')
var session = require('express-session')
const { MongoClient } = require('mongodb');
const bodyParser = require("body-parser");
const passport = require('passport');
const { GptService } = require('./services/gpt-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const {TextToSpeechWebSocket} = require("./services/tts-socket")
const waitlistDB = require("./models/waitlistModel");

const MongoDBSessionStore = require("connect-mongodb-session");
var mongourl = process.env.MONGODB_URL;
const mongoclient = new MongoClient(mongourl, { useNewUrlParser: true, useUnifiedTopology: true });

// Create a new MongoDBSessionStore
const MongoDBStore = MongoDBSessionStore(session);

// Initialize MongoDBStore with session options
const store = new MongoDBStore({
  uri: mongourl,
  collection: "sessions",
});

// Catch errors in MongoDBStore
store.on("error", function (error) {
  console.error("MongoDBStore Error:", error);
});

const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();
const expressWs = ExpressWs(app);

// Middleware for parsing request body
app.use(express.json());

// Set the directory for static files (like CSS, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      maxAge: 10000 * 60 * 60 * 24, // 1 day
    },
})
);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());
app.use(passport.session());
// Middleware to parse application/json
// app.use(express.json());

app.use("/accounts", userRoutes);
app.use("/panel", panelRoutes);
const PORT = process.env.PORT || 3000;

// // Make a call
function makeACall(toNumber) {
  console.log("Making a call")
  const calls = client.calls.create({
    twiml: `<Response>
    <Connect>
    <Stream url="wss://${process.env.SERVER}/connection" />
  </Connect>
  </Response>`,
  to: toNumber,
  from: process.env.FROM_NUMBER,
  record: true
});
console.log("Call successfully made: ", calls)
}

// makeACall(process.env.YOUR_NUMBER)

app.post('/incoming', (req, res) => {
  res.status(200);
  res.type('text/xml');
  res.end(`
  <Response>
    <Connect>
      <Stream url="wss://${process.env.SERVER}/connection" />
    </Connect>
  </Response>
  `);
});

const gptService = new GptService();

app.post("/set_prompt", async (req, res) => {
  const formBody = await req.body

  console.log(formBody);
  const prompt = formBody["prompt"]
  const name = formBody["name"]
  const email = formBody["email"]
  const phone = formBody["phone"].replaceAll(" ", "")

  try {
    const insertedId = await insertDataIntoCollection(name, email, phone, prompt);
    console.log("Data inserted successfully with _id:", insertedId);
  } catch (error) {
    console.error("Error inserting data:", error);
  }

  // Setting the GPT prompt
  gptService.setPrompt(prompt)

  await makeACall(phone)

  res.send(true)
})

async function insertDataIntoCollection(name, email, phone, prompt) {
  try {
    // Assuming `client` is already defined and connected to MongoDB
    const database = mongoclient.db(); // Get the default database from the client
    const collection = database.collection('CallTrials'); // Get the collection

    // Create the document to be inserted
    const document = {
      name: name,
      email: email,
      phone: phone,
      prompt: prompt
    };

    // Insert the document into the collection
    const result = await collection.insertOne(document);
    console.log(`Inserted data with _id: ${result.insertedId}`);
    return result.insertedId; // Return the inserted document's _id
  } catch (error) {
    console.error("Error inserting data into collection:", error);
    throw error; // Rethrow the error for handling in the calling code
  }
}

// Define a route to render the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'index.html'));
});

app.get('/test', (req, res) => {
  res.send("Hello!");
});

app.get("/join-waitlist", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'waitlist.html'));
})

app.get("/waitlistsuccess", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'waitlistsuccess.html'));
})

// Route to save a User
app.post("/add-waitlist-member", async (request, response) => {
  try {
    if (
      !request.body.name ||
      !request.body.company ||
      !request.body.email
    ) {
      return response.status(400).send({
        message: "Invalid input",
      });
    }
      const newMember = {
        name: request.body.name,
        company: request.body.company,
        email: request.body.email,
        phone: request.body.phone,
      };

      const createWaitlistMember = await waitlistDB.create(newMember);

      return response
        .status(201)
        .send({ message: "Member successfully added to the waitlist" });
  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});

app.get("/getallwaitlistmembers", async (request, response) => {
  const users = await waitlistDB.find();
  response.json(users);
});

app.get("/deleteallwaitlistmembers", async (request, response) => {
  const users = await waitlistDB.deleteMany({});
  response.json(users);
});

app.engine('html', require('ejs').renderFile);

expressWs.app.ws('/connection', (ws, req) => {
  console.log("Connected...")
  ws.on('error', console.error);
  // Filled in from start message
  let streamSid;
  let callSid;

  const streamService = new StreamService(ws);
  const socketService = new TextToSpeechWebSocket(ws);
  const transcriptionService = new TranscriptionService();
  const ttsService = new TextToSpeechService({});
  
  let marks = [];
  let interactionCount = 0;

  // Incoming from MediaStream
  ws.on('message', function message(data) {
    const msg = JSON.parse(data);
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      streamService.setStreamSid(streamSid);
      gptService.setCallSid(callSid);
      console.log(`Twilio -> Starting Media Stream for ${streamSid}`.underline.red);

      // setTimeout(() => {
      //   socketService.sendData("This is a test")
      //   socketService.sendEosData()
      // }, 5000)
      ttsService.generate({partialResponseIndex: null, partialResponse: "Hey, how can I assist you?"}, 1);
    } else if (msg.event === 'media') {
      transcriptionService.send(msg.media.payload);
    } else if (msg.event === 'mark') {
      const label = msg.mark.name;
      console.log(`Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label}`.red);
      marks = marks.filter(m => m !== msg.mark.name);
      socketService.setStreamSid(streamSid);
    } else if (msg.event === 'stop') {
      console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);
    }
    else if (msg.event === 'niggamedia') {
      console.log(`Twilio -> Nigga Media Received`.underline.red);
    }
  });

  transcriptionService.on('utterance', async (text) => {
    // This is a bit of a hack to filter out empty utterances
    if(marks.length > 0 && text?.length > 5) {
      console.log('Twilio -> Interruption, Clearing stream'.red);
      ws.send(
        JSON.stringify({
          streamSid,
          event: 'clear',
        })
      );
    }
  });

  transcriptionService.on('transcription', async (text) => {
    if (!text) { return; }
    console.log(`Interaction ${interactionCount} – STT -> GPT: ${text} | ${new Date().toLocaleString()}`.yellow);
    gptService.completion(text, interactionCount, socketService);
    interactionCount += 1;
  });
  
  gptService.on('gptreply', async (gptReply, icount) => {
    console.log(`Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse} | ${new Date().toLocaleString()}`.green );
    ttsService.generate(gptReply, icount);
  });

  ttsService.on('speech', (responseIndex, audio, label, icount) => {
    console.log(`Interaction ${icount}: TTS -> TWILIO: ${label} | ${new Date().toLocaleString()}`.blue);

    streamService.buffer(responseIndex, audio);
  });

  streamService.on('audiosent', (markLabel) => {
    marks.push(markLabel);
  });

  socketService.on('audiosent', (markLabel) => {
    console.log("Socket mark pushed!")
    marks.push(markLabel);
  });
});

mongoose.connect(mongourl)
.then(async () => {
  // console.log("Connected to MongoDB");
  // const database = mongoclient.db(); // This will use the default database specified in the connection string

  // // Check if the "CallTrials" collection exists
  // const collections = await database.listCollections({ name: 'CallTrials' }).toArray();
  // if (collections.length === 0) {
  //   // If the collection doesn't exist, create it
  //   await database.createCollection('CallTrials');
  //   console.log("Created collection 'CallTrials'");
  // } else {
  //   console.log("Collection 'CallTrials' already exists");
  // }

  // Start your Express app after ensuring the collection is created
  const server = app.listen(PORT, () => {
    console.log("App is listening on port:", PORT);
  });
})
.catch((error) => {
  console.error("Error connecting to MongoDB:", error);
});