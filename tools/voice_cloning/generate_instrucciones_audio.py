import requests
import os
import re

API_KEY = "sk_7834d336bc2a10a25affcfd480dd6fe8822f6fbe1bbb05ee"
VOICE_ID = "BZHHZOKlfxntjXgDad77"

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "assets", "audio", "instrucciones")

TEXTS = [
    ("tu_rol", "Tu rol"),
    ("sos_aprendiz", "Sos aprendiz de guardaparques."),
    ("tu_mision", "Tu misión es explorar un ecosistema del Delta del Paraná y descubrir su biodiversidad."),
    ("tu_herramienta", "Tu herramienta principal: la curiosidad y la capacidad de observación."),
    ("agudiza_sentidos", "Agudizá los sentidos, la naturaleza se muestra a quien sabe observar."),
    ("usa_silencio", "Usá tu silencio: la naturaleza habla bajito.")
]

# Number mapping for specific numbers found in texts (reused for consistency)
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
    # Replace abbreviations
    text = text.replace(" kg", " kilos")
    text = text.replace(" cm", " centímetros")
    text = text.replace(" g.", " gramos.") # End of sentence
    text = text.replace(" g ", " gramos ") # Middle of sentence
    text = text.replace("spp.", "especies")
    
    # Replace numbers
    sorted_nums = sorted(NUMBERS.keys(), key=len, reverse=True)
    
    for num in sorted_nums:
        pattern = r'\b' + num + r'\b'
        text = re.sub(pattern, NUMBERS[num], text)
        
    return text

def generate_audio(text, output_path):
    # Ensure directory exists
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
    print("\n--- Generating Instrucciones Audio ---")
    for filename_base, text in TEXTS:
        normalized_text = normalize_text(text)
        output_path = os.path.join(OUTPUT_DIR, f"{filename_base}.mp3")
        generate_audio(normalized_text, output_path)

if __name__ == "__main__":
    main()
