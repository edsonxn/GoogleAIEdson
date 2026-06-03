"""Download images using DuckDuckGo search (ddgs).
Usage: echo JSON | python image_search.py
Input JSON via stdin: {"query": "...", "max_num": 5, "output_dir": "..."}
"""
import sys
import os
import json
import urllib.request

def main():
    data = json.loads(sys.stdin.read())
    query = data['query']
    max_num = int(data['max_num'])
    output_dir = data['output_dir']

    os.makedirs(output_dir, exist_ok=True)

    # Count existing image files before download
    img_exts = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
    before = set(f for f in os.listdir(output_dir) if os.path.splitext(f)[1].lower() in img_exts)

    # Search for images using DuckDuckGo
    from duckduckgo_search import DDGS

    try:
        results = DDGS().images(
            query,
            region="us-en",
            safesearch="on",
            max_results=max_num * 3,  # fetch extra in case some fail to download
        )
    except Exception as e:
        results = []

    # Download images
    safe_term = "".join(c if c.isalnum() or c in ' -_' else '' for c in query).strip()[:30]
    downloaded = 0
    idx = 1

    for item in results:
        if downloaded >= max_num:
            break

        img_url = item.get('image', '')
        if not img_url:
            continue

        # Determine extension from URL
        ext = '.jpg'
        for e in ['.png', '.gif', '.webp', '.jpeg', '.bmp']:
            if e in img_url.lower():
                ext = e
                break

        filename = f"{safe_term}_{idx}{ext}"
        filepath = os.path.join(output_dir, filename)

        # Skip if exists
        while os.path.exists(filepath):
            idx += 1
            filename = f"{safe_term}_{idx}{ext}"
            filepath = os.path.join(output_dir, filename)

        try:
            req = urllib.request.Request(img_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                img_data = resp.read()
                # Verify it's actually image data (at least 1KB)
                if len(img_data) > 1024:
                    with open(filepath, 'wb') as f:
                        f.write(img_data)
                    downloaded += 1
                    idx += 1
        except Exception:
            continue

    # Report downloaded files
    after = set(f for f in os.listdir(output_dir) if os.path.splitext(f)[1].lower() in img_exts)
    new_files = sorted(after - before)

    print(json.dumps({"downloaded": len(new_files), "files": new_files}))

if __name__ == '__main__':
    main()
