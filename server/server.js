const express = require('express');
const net = require('net');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PImage = require('pureimage');
require('dotenv').config();
const WebSocket = require('ws'); // WebSocket server

const app = express();
const port = process.env.PORT || 3000;

const { exec } = require('child_process');

const sketchupPath = process.env.SKETCHUP_PATH;
const sketchupScriptStartServerPath = process.env.SKETCHUP_SCRIPT_START_SERVER_PATH;
const sketchupScriptCustomViewPath = process.env.SKETCHUP_SCRIPT_CUSTOM_VIEW_PATH;
const sketchupModelDirectory = path.join(__dirname, 'sketchup/models');  // Model directory

const defaultModel = 'empty';  // Define the default model to load

// WebSocket server setup
const wss = new WebSocket.Server({ noServer: true }); // WebSocket server without its own HTTP server

function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function waitForFile(filePath, timeout = 60000, interval = 2000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkFile = () => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (!err) {
          resolve();
        } else {
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Timeout: File ${filePath} was not created within ${timeout} ms.`));
          } else {
            setTimeout(checkFile, interval);
          }
        }
      });
    };
    checkFile();
  });
}

async function startSketchup() {
  console.log('Triggering SketchUp with empty model...');
  try {
    await runSketchUpScriptWithModel('empty.skp');  // Pass empty.skp at startup
    
    const rubyScriptForModel = generateModelLoadScript(defaultModel);
    await runRubyScriptInSketchUp(rubyScriptForModel);

    const modelScriptPath = path.join(__dirname, 'sketchup/models', `${defaultModel}.txt`);
    if (fs.existsSync(modelScriptPath)) {
      const modelScript = fs.readFileSync(modelScriptPath, 'utf8');
      await runRubyScriptInSketchUp(modelScript);
    }

  } catch (error) {
    console.error('Failed to start SketchUp with empty model:', error);
    return;
  }
}


function runSketchUpScriptWithModel(modelName) {
  return new Promise((resolve, reject) => {
    const modelPath = path.join(__dirname, 'sketchup/models', modelName).replace(/\\/g, '/'); // Path to empty.skp
    const command = `"${sketchupPath}" -RubyStartup "${sketchupScriptStartServerPath}" "${modelPath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing SketchUp script: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`SketchUp script stderr: ${stderr}`);
      }
      console.log(`SketchUp script stdout: ${stdout}`);
      resolve();
    });
  });
}

function runSketchUpScript() {
  return new Promise((resolve, reject) => {
    const command = `"${sketchupPath}" -RubyStartup "${sketchupScriptStartServerPath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing SketchUp script: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`SketchUp script stderr: ${stderr}`);
      }
      console.log(`SketchUp script stdout: ${stdout}`);
      resolve();
    });
  });
}

async function runRubyScriptInSketchUp(rubyScript) {
  try {
    const message = JSON.stringify({ script: rubyScript });

    const client = new net.Socket();
    client.connect(4567, 'localhost', () => {
      console.log('Connected to SketchUp TCP server');
      client.write(message + '\n');
    });

    client.on('data', (data) => {
      console.log('Response from SketchUp:', data.toString());
      client.destroy();
    });

    client.on('error', (err) => {
      console.error('Error connecting to SketchUp TCP server:', err.message);
    });
  } catch (error) {
    console.error('Error sending Ruby script:', error.message);
  }
}

async function generateImageFuture() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageNewPath = path.join(dataDir, 'image_new.png');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  try {
    await deleteFile(imageNewPath);
    console.log('Deleted existing image_new.png.');

    const rubyScript = fs.readFileSync(process.env.SKETCHUP_SCRIPT_CUSTOM_VIEW_PATH, 'utf8');
    await runRubyScriptInSketchUp(rubyScript);
  } catch (error) {
    console.error('Failed to run SketchUp script:', error);
    return;
  }

  try {
    console.log('Waiting for image_new.png to be generated...');
    await waitForFile(imageNewPath, 60000, 2000);
    console.log('image_new.png is now available.');

    // Validate that image_new.png has been fully written and is non-empty
    const imageNewStats = fs.statSync(imageNewPath);
    if (imageNewStats.size === 0) {
      throw new Error('image_new.png is empty.');
    }

    const [imgRef, imgNew] = await Promise.all([
      PImage.decodeJPEGFromStream(fs.createReadStream(imageRefPath)),
      PImage.decodePNGFromStream(fs.createReadStream(imageNewPath)),
    ]);

    const imgFuture = PImage.make(imgRef.width, imgRef.height);
    const ctx = imgFuture.getContext('2d');
    ctx.drawImage(imgRef, 0, 0);
    ctx.drawImage(imgNew, 0, 0);

    const outStream = fs.createWriteStream(imageFuturePath);
    await PImage.encodePNGToStream(imgFuture, outStream);
    console.log('Generated image_future.png');
  } catch (error) {
    console.error('Error generating image_future:', error);
  }

  refreshImageStatus();
}

function broadcastImageUpdate(imageRefUpdated, imageFutureUpdated) {
  const updateMessage = JSON.stringify({ imageRefUpdated, imageFutureUpdated });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(updateMessage);
    }
  });
}

let imageRefUpdatedAt = null;
let imageFutureUpdatedAt = null;

function updateImageTimestamps() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  if (fs.existsSync(imageRefPath)) {
    imageRefUpdatedAt = fs.statSync(imageRefPath).mtime;
  }
  if (fs.existsSync(imageFuturePath)) {
    imageFutureUpdatedAt = fs.statSync(imageFuturePath).mtime;
  }
}

function refreshImageStatus() {
  const dataDir = path.join(__dirname, '../public/data');
  const imageRefPath = path.join(dataDir, 'image_ref.jpg');
  const imageFuturePath = path.join(dataDir, 'image_future.png');

  const currentImageRefUpdatedAt = fs.existsSync(imageRefPath) ? fs.statSync(imageRefPath).mtime : null;
  const currentImageFutureUpdatedAt = fs.existsSync(imageFuturePath) ? fs.statSync(imageFuturePath).mtime : null;

  const imageRefUpdated = currentImageRefUpdatedAt > imageRefUpdatedAt;
  const imageFutureUpdated = currentImageFutureUpdatedAt > imageFutureUpdatedAt;

  if (imageRefUpdated || imageFutureUpdated) {
    broadcastImageUpdate(imageRefUpdated, imageFutureUpdated);
  }

  updateImageTimestamps();
}

startSketchup();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API to get available models
app.get('/api/models', (req, res) => {
  fs.readdir(sketchupModelDirectory, (err, files) => {
    if (err) {
      console.error('Error reading models directory:', err);
      return res.status(500).json({ error: 'Failed to retrieve models' });
    }
    // Filter out only .skp files and return their names without the extension
    const modelFiles = files.filter(file => path.extname(file) === '.skp').map(file => path.basename(file, '.skp'));
    
    // Log the models being returned
    console.log('Available models:', modelFiles);

    // Return the models as an array under the 'models' key
    res.json({ models: modelFiles });
  });
});

// API to load the selected model using TCP communication with SketchUp
app.post('/api/load-model', async (req, res) => {
  const selectedModel = req.body.model; // Assuming the model name is passed as 'model'

  try {
    if (!selectedModel) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Generate the Ruby script to load the selected model
    const rubyScriptForModel = generateModelLoadScript(selectedModel);
    console.log('Generated Ruby script for loading the model.');

    // Send the Ruby script to SketchUp via TCP
    await runRubyScriptInSketchUp(rubyScriptForModel);
    console.log('Ruby script sent to SketchUp to load the model.');

    // Check if there's a specific Ruby script for the model, and run it if exists
    const modelScriptPath = path.join(__dirname, 'sketchup/models', `${selectedModel}.txt`);
    if (fs.existsSync(modelScriptPath)) {
      // Read the custom Ruby script for this model
      const modelScript = fs.readFileSync(modelScriptPath, 'utf8');
      await runRubyScriptInSketchUp(modelScript);
      console.log('Custom Ruby script for the model executed.');
    } else {
      console.log(`No custom Ruby script found for the model: ${selectedModel}`);
    }

    res.json({ success: true, message: 'Model loaded and Ruby script executed successfully' });
  } catch (error) {
    console.error('Error loading model or executing Ruby script:', error);
    res.status(500).json({ error: 'Failed to load model or execute Ruby script', details: error.message });
  }
});


function generateModelLoadScript(modelName) {
  // Construct the model path, ensuring it uses forward slashes
  const modelPath = path.join(__dirname, 'sketchup/models', `${modelName}.skp`).replace(/\\/g, '/');
  
  // Generate the Ruby script to open the model instead of importing it
  return `
    # Define the path of the model to open
    model_path = "${modelPath}"
    
    # Open the model file and replace the current one
    if File.exist?(model_path)
      Sketchup.active_model.close(true)
      Sketchup.open_file(model_path)
      puts "Opened model: #{model_path}"
    else
      puts "Error: The model file '#{model_path}' does not exist."
    end
  `;
}







async function runModelRubyScript(modelName) {
  const scriptPath = path.join(__dirname, 'sketchup/models', `${modelName}.txt`);

  let rubyScript;
  try {
    rubyScript = fs.readFileSync(scriptPath, 'utf8');
    console.log(`Running Ruby script for model: ${modelName}`);
  } catch (error) {
    console.error(`Failed to load Ruby script for ${modelName}:`, error);
    throw error;  // Throw error so the main function handles it
  }

  // Send the Ruby script to SketchUp via TCP
  await runRubyScriptInSketchUp(rubyScript);
}

// API endpoint to proxy Street View requests and save camera parameters
app.get('/api/streetview', async (req, res) => {
  const { latitude, longitude, heading, pitch, fov } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY;
  const apiKey2 = process.env.GOOGLE_MAPS_API_KEY;

  let elevation = 0;

  try {
    const elevationApiUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${latitude},${longitude}&key=${apiKey2}`;
    const elevationResponse = await axios.get(elevationApiUrl);

    if (elevationResponse.data && elevationResponse.data.results && elevationResponse.data.results.length > 0) {
      elevation = elevationResponse.data.results[0].elevation;
    } else {
      throw new Error('Elevation data not found.');
    }
  } catch (error) {
    console.error('Error fetching elevation:', error.message);
    return res.status(500).json({ error: 'Failed to fetch elevation data' });
  }

  console.log('Received parameters:', { latitude, longitude, heading, pitch, fov });

  const cameraParams = {
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    elevation: parseFloat(elevation),
    heading: parseFloat(heading),
    pitch: parseFloat(pitch),
    fov: parseFloat(fov)
  };

  const filePath = path.join(__dirname, '../server/data/camera_params.json');
  fs.writeFileSync(filePath, JSON.stringify(cameraParams, null, 2));

  const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${latitude},${longitude}&heading=${heading}&pitch=${pitch}&fov=${fov}&key=${apiKey}`;

  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

    if (response.status === 200) {
      const imageRefPath = path.join(__dirname, '../public/data/image_ref.jpg');
      fs.writeFileSync(imageRefPath, response.data);
      res.set('Content-Type', 'image/jpeg');
      res.send(response.data);

      generateImageFuture();
    } else {
      return res.status(response.status).send('Error fetching Street View image');
    }
  } catch (error) {
    return res.status(500).send('Internal Server Error');
  }
});

const server = app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
