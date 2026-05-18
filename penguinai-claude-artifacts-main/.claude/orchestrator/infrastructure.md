# Phase 0.5: Infrastructure Setup (MANDATORY)

Before spawning any agent, verify ALL required infrastructure is running.

---

## Step 1: Discover Existing Credentials (FIRST!)

```bash
# Search for existing .env files
echo "Searching for existing .env files..."
find ../.. -name ".env" -type f 2>/dev/null

# If found, read and list credentials
# Ask user: "Should I use these credentials for the new project?"
```

---

## Step 2: Start Services

```bash
# Start services
mongod --dbpath /usr/local/var/mongodb &   # Or: docker run -d -p 27017:27017 mongo
redis-server &                              # Or: docker run -d -p 6379:6379 redis

# Verify
mongosh --eval "db.runCommand({ping:1})"
redis-cli ping
```

---

## Step 3: Create .env Files

**If existing credentials found:**
```bash
# Write to PROJECT ROOT .env (NOT backend/.env)
# Docker compose reads this via env_file, Settings UI also writes here
cat > .env << EOF
# Database
MONGODB_URL=mongodb://localhost:27017/app_db
REDIS_URL=redis://localhost:6379

# Auth (generate new)
JWT_SECRET=$(openssl rand -hex 32)

# === Copied from existing .env ===
AWS_ACCESS_KEY_ID=<from_existing>
AWS_SECRET_ACCESS_KEY=<from_existing>
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=<app_name>  # Per-app folder prefix within the shared bucket
AZURE_OCR_ENDPOINT=<from_existing>
AZURE_OCR_SECRET_KEY=<from_existing>
EOF
```

**If NO existing credentials:**
```bash
cat > .env << EOF
MONGODB_URL=mongodb://localhost:27017/app_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -hex 32)

# MISSING - Ask user (NO FALLBACK FOR S3)
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
# S3_APP_PREFIX=<app_name>
# AZURE_OCR_ENDPOINT=
# AZURE_OCR_SECRET_KEY=
EOF
```

**AWS/S3 Variables (if `file_storage`, `document_processing`, or LLM provider is `bedrock`):**

If AWS credentials not found and any of the above capabilities are selected:
1. DO NOT proceed
2. If `file_storage` or `document_processing`: DO NOT offer local storage alternative
3. Ask user: "AWS credentials are required for selected capabilities. Please provide AWS credentials (and bucket name if using S3)."
4. Wait for user response
5. Only continue after required AWS variables are confirmed

**BLOCKING:** Do NOT spawn Phase 1 until:
1. All required services are verified running
2. Credentials are discovered/collected and copied to project .env files
3. If applicable: **AWS/S3 validation passed** (see Step 4 below)

---

## Step 4: AWS/S3 Validation (if applicable capabilities selected)

**If `file_storage`, `document_processing`, or LLM provider is `bedrock`, AWS credentials are required. If `file_storage` or `document_processing`, S3 bucket is also required. There is NO local file storage fallback for S3-dependent capabilities. For non-Bedrock LLM providers (gemini, openai, azure_openai), AWS credentials are only needed if `file_storage` or `document_processing` is also selected.**

This validation BLOCKS subsequent phases when applicable capabilities are selected.

### Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes | AWS access key (permanent IAM key, starts with `AKIA`) |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key |
| `S3_BUCKET_NAME` | Has default | S3 bucket name (default: `workflow-builder-platform-backend-uploads`) |
| `S3_APP_PREFIX` | Yes | Per-app folder prefix within the shared bucket |
| `AWS_REGION` | Has default | AWS region (default: `us-east-1`) |

### Validation Script

```bash
# Check all required S3 variables exist
REQUIRED_VARS=("AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "S3_APP_PREFIX")

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "BLOCKING: Missing required S3 variable: $var"
    echo "S3 integration is MANDATORY. Cannot proceed."
    exit 1
  fi
done

echo "S3 credentials validated"
```

### If AWS/S3 Validation Fails

**HARD STOP.** Present this message to the user:

> **BLOCKING: AWS Credentials Required**
>
> Selected capabilities require AWS credentials. Cannot proceed without:
> - `AWS_ACCESS_KEY_ID`
> - `AWS_SECRET_ACCESS_KEY`
> - `S3_APP_PREFIX` (if `file_storage` or `document_processing`)
>
> **Options:**
> 1. Provide AWS credentials now
> 2. Create an S3 bucket in AWS Console and provide credentials (if S3 needed)
>
> **If `file_storage` or `document_processing`: there is no local storage fallback.**

**DO NOT:**
- Offer local file storage as alternative when S3 capabilities are selected
- Skip AWS/S3 validation for capabilities that require it
- Proceed to Phase 1 without required credentials
- Generate mock S3 responses
