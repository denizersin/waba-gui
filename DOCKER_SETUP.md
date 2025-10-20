# Docker Setup Instructions

## Quick Setup Guide

### Step 1: Create Environment File

On your server, create a `.env` file with your actual credentials:

```bash
cd ~/wachat/code/whatsapp-chat

# Create .env file
cat > .env << 'EOF'
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# AWS S3 Configuration
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_BUCKET_NAME=your-bucket-name
EOF
```

**IMPORTANT:** Replace all the placeholder values with your actual credentials!

### Step 2: Edit the .env file

```bash
nano .env
# or
vi .env
```

Update all the values:
- Get Supabase values from: https://app.supabase.com/project/_/settings/api
- Get AWS values from your AWS IAM console

### Step 3: Build and Run

```bash
# Using docker compose (new syntax)
docker compose up -d

# Or using docker-compose (old syntax, if installed)
docker-compose up -d

# View logs
docker compose logs -f whatsapp-chat

# Check status
docker compose ps
```

## Troubleshooting

### If you get warnings about Edge Runtime

These warnings are normal and won't prevent the build. The app will still work correctly.

### If build fails with "no NEXT_PUBLIC_SUPABASE_URL"

Make sure your `.env` file exists and has the correct values:

```bash
# Check if .env exists
ls -la .env

# View .env contents (be careful not to share this output!)
cat .env

# Verify docker-compose can read it
docker compose config
```

### If docker-compose command not found

Use the new syntax:
```bash
docker compose up -d
```

Or install docker-compose:
```bash
sudo apt-get update
sudo apt-get install docker-compose-plugin
```

## Complete Deployment Commands

```bash
# Stop any running containers
docker compose down

# Remove old images (optional, for clean build)
docker compose down --rmi all

# Build and start (fresh build)
docker compose up -d --build

# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down
```

## Verify Deployment

```bash
# Check if container is running
docker compose ps

# Check logs for errors
docker compose logs whatsapp-chat

# Test the application
curl http://localhost:3000

# Check inside container (if needed)
docker compose exec whatsapp-chat sh
```

## Environment Variables Checklist

Make sure your `.env` file contains:
- ✅ NEXT_PUBLIC_SUPABASE_URL
- ✅ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY  
- ✅ SUPABASE_SERVICE_ROLE_KEY
- ✅ AWS_REGION
- ✅ AWS_ACCESS_KEY_ID
- ✅ AWS_SECRET_ACCESS_KEY
- ✅ AWS_BUCKET_NAME

## Production Checklist

Before deploying to production:
1. ✅ Set all environment variables in `.env`
2. ✅ Ensure `.env` is in `.gitignore` (never commit it!)
3. ✅ Test the build locally: `docker compose up`
4. ✅ Check logs for errors: `docker compose logs -f`
5. ✅ Set up SSL/HTTPS (use nginx or traefik as reverse proxy)
6. ✅ Configure firewall rules
7. ✅ Set up monitoring and logging
8. ✅ Configure automated backups

## Security Notes

- Never commit `.env` file to git
- Use strong, unique credentials
- Regularly rotate AWS keys
- Set up proper firewall rules
- Use HTTPS in production
- Monitor access logs

## Need Help?

If you encounter issues:
1. Check logs: `docker compose logs -f`
2. Verify env vars: `docker compose config`
3. Check container status: `docker compose ps`
4. Rebuild from scratch: `docker compose up -d --build --force-recreate`

