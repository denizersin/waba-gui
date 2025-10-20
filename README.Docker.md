# Docker Deployment Guide

This guide will help you build and deploy the WhatsApp Chat application using Docker.

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, but recommended)
- Environment variables configured

## Quick Start

### 1. Configure Environment Variables

Copy the example environment file and fill in your actual values:

```bash
cp .env.example .env
```

Edit `.env` and add your:
- Supabase credentials
- AWS S3 credentials
- Other configuration values

### 2. Build and Run with Docker Compose (Recommended)

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The application will be available at `http://localhost:3000`

### 3. Build and Run with Docker (Alternative)

If you prefer to use Docker directly without Docker Compose:

```bash
# Build the image
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY="your-anon-key" \
  -t whatsapp-chat:latest .

# Run the container
docker run -d \
  --name whatsapp-chat-app \
  -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co" \
  -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY="your-anon-key" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  -e AWS_REGION="ap-south-1" \
  -e AWS_ACCESS_KEY_ID="your-access-key" \
  -e AWS_SECRET_ACCESS_KEY="your-secret-key" \
  -e AWS_BUCKET_NAME="your-bucket-name" \
  whatsapp-chat:latest

# View logs
docker logs -f whatsapp-chat-app

# Stop the container
docker stop whatsapp-chat-app
docker rm whatsapp-chat-app
```

## Environment Variables

### Required Variables

#### Supabase Configuration
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY` - Your Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

#### AWS S3 Configuration
- `AWS_REGION` - AWS region (e.g., `ap-south-1`)
- `AWS_ACCESS_KEY_ID` - Your AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret access key
- `AWS_BUCKET_NAME` - Your S3 bucket name

### Optional Variables
- `NEXT_TELEMETRY_DISABLED` - Set to `1` to disable Next.js telemetry

## Production Deployment

### Deploy to Cloud Platforms

#### 1. AWS ECS/Fargate

```bash
# Build and tag the image
docker build -t whatsapp-chat:latest .

# Tag for ECR
docker tag whatsapp-chat:latest your-account.dkr.ecr.region.amazonaws.com/whatsapp-chat:latest

# Push to ECR
docker push your-account.dkr.ecr.region.amazonaws.com/whatsapp-chat:latest

# Deploy to ECS (configure task definition with environment variables)
```

#### 2. Google Cloud Run

```bash
# Build and tag for Google Container Registry
docker build -t gcr.io/your-project-id/whatsapp-chat:latest .

# Push to GCR
docker push gcr.io/your-project-id/whatsapp-chat:latest

# Deploy to Cloud Run
gcloud run deploy whatsapp-chat \
  --image gcr.io/your-project-id/whatsapp-chat:latest \
  --platform managed \
  --region your-region \
  --allow-unauthenticated \
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=your-url,..."
```

#### 3. Azure Container Instances

```bash
# Build and tag for Azure Container Registry
docker build -t yourregistry.azurecr.io/whatsapp-chat:latest .

# Push to ACR
docker push yourregistry.azurecr.io/whatsapp-chat:latest

# Deploy to ACI
az container create \
  --resource-group your-resource-group \
  --name whatsapp-chat \
  --image yourregistry.azurecr.io/whatsapp-chat:latest \
  --dns-name-label whatsapp-chat \
  --ports 3000 \
  --environment-variables \
    NEXT_PUBLIC_SUPABASE_URL=your-url \
    ...
```

#### 4. DigitalOcean App Platform

```bash
# Build and push to DigitalOcean Container Registry
docker build -t registry.digitalocean.com/your-registry/whatsapp-chat:latest .
docker push registry.digitalocean.com/your-registry/whatsapp-chat:latest

# Create app via UI or doctl
doctl apps create --spec .do/app.yaml
```

## Docker Image Optimization

The Dockerfile uses a multi-stage build process to create a minimal production image:

1. **Base Stage**: Sets up the base Node.js Alpine image
2. **Deps Stage**: Installs dependencies only
3. **Builder Stage**: Builds the Next.js application
4. **Runner Stage**: Creates the final production image with only necessary files

### Image Size

The final production image is optimized to be as small as possible:
- Uses Alpine Linux (minimal base image)
- Leverages Next.js standalone output
- Only includes production dependencies
- Excludes development files and build artifacts

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs whatsapp-chat-app
```

### Environment variables not working

Ensure all required environment variables are set:
```bash
docker exec whatsapp-chat-app env | grep -E "SUPABASE|AWS"
```

### Port already in use

Change the host port in docker-compose.yml or use a different port:
```bash
docker run -p 8080:3000 whatsapp-chat:latest
```

### Build fails

Clear Docker cache and rebuild:
```bash
docker-compose build --no-cache
```

## Health Check

The container includes a health check that verifies the application is running:

```bash
# Check container health status
docker inspect --format='{{.State.Health.Status}}' whatsapp-chat-app

# Manual health check
curl http://localhost:3000/api/health
```

## Security Best Practices

1. **Never commit `.env` files** - Keep sensitive data secure
2. **Use secrets management** - For production, use Docker secrets or cloud provider secrets
3. **Run as non-root** - The container runs as user `nextjs` (UID 1001)
4. **Keep images updated** - Regularly rebuild with latest base images
5. **Scan for vulnerabilities** - Use `docker scan whatsapp-chat:latest`

## Development vs Production

For development, use:
```bash
npm run dev
```

For production with Docker:
```bash
docker-compose up
```

## Support

If you encounter issues, please check:
- Docker logs: `docker logs whatsapp-chat-app`
- Application logs inside container: `docker exec whatsapp-chat-app cat /app/.next/trace`
- Container resource usage: `docker stats whatsapp-chat-app`

