import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import chokidar from 'chokidar';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import winston from 'winston';
import PQueue from 'p-queue';
import crypto from 'crypto';

dotenv.config();

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'uploader.log' })
  ]
});

// Configure S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Upload queue to control concurrency
const uploadQueue = new PQueue({ 
  concurrency: parseInt(process.env.UPLOAD_CONCURRENCY || '3') 
});

// Track processed files to avoid duplicates
const processedFiles = new Set();

async function loadProcessedFiles() {
  try {
    const data = await fs.readFile('.processed_files', 'utf8');
    data.split('\n').filter(f => f).forEach(f => processedFiles.add(f));
    logger.info(`Loaded ${processedFiles.size} processed files`);
  } catch (error) {
    logger.info('No processed files history found, starting fresh');
  }
}

async function saveProcessedFile(filePath) {
  processedFiles.add(filePath);
  await fs.appendFile('.processed_files', filePath + '\n');
}

async function calculateFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = await fs.readFile(filePath);
  hash.update(stream);
  return hash.digest('hex');
}

async function uploadFile(filePath) {
  const startTime = Date.now();
  const fileName = path.basename(filePath);
  const fileStats = await fs.stat(filePath);
  
  try {
    // Calculate file hash for deduplication
    const fileHash = await calculateFileHash(filePath);
    
    // Create metadata for the upload
    const metadata = {
      'original-filename': fileName,
      'upload-timestamp': new Date().toISOString(),
      'file-size': fileStats.size.toString(),
      'file-hash': fileHash,
      'local-path': filePath
    };
    
    // Generate S3 key with date organization
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const key = `audio/${year}/${month}/${day}/${fileName}`;
    
    logger.info(`Uploading ${fileName} to R2...`);
    
    // Use multipart upload for large files
    const fileStream = await fs.readFile(filePath);
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: fileStream,
        Metadata: metadata,
        ContentType: 'audio/mpeg', // Adjust based on your audio format
      },
    });
    
    upload.on('httpUploadProgress', (progress) => {
      const percentage = Math.round((progress.loaded / progress.total) * 100);
      logger.debug(`Upload progress for ${fileName}: ${percentage}%`);
    });
    
    await upload.done();
    
    const duration = Date.now() - startTime;
    logger.info(`Successfully uploaded ${fileName} in ${duration}ms`);
    
    // Mark file as processed
    await saveProcessedFile(filePath);
    
    // Move file to processed directory if configured
    if (process.env.PROCESSED_DIRECTORY) {
      const processedPath = path.join(
        process.env.PROCESSED_DIRECTORY, 
        fileName
      );
      await fs.rename(filePath, processedPath);
      logger.info(`Moved ${fileName} to processed directory`);
    }
    
  } catch (error) {
    logger.error(`Failed to upload ${fileName}:`, error);
    throw error;
  }
}

async function processExistingFiles() {
  const watchDir = process.env.WATCH_DIRECTORY;
  
  try {
    const files = await fs.readdir(watchDir);
    const audioFiles = files.filter(f => 
      /\.(mp3|wav|m4a|aac|ogg|flac|wma|opus)$/i.test(f)
    );
    
    logger.info(`Found ${audioFiles.length} existing audio files`);
    
    for (const file of audioFiles) {
      const filePath = path.join(watchDir, file);
      if (!processedFiles.has(filePath)) {
        uploadQueue.add(() => uploadFile(filePath));
      }
    }
  } catch (error) {
    logger.error('Error processing existing files:', error);
  }
}

async function main() {
  logger.info('MyHippo Audio Uploader starting...');
  
  // Validate configuration
  const requiredEnvVars = [
    'R2_ACCOUNT_ID', 
    'R2_ACCESS_KEY_ID', 
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'WATCH_DIRECTORY'
  ];
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      logger.error(`Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }
  
  // Create processed directory if it doesn't exist
  if (process.env.PROCESSED_DIRECTORY) {
    await fs.mkdir(process.env.PROCESSED_DIRECTORY, { recursive: true });
  }
  
  // Load previously processed files
  await loadProcessedFiles();
  
  // Process any existing files
  await processExistingFiles();
  
  // Set up file watcher
  const watcher = chokidar.watch(process.env.WATCH_DIRECTORY, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    },
  });
  
  watcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.opus'];
    
    if (audioExtensions.includes(ext) && !processedFiles.has(filePath)) {
      logger.info(`New audio file detected: ${path.basename(filePath)}`);
      uploadQueue.add(() => uploadFile(filePath));
    }
  });
  
  watcher.on('error', error => {
    logger.error('Watcher error:', error);
  });
  
  logger.info(`Watching for audio files in: ${process.env.WATCH_DIRECTORY}`);
  logger.info(`Upload queue concurrency: ${process.env.UPLOAD_CONCURRENCY || 3}`);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    await watcher.close();
    await uploadQueue.onIdle();
    process.exit(0);
  });
}

// Start the uploader
main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});