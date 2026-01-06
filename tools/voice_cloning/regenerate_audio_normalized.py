import requests
import os
import glob
import shutil
import re

API_KEY = "sk_7834d336bc2a10a25affcfd480dd6fe8822f6fbe1bbb05ee"
VOICE_ID = "BZHHZOKlfxntjXgDad77"

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
COMPLETED_SPECIES_DIR = os.path.join(BASE_DIR, "game-assets", "sub", "completed_fish_data")
COMPLETED_AUDIO_DIR = os.path.join(BASE_DIR, "game-assets", "sub", "voiceovers")
FACTS_AUDIO_DIR = os.path.join(BASE_DIR, "game-assets", "rio", "voiceovers")
BACKUP_DIR = os.path.join(BASE_DIR, "game-assets", "voiceovers_backup")

# Species Facts (copied from RioScene.js)
SPECIES_FACTS = {
  "raya_negra": [
    "Habita fondos arenosos o fangosos de ríos y arroyos.",
    "Tiene cuerpo plano y cola larga con aguijón venenoso.",
    "Se alimenta de crustáceos, moluscos y peces pequeños.",
    "Es ovovivípara (las crías se desarrollan dentro del cuerpo).",
    "Puede medir más de un metro de ancho.",
    "Suele camuflarse en el fondo para cazar.",
    "Su veneno no es mortal, pero causa dolor intenso.",
    "Respira moviendo el agua por aberturas situadas encima del cuerpo.",
    "Es activa principalmente durante la noche.",
    "En Entre Ríos se la encuentra en zonas profundas del Paraná."
  ],
  "surubi_pintado": [
    "Es un gran bagre de piel moteada (Pseudoplatystoma corruscans).",
    "Puede superar los 50 kg de peso.",
    "Predador tope de ambientes fluviales.",
    "Se alimenta de peces más chicos y crustáceos.",
    "Realiza migraciones para reproducirse.",
    "Muy valorado en la pesca deportiva.",
    "También llamado “manguruyú pintado” en algunas regiones.",
    "Su piel carece de escamas.",
    "Requiere aguas limpias y con corriente para reproducirse.",
    "Su carne es firme y de alto valor gastronómico."
  ],
  "vieja_del_agua": [
    "Posee cuerpo cubierto de placas óseas.",
    "Se adhiere a superficies con su boca en forma de ventosa.",
    "Come algas y restos orgánicos.",
    "Cumple un rol ecológico limpiando fondos y rocas.",
    "Prefiere aguas calmas y claras.",
    "Su nombre científico común es Hypostomus spp.",
    "Tolera aguas con bajo nivel de oxígeno.",
    "Tiene hábitos principalmente nocturnos.",
    "Puede fijarse a las piedras incluso con corriente fuerte.",
    "Es muy resistente y común en acuarios de agua dulce."
  ],
  "palometa_brava": [
    "De cuerpo plateado y dientes muy filosos.",
    "Relacionada con las pirañas (Serrasalmus).",
    "Vive en cardúmenes.",
    "Se alimenta de peces, escamas y a veces frutas.",
    "Abunda en verano en aguas cálidas.",
    "Puede causar mordidas dolorosas.",
    "De crecimiento rápido y vida relativamente corta.",
    "Su agresividad aumenta con altas temperaturas.",
    "Cumple un rol ecológico controlando poblaciones de peces.",
    "Es frecuente verla en cardúmenes cerca de la superficie."
  ],
  "armado_chancho": [
    "Bagre grande con placas óseas defensivas.",
    "Su cuerpo es robusto y su boca inferior, adaptada al fondo.",
    "Se alimenta de materia orgánica y pequeños invertebrados.",
    "Habita zonas profundas de ríos y lagunas.",
    "Su carne es muy apreciada.",
    "Puede emitir sonidos con su vejiga natatoria.",
    "También conocido como Pterodoras granulosus.",
    "Su cuerpo está cubierto de espinas protectoras.",
    "Es un nadador lento.",
    "Desempeña un papel importante reciclando materia orgánica."
  ],
  "pacu": [
    "De cuerpo alto y dientes similares a los humanos.",
    "Omnívoro: come frutos, semillas y pequeños animales.",
    "Muy fuerte y buscado en pesca deportiva.",
    "Puede superar los 10 kg.",
    "Vive en aguas cálidas y tranquilas.",
    "Ayuda a dispersar semillas en los ríos.",
    "Pertenece a la familia de las pirañas, pero es pacífico.",
    "Puede adaptarse a estanques y represas.",
    "Se reproduce durante las crecientes del río.",
    "Su consumo es habitual en la gastronomía mesopotámica"
  ],
  "sabalo": [
    "Especie más abundante del Paraná.",
    "Come algas, plancton y materia orgánica.",
    "Base alimentaria de muchos peces carnívoros.",
    "Realiza migraciones largas para desovar.",
    "Tiene gran importancia comercial.",
    "Filtra el alimento con sus branquias.",
    "Su nombre científico es Prochilodus lineatus.",
    "Es esencial para mantener el equilibrio ecológico del río.",
    "Sus migraciones masivas son conocidas como “subida del sábalo”.",
    "Sirve como indicador biológico de la salud del ecosistema."
  ],
  "dorado": [
    "Depredador emblemático del Paraná (Salminus brasiliensis).",
    "De color dorado intenso y gran potencia.",
    "Puede alcanzar más de 20 kg.",
    "Vive en aguas con corriente.",
    "Se alimenta de peces, especialmente sábalos.",
    "Muy valorado en la pesca deportiva y conservación.",
    "Se lo considera el “tigre del río” por su ferocidad.",
    "Necesita aguas oxigenadas y correntosas.",
    "Su reproducción depende de los pulsos de inundación.",
    "Es una especie protegida: en muchos lugares se promueve su devolución al río."
  ]
}

# Number mapping for specific numbers found in texts
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
    # Sort keys by length descending to avoid replacing "120" with "un20"
    sorted_nums = sorted(NUMBERS.keys(), key=len, reverse=True)
    
    for num in sorted_nums:
        # Use regex to match whole words only to avoid partial replacements
        # e.g. don't replace "1" in "10"
        pattern = r'\b' + num + r'\b'
        text = re.sub(pattern, NUMBERS[num], text)
        
    return text

def backup_files():
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
        
    # Backup facts audio
    if os.path.exists(FACTS_AUDIO_DIR):
        dest = os.path.join(BACKUP_DIR, "rio")
        if not os.path.exists(dest):
            os.makedirs(dest)
        for f in glob.glob(os.path.join(FACTS_AUDIO_DIR, "*.mp3")):
            shutil.move(f, os.path.join(dest, os.path.basename(f)))
            
    # Backup completed species audio
    if os.path.exists(COMPLETED_AUDIO_DIR):
        dest = os.path.join(BACKUP_DIR, "sub")
        if not os.path.exists(dest):
            os.makedirs(dest)
        for f in glob.glob(os.path.join(COMPLETED_AUDIO_DIR, "*.mp3")):
            shutil.move(f, os.path.join(dest, os.path.basename(f)))
            
    print(f"Backed up existing audio files to {BACKUP_DIR}")

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
    backup_files()
    
    # 1. Generate Species Facts
    print("\n--- Generating Species Facts ---")
    for species, facts in SPECIES_FACTS.items():
        for i, fact in enumerate(facts):
            normalized_fact = normalize_text(fact)
            filename = f"{species}_{i}.mp3"
            output_path = os.path.join(FACTS_AUDIO_DIR, filename)
            generate_audio(normalized_fact, output_path)

    # 2. Generate Completed Species Info
    print("\n--- Generating Completed Species Info ---")
    txt_files = glob.glob(os.path.join(COMPLETED_SPECIES_DIR, "*.txt"))
    for txt_file in txt_files:
        species_name = os.path.splitext(os.path.basename(txt_file))[0]
        output_path = os.path.join(COMPLETED_AUDIO_DIR, f"{species_name}.mp3")
        
        try:
            with open(txt_file, 'r', encoding='utf-8') as f:
                text = f.read().strip()
                
            if text:
                normalized_text = normalize_text(text)
                generate_audio(normalized_text, output_path)
            else:
                print(f"Skipping {species_name} (empty file)")
                
        except Exception as e:
            print(f"Error reading {txt_file}: {e}")

if __name__ == "__main__":
    main()
