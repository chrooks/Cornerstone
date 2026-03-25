# Cornerstone

A full-stack NBA roster builder and skill evaluation platform built with Next.js, Flask, and Supabase.

Users select an all-time great as their **cornerstone player**, build an 8-man roster from current NBA players within a salary cap, and receive an AI-generated compatibility evaluation across offensive fit, defensive fit, and role clarity.

All player ratings are grounded in a custom **19-skill taxonomy** rated at three tiers (None, Capable, Elite), generated from live NBA stats and validated via Claude AI.

---

## How It Works

The app is built in three parts, in dependency order:

### Part 1 — Player Skill Profile Pipeline
An internal toolset for generating and curating skill profiles for every qualifying current NBA player.

- The Flask backend fetches live stats from NBA.com via `nba_api` — including tracking data, play type splits, and advanced metrics
- A stat-to-skill mapping system translates raw numbers into ratings on the 19-skill taxonomy
- A Claude API integration independently rates each player on the same taxonomy
- The two ratings are composited via a confidence system: agreements are auto-accepted, disagreements are flagged for manual review
- The Next.js frontend provides a **threshold calibration tool**, a **pipeline runner**, and a **review queue** for resolving flagged profiles

### Part 2 — Legends Profile Builder
A manual profile editor for 36 all-time NBA legends who have no modern stats.

- Each legend is rated on the same 19-skill taxonomy via a Next.js UI
- A **Claude suggestion feature** pre-populates ratings based on basketball knowledge for the user to accept or override

### Part 3 — Roster Builder and Evaluator *(scaffolded for future build)*
The user-facing product.

- Users browse current players and their skill profiles, and select an all-time great as their cornerstone
- An 8-man roster is assembled within a salary cap budget
- A **compatibility engine** evaluates roster cohesion across offensive fit, defensive fit, and role clarity
- A score and narrative evaluation is generated via the Claude API

All skill profiles, thresholds, flags, and legend profiles are persisted in Supabase.

---

## Project Structure

```
cornerstone/
  backend/    Flask API — stat fetching, skill mapping, Claude integration
  frontend/   Next.js app — pipeline UI, review queue, roster builder
```

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com) (for Claude integration)

---

## Supabase Setup

1. Create a new project at https://supabase.com
2. From your project dashboard, copy:
   - **Project URL** (Settings > API > Project URL)
   - **Service Role Key** (Settings > API > service_role secret key)
   - **Anon/Public Key** (Settings > API > anon public key)

---

## Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and fill in your credentials

# Run the dev server
flask run --port=5001
```

The API will be available at http://localhost:5001.
Health check: `GET http://localhost:5001/api/health`

---

## Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local and fill in your credentials

# Run the dev server
npm run dev
```

The app will be available at http://localhost:3000.

---

## Environment Variables

### backend/.env

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key (keep secret) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude integration |

### frontend/.env.local

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Flask backend URL (default: `http://localhost:5001`) |
