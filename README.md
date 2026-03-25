# Cornerstone

Full-stack NBA analytics app with a Flask backend and Next.js frontend, powered by Supabase.

## Project Structure

```
cornerstone/
  backend/    Flask API
  frontend/   Next.js app
```

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- A [Supabase](https://supabase.com) project

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
# Edit .env and fill in your Supabase credentials

# Run the dev server
flask run --port=5001
```

The API will be available at http://localhost:5001.
Health check: GET http://localhost:5001/api/health

---

## Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local and fill in your Supabase credentials

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

### frontend/.env.local

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
