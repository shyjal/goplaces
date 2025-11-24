import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fal } from '@fal-ai/client';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Configure fal.ai client
fal.config({
  credentials: process.env.FAL_KEY
});

// Convert decimal degrees to DMS (Degrees, Minutes, Seconds) format
function convertToDMS(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  
  const absLat = Math.abs(lat);
  const absLng = Math.abs(lng);
  
  const latDeg = Math.floor(absLat);
  const latMin = Math.floor((absLat - latDeg) * 60);
  const latSec = Math.round(((absLat - latDeg) * 60 - latMin) * 60);
  
  const lngDeg = Math.floor(absLng);
  const lngMin = Math.floor((absLng - lngDeg) * 60);
  const lngSec = Math.round(((absLng - lngDeg) * 60 - lngMin) * 60);
  
  return `${latDeg}°${latMin}′${latSec}″${latDir}, ${lngDeg}°${lngMin}′${lngSec}″${lngDir}`;
}

app.get('/', (req, res) => {
  res.send('GoPlaces API is running');
});

app.post('/api/generate', upload.single('image'), async (req: any, res: any) => {
  console.log('--- Received Image Generation Request ---');
  try {
    const { lat, lng } = req.body;
    const file = req.file;

    console.log('Request Data:', {
      lat,
      lng,
      file: file ? {
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size
      } : 'No file provided'
    });

    if (!file) {
      console.error('Error: No image file provided');
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log('Uploading image to fal.ai...');

    // Upload the image to fal.ai storage
    const imageBuffer = fs.readFileSync(file.path);
    const uploadedImage = await fal.storage.upload(imageBuffer, file.mimetype);
    
    console.log('Image uploaded:', uploadedImage);

    const locationDMS = convertToDMS(parseFloat(lat), parseFloat(lng));
    const prompt = `Create an image of ${locationDMS} with this person there. Use ONLY the person from the uploaded image - ignore all background, objects, and scenery from the original photo. Use good lighting and natural pose that fits the location. The person should look natural and well-integrated into the environment.`;
    
    console.log('Location in DMS format:', locationDMS);

    console.log('Prompt:', prompt);
    console.log('Generating image with fal.ai nano-banana-pro/edit...');

    // Generate image using fal.ai
    const result = await fal.subscribe('fal-ai/nano-banana-pro/edit', {
      input: {
        prompt: prompt,
        image_urls: [uploadedImage]
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          update.logs.map((log) => log.message).forEach(console.log);
        }
      },
    });

    console.log('Generation result:', result.data);
    console.log('Request ID:', result.requestId);

    // Extract the generated image URL
    const generatedImageUrl = result.data?.images?.[0]?.url || result.data?.image?.url;

    if (!generatedImageUrl) {
      console.error('No image URL in response:', result.data);
      throw new Error('No image generated');
    }

    console.log('Image generated successfully:', generatedImageUrl);

    res.json({ 
      success: true, 
      imageUrl: generatedImageUrl,
      message: 'Image generated successfully with fal.ai',
      requestId: result.requestId
    });

    // Cleanup uploaded file
    fs.unlinkSync(file.path);
    console.log('Temporary file cleaned up.');

  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).json({ error: 'Failed to generate image. ' + (error as Error).message });
  }
  console.log('--- Request processing finished ---');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
