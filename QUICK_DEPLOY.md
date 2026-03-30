# 🚀 PickTime - Quick Deploy Guide

## Step 1: Create GitHub Repository
1. Go to: https://github.com/new
2. Repository name: `picktime`
3. Make it Public
4. Click "Create repository"

## Step 2: Push Code
```bash
cd picktime
git push -u origin main
```

## Step 3: Deploy to Render (FREE)
1. Go to: https://render.com
2. Click "New Web Service"
3. Connect your GitHub account
4. Select the `picktime` repository
5. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** `Node`
6. Click "Deploy Web Service"

## Step 4: Wait & Enjoy!
- Render will build and deploy automatically
- You'll get a URL like: `https://picktime-xxxx.onrender.com`

## Cost: $0/month
- 750 hours free (enough for demo/testing)
- Sleeps after 15 minutes of inactivity
- Wakes up automatically when accessed

Your PickTime will be live on the internet! 🎉