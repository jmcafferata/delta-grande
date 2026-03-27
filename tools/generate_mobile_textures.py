import os
import subprocess
import glob

ASSETS_DIR = r"C:\Users\jmcaf\Desktop\PERRO EN LA LUNA\DELTA GRANDE\delta-grande\game-assets"

def get_texture_files():
    patterns = [os.path.join(ASSETS_DIR, "**", "recorrido*.jpg"), os.path.join(ASSETS_DIR, "**", "recorrido*.png"), os.path.join(ASSETS_DIR, "**", "recorrido*.jpeg")]
    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern, recursive=True))
    return [f for f in files if "_mobile" not in f]

def process_file(filepath):
    print(f"\n[+] Procesando textura: {os.path.basename(filepath)}")
    ext = os.path.splitext(filepath)[1].lower()
    folder = os.path.dirname(filepath)
    name = os.path.splitext(os.path.basename(filepath))[0]
    out_filepath = os.path.join(folder, f"{name}_mobile{ext}")
    
    if os.path.exists(out_filepath):
        print(f" -> Ya existe, omitiendo.")
        return

    # Escalar textura a max 2048px de ancho usando FFmpeg, q:v 5 para buena calidad JPG
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", filepath, "-vf", "scale=2048:-1", "-q:v", "5", out_filepath]
    
    try:
        subprocess.run(cmd, check=True)
        print(f" -> Exito: {os.path.basename(out_filepath)}")
    except subprocess.CalledProcessError as e:
        print(f" -> Error con ffmpeg.")

if __name__ == "__main__":
    files = get_texture_files()
    if not files:
        print("No se encontraron texturas u ocurrio un error buscando la ruta.")
    else:
        print(f"Encontradas {len(files)} texturas para optimizar.")
        for f in files:
           process_file(f)