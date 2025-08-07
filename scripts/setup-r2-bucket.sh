#!/bin/bash

# Setup script for Cloudflare R2 bucket
# This script helps you configure the R2 bucket and generates necessary credentials

echo "=== MyHippo R2 Bucket Setup ==="
echo ""
echo "This script will guide you through setting up your Cloudflare R2 bucket."
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

echo "1. First, login to Cloudflare:"
wrangler login

echo ""
echo "2. Create R2 bucket for audio files:"
read -p "Enter bucket name (default: myhippo-audio-files): " BUCKET_NAME
BUCKET_NAME=${BUCKET_NAME:-myhippo-audio-files}

wrangler r2 bucket create $BUCKET_NAME

echo ""
echo "3. Create R2 API token:"
echo "Visit: https://dash.cloudflare.com/profile/api-tokens"
echo "Create a token with the following permissions:"
echo "  - Account: Cloudflare R2:Edit"
echo "  - Zone Resources: Include - All zones"
echo ""
echo "You'll need to copy these values from the R2 API token creation page:"
echo ""

# Get R2 credentials
read -p "Enter your R2 Access Key ID: " R2_ACCESS_KEY_ID
read -s -p "Enter your R2 Secret Access Key: " R2_SECRET_ACCESS_KEY
echo ""
read -p "Enter your Cloudflare Account ID: " R2_ACCOUNT_ID

# Save credentials to .env file
echo ""
echo "Saving credentials to local-uploader/.env..."
cat > ../local-uploader/.env << EOF
# Cloudflare R2 credentials
R2_ACCOUNT_ID=$R2_ACCOUNT_ID
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=$BUCKET_NAME

# Local configuration
WATCH_DIRECTORY=/path/to/audio/files
PROCESSED_DIRECTORY=/path/to/processed/files
UPLOAD_CONCURRENCY=3

# Logging
LOG_LEVEL=info
EOF

echo "Credentials saved to local-uploader/.env"
echo "⚠️  IMPORTANT: Update WATCH_DIRECTORY and PROCESSED_DIRECTORY in the .env file!"

echo ""
echo "4. Configure CORS for the bucket (allows Worker access):"
cat > cors.json << EOF
{
  "CorsRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF

echo "CORS configuration saved to cors.json"

echo ""
echo "5. Create bucket lifecycle rules for cost optimization:"
cat > lifecycle.json << EOF
{
  "Rules": [
    {
      "ID": "archive-old-audio",
      "Status": "Enabled",
      "Prefix": "audio/",
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ]
    },
    {
      "ID": "delete-old-transcriptions",
      "Status": "Enabled", 
      "Prefix": "transcriptions/",
      "Expiration": {
        "Days": 365
      }
    }
  ]
}
EOF

echo "Lifecycle rules saved to lifecycle.json"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env in the local-uploader directory"
echo "2. Fill in your R2 credentials from the Cloudflare dashboard"
echo "3. Run 'npm install' in the local-uploader directory"
echo "4. Start the uploader with 'npm start'"
echo ""
echo "Your R2 bucket '$BUCKET_NAME' is ready to receive audio files!"