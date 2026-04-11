
# Deployment Instructions

This application can be deployed on various platforms using Docker.

## Docker Deployment

### Build and run locally:
```bash
docker build -t google-phishing-app .
docker run -p 5000:5000 -v $(pwd)/data:/app/data google-phishing-app
```

### Using Docker Compose:
```bash
docker-compose up -d
```

## Platform-Specific Deployment

### Railway
1. Connect your GitHub repository to Railway
2. Railway will automatically detect the Dockerfile
3. Set environment variables in Railway dashboard
4. Deploy automatically

### Render
1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Render will automatically detect the Dockerfile
4. Set environment variables in Render dashboard
5. Deploy

### Fly.io
```bash
fly launch
fly deploy
```

### DigitalOcean App Platform
1. Create a new app from GitHub repository
2. DigitalOcean will detect the Dockerfile
3. Configure environment variables
4. Deploy

### Heroku (Container Registry)
```bash
heroku create your-app-name
heroku container:push web
heroku container:release web
```

## Environment Variables

Make sure to set these environment variables on your deployment platform:
- `NODE_ENV=production`
- `PORT=5000` (or as required by platform)

## Health Check

The application includes a health check endpoint at `/health` for monitoring.

## Data Persistence

The `/app/data` directory contains:
- `storage.json` - Session data
- `blocked_ips.json` - Blocked IP addresses
- `bots.txt` - Bot detection logs

Mount this directory as a volume for data persistence.
