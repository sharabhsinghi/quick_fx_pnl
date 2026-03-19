---

## Getting Started

### 1. Clone or download this repo

```bash
git clone https://github.com/YOUR_USERNAME/quick_fx_pnl.git
cd quick_fx_pnl
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run locally

```bash
npm start
```

The app opens at `http://localhost:3000`.

---

## Deploy to GitHub Pages

### Step 1: Create a GitHub repository

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `quick_fx_pnl` (or anything you like)
3. Leave it public, don't add README yet
4. Click **Create repository**

### Step 2: Set the homepage in package.json

Open `package.json` and update the `"homepage"` field to match your GitHub Pages URL:

```json
"homepage": "https://YOUR_USERNAME.github.io/quick_fx_pnl"
```

Replace `YOUR_USERNAME` with your GitHub username and `quick_fx_pnl` with your repo name.

### Step 3: Push your code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quick_fx_pnl.git
git push -u origin main
```

### Step 4: Deploy

```bash
npm run deploy
```

This runs `npm run build` then pushes the build to the `gh-pages` branch automatically.

### Step 5: Enable GitHub Pages

1. Go to your repo on GitHub → **Settings** → **Pages**
2. Under **Source**, select branch: `gh-pages`, folder: `/ (root)`
3. Click **Save**

Your app will be live at:
```
https://YOUR_USERNAME.github.io/quick_fx_pnl
```

*(It may take 1–2 minutes for the first deployment to go live.)*

### Updating the app

Whenever you make changes:

```bash
npm run deploy
```

That's it — it rebuilds and redeploys automatically.

---