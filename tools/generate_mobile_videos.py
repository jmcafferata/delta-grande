import os
import subprocess
import glob

ASSETS_DIR = r"C:\Users\jmcaf\Desktop\PERRO EN LA LUNA\DELTA GRANDE\delta-grande\game-assets"

def get_video_files():
    patterns = [os.path.join(ASSETS_DIR, "**", "*.webm"), os.path.join(ASSETS_DIR, "**", "*.mov")]
    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern, recursive=True))
    return [f for f in files if "_mobile" not in f]

def process_file(filepath):
    print(f"\n[+] Procesando: {os.path.basename(filepath)}")
    ext = os.path.splitext(filepath)[1].lower()
    folder = os.path.dirname(filepath)
    name = os.path.splitext(os.path.basename(filepath))[0]
    out_filepath = os.path.join(folder, f"{name}_mobile{ext}")
    
    if os.path.exists(out_filepath):
        print(f" -> Ya existe, omitiendo.")
        return

    # Escalar a altura 720p 
    if ext == ".webm":
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", filepath, "-vf", "scale=-1:720", "-c:v", "libvpx-vp9", "-b:v", "800k", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p", out_filepath]
    elif ext == ".mov":
        # Ajustamos comando de HEVC con alpha segun Safari
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", filepath, "-vf", "scale=-1:720", "-c:v", "hevc", "-vtag", "hvc1", "-q:v", "30", out_filepath]
    
    try:
        subprocess.run(cmd, check=True)
        print(f" -> Exito: {os.path.basename(out_filepath)}")
    except subprocess.CalledProcessError as e:
        print(f" -> Error con ffmpeg.")

if __name__ == "__main__":
    files = get_video_files()
    if not files:
        print("No se encontraron videos u ocurrio un error buscando la ruta.")
    else:
        print(f"Encontrados {len(files)} videos para optimizar.")
        for f in files:
           process_file(f)
