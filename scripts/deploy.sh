#!/bin/bash

# Deployment script for MyHippo Transcription System

set -e

echo "=== MyHippo Transcription System Deployment ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists wrangler; then
    echo -e "${YELLOW}⚠️  Wrangler CLI not found. Installing...${NC}"
    npm install -g wrangler
fi

echo -e "${GREEN}✓ Prerequisites checked${NC}"
echo ""

# Deploy Cloudflare Worker
echo "Deploying Cloudflare Worker..."
cd ../cloudflare-worker

if [ ! -f "wrangler.toml" ]; then
    echo -e "${RED}❌ wrangler.toml not found${NC}"
    exit 1
fi

# Check if database ID is configured
if grep -q "YOUR_DATABASE_ID" wrangler.toml; then
    echo -e "${YELLOW}⚠️  Database ID not configured in wrangler.toml${NC}"
    echo "Creating D1 database..."
    
    DB_OUTPUT=$(wrangler d1 create myhippo-transcriptions 2>&1)
    DB_ID=$(echo "$DB_OUTPUT" | grep -oP 'database_id = "\K[^"]+')
    
    if [ -z "$DB_ID" ]; then
        echo -e "${RED}❌ Failed to create database${NC}"
        exit 1
    fi
    
    # Update wrangler.toml with database ID
    sed -i.bak "s/YOUR_DATABASE_ID/$DB_ID/g" wrangler.toml
    echo -e "${GREEN}✓ Database created with ID: $DB_ID${NC}"
    
    # Initialize database schema
    echo "Initializing database schema..."
    wrangler d1 execute myhippo-transcriptions --file=./schema.sql
    echo -e "${GREEN}✓ Database schema initialized${NC}"
fi

# Check if KV namespace ID is configured
if grep -q "YOUR_KV_NAMESPACE_ID" wrangler.toml; then
    echo -e "${YELLOW}⚠️  KV namespace ID not configured in wrangler.toml${NC}"
    echo "Creating KV namespace..."
    
    KV_OUTPUT=$(wrangler kv:namespace create "CACHE" 2>&1)
    KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "\K[^"]+')
    
    if [ -z "$KV_ID" ]; then
        echo -e "${RED}❌ Failed to create KV namespace${NC}"
        exit 1
    fi
    
    # Update wrangler.toml with KV namespace ID
    sed -i.bak "s/YOUR_KV_NAMESPACE_ID/$KV_ID/g" wrangler.toml
    echo -e "${GREEN}✓ KV namespace created with ID: $KV_ID${NC}"
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Check if Deepgram API key is set
echo ""
echo "Checking Deepgram API key..."
if ! wrangler secret list | grep -q "DEEPGRAM_API_KEY"; then
    echo -e "${YELLOW}⚠️  Deepgram API key not found${NC}"
    echo "Please enter your Deepgram API key:"
    wrangler secret put DEEPGRAM_API_KEY
else
    echo -e "${GREEN}✓ Deepgram API key is configured${NC}"
fi

# Deploy the worker
echo ""
echo "Deploying worker to Cloudflare..."
npm run deploy

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Worker deployed successfully!${NC}"
    
    # Get worker URL
    WORKER_URL=$(wrangler deploy --dry-run 2>&1 | grep -oP 'https://[^\s]+\.workers\.dev')
    
    if [ ! -z "$WORKER_URL" ]; then
        echo ""
        echo "=== Deployment Complete ==="
        echo -e "Worker URL: ${GREEN}$WORKER_URL${NC}"
        echo -e "Dashboard: ${GREEN}$WORKER_URL/dashboard${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Configure R2 event notifications in Cloudflare dashboard"
        echo "2. Set up local uploader with your R2 credentials"
        echo "3. Start uploading audio files!"
    fi
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Create deployment summary
echo ""
echo "Creating deployment summary..."
cat > deployment-summary.txt << EOF
MyHippo Transcription System Deployment Summary
=============================================
Date: $(date)

Cloudflare Worker:
- URL: $WORKER_URL
- Dashboard: $WORKER_URL/dashboard
- Database ID: $DB_ID
- KV Namespace ID: $KV_ID

API Endpoints:
- GET  /api/health - Health check
- GET  /api/status/{jobId} - Get job status
- GET  /api/result/{jobId} - Get transcription result
- POST /api/transcribe - Manual transcription trigger
- GET  /api/stats/today - Today's statistics
- GET  /api/jobs/recent - Recent jobs list

Local Uploader Setup:
1. cd ../local-uploader
2. cp .env.example .env
3. Edit .env with your R2 credentials
4. npm install
5. npm start

Remember to:
- Set up R2 event notifications for automatic processing
- Monitor daily costs in the dashboard
- Check worker logs with: wrangler tail
EOF

echo -e "${GREEN}✓ Deployment summary saved to deployment-summary.txt${NC}"