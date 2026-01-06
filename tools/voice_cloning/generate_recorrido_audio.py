import json
import os
import re
import requests

API_KEY = "sk_7834d336bc2a10a25affcfd480dd6fe8822f6fbe1bbb05ee"
VOICE_ID = "BZHHZOKlfxntjXgDad77"

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_FILE = os.path.join(BASE_DIR, "game", "data", "especies.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "assets", "audio", "recorrido")

# Number mapping
NUMBERS = {
    "1": "un",
    "2": "dos",
    "4": "cuatro",
    "9": "nueve",
    "10": "diez",
    "20": "veinte",
    "26": "veintiséis",
    "30": "treinta",
    "40": "cuarenta",
    "50": "cincuenta",
    "53": "cincuenta y tres",
    "60": "sesenta",
    "70": "setenta",
    "120": "ciento veinte",
    "420": "cuatrocientos veinte"
}

def normalize_text(text):
    # Strip HTML
    text = re.sub('<[^<]+?>', '', text)
    
    # Replace abbreviations
    text = text.replace(" kg", " kilos")
    text = text.replace(" cm", " centímetros")
    text = text.replace(" m ", " metros ")
    text = text.replace(" m.", " metros.")
    text = text.replace(" g.", " gramos.")
    text = text.replace(" g ", " gramos ")
    text = text.replace("spp.", "especies")
    
    # Replace numbers
    sorted_nums = sorted(NUMBERS.keys(), key=len, reverse=True)
    for num in sorted_nums:
        pattern = r'\b' + num + r'\b'
        text = re.sub(pattern, NUMBERS[num], text)
        
    return text

def generate_audio(text, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    if os.path.exists(output_path):
        print(f"Skipping {output_path} (already exists)")
        return

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": API_KEY
    }
    
    data = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }

    print(f"Generating audio for: '{text[:30]}...' -> {os.path.basename(output_path)}")
    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code == 200:
            with open(output_path, 'wb') as f:
                f.write(response.content)
            print(f"Saved to {output_path}")
        else:
            print(f"Error generating audio: {response.status_code}")
            print(response.text)
    except Exception as e:
        print(f"Exception: {e}")

def main():
    print("\n--- Generating Recorrido Audio ---")
    
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for species in data.get('species', []):
        species_id = species.get('id')
        text = species.get('text')
        
        if species_id and text:
            normalized_text = normalize_text(text)
            output_path = os.path.join(OUTPUT_DIR, f"{species_id}.mp3")
            generate_audio(normalized_text, output_path)

if __name__ == "__main__":
    main()
