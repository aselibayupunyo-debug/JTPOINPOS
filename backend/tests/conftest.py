import os

# Fallback to EXPO_PUBLIC_BACKEND_URL if EXPO_BACKEND_URL isn't exported.
os.environ.setdefault(
    "EXPO_BACKEND_URL",
    os.environ.get("EXPO_PUBLIC_BACKEND_URL", ""),
)
