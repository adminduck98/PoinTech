import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN: str = os.environ["BOT_TOKEN"]
ADMIN_ID: int = int(os.environ["ADMIN_ID"])
SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# Required, with no default on purpose.
#
# This used to fall back to https://kupi.onrender.com — a Render host that no
# longer serves the frontend (Vercel is the single target now). A default here
# is worse than a crash: the bot would start happily and point every "open
# shop" button at a dead domain, which looks like the shop is broken rather
# than like the deployment is misconfigured. Every other value in this file is
# already required the same way.
WEBAPP_URL: str = os.environ["WEBAPP_URL"]

# ─── Public shop identity ───────────────────────────────────────────────────
#
# Optional, and deliberately without invented defaults beyond the shop name
# itself — the same rule src/lib/config.ts follows for CONTACTS. /about used to
# print `one.uz`, `@one_shop` and `info@one.uz`, inherited from an earlier
# brand: three contact routes that lead somewhere else entirely. A missing line
# makes the shop look incomplete; a wrong one sends customers to a stranger.
# Unset values are simply left out of the message.
SHOP_NAME: str = os.getenv("SHOP_NAME", "Point Tech")
SHOP_SITE: str = os.getenv("SHOP_SITE", "")
SHOP_CHANNEL: str = os.getenv("SHOP_CHANNEL", "")
SHOP_EMAIL: str = os.getenv("SHOP_EMAIL", "")
