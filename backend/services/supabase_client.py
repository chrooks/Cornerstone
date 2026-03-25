"""
Supabase client singleton for the Flask backend.
Uses the service role key, which bypasses Row Level Security —
only use this on the server, never expose it to the frontend.
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env so this module works when run directly for verification
load_dotenv()

_client: Client | None = None


def get_supabase() -> Client:
    """Return the shared Supabase client, creating it on first call."""
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")

        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
            )

        _client = create_client(url, key)

    return _client


def verify_connection() -> None:
    """
    Smoke-test the Supabase connection by querying the legends table.
    Prints the first few legend names to confirm data is reachable.
    """
    client = get_supabase()
    response = client.table("legends").select("name, peak_era").limit(5).execute()

    print("Supabase connection OK. Sample legends:")
    for legend in response.data:
        print(f"  - {legend['name']} ({legend['peak_era']})")


if __name__ == "__main__":
    verify_connection()
