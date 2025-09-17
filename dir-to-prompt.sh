#!/usr/bin/env bash
# inventario_dir.sh
# Uso:
#   ./inventario_dir.sh [DIRECTORIO_BASE] [SALIDA_TXT]
# Ejemplo:
#   ./inventario_dir.sh . inventario.txt
#
# Requiere: bash, find, awk, sed
# Opcional: tree, file, iconv, realpath

set -u

BASE_DIR="${1:-.}"
OUT_FILE="${2:-inventario.txt}"

# Normaliza BASE_DIR a ruta absoluta sin trailing slash
if ! BASE_DIR="$(cd "$BASE_DIR" 2>/dev/null && pwd)"; then
  echo "Error: no puedo acceder a '$BASE_DIR'." >&2
  exit 1
fi

# Utilidades disponibles
have() { command -v "$1" >/dev/null 2>&1; }

# Dibuja árbol con 'tree' si existe, si no, hace uno simple
print_tree() {
  local dir="$1"
  echo "# ESTRUCTURA DEL DIRECTORIO"
  echo "# Base: $dir"
  echo

  if have tree; then
    # -a incluye ocultos, --noreport quita el resumen, -F marca / en dirs
    (cd "$dir" && tree -a --noreport -F .) || return
  else
    # Respaldo simple: indentación por nivel
    (
      cd "$dir" || exit 1
      # Orden estable
      LC_ALL=C find . -mindepth 1 -print \
        | LC_ALL=C sort \
        | sed 's|^\./||' \
        | awk -F'/' '
          BEGIN { print "." }
          {
            depth = NF - 1
            indent = ""
            for (i=0; i<depth; i++) indent = indent "    "
            print indent $NF
          }'
    ) || return
  fi
}

# Heurística para determinar si es texto/código
is_text_file() {
  local f="$1"
  local mime=""
  if have file; then
    mime="$(file -bi "$f" 2>/dev/null || true)"
    # texto directo
    [[ "$mime" == text/* ]] && return 0
    # algunos tipos "application/*" que son texto
    [[ "$mime" == application/json* ]] && return 0
    [[ "$mime" == application/javascript* ]] && return 0
    [[ "$mime" == application/x-javascript* ]] && return 0
    [[ "$mime" == application/xml* ]] && return 0
    [[ "$mime" == application/x-sh* ]] && return 0
    [[ "$mime" == application/x-yaml* ]] && return 0
    [[ "$mime" == application/x-toml* ]] && return 0
    [[ "$mime" == */svg* ]] && return 0
    # si tiene charset y no es binary, lo tratamos como texto
    if [[ "$mime" == *"charset="* && "$mime" != *"charset=binary"* ]]; then
      return 0
    fi
  fi

  # Fallback por extensión conocida
  local name="${f##*/}"
  shopt -s nocasematch
  if [[ "$name" =~ ^(Dockerfile|Makefile|CMakeLists\.txt|\.env.*)$ ]]; then
    shopt -u nocasematch; return 0
  fi
  local ext="${name##*.}"
  case "$ext" in
    txt|md|markdown|mkd|adoc|rst|log|csv|tsv|ini|conf|cfg|env|properties|gitignore|gitattributes|editorconfig|npmrc)
      shopt -u nocasematch; return 0 ;;
    html|htm|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|json|toml|yaml|yml|xml|svg)
      shopt -u nocasematch; return 0 ;;
    py|ipynb|r|rb|php|pl|pm|ps1|psm1|bat|cmd|sh|bash|zsh|fish)
      shopt -u nocasematch; return 0 ;;
    c|h|cc|hh|cpp|hpp|cxx|hxx|go|rs|java|kt|kts|scala|swift|lua|sql|tex|bib|proto|dart|hs|clj|cljs|edn|elm|erl|ex|exs|vue|svelte|sol|gql|graphql|nim|ml|mli|v|sv|vhd|vhdl)
      shopt -u nocasematch; return 0 ;;
    *)
      shopt -u nocasematch; return 1 ;;
  esac
}

get_mime() {
  local f="$1"
  if have file; then
    file -bi "$f" 2>/dev/null | tr -d '\r'
  else
    echo "desconocido"
  fi
}

get_charset() {
  local f="$1"
  if have file; then
    file -bi "$f" 2>/dev/null | sed -n 's/.*charset=\([^;[:space:]]*\).*/\1/p'
  fi
}

relpath() {
  local target="$1"
  # Usa realpath si existe, si no, quita el prefijo a mano
  if have realpath; then
    realpath --relative-to="$BASE_DIR" "$target" 2>/dev/null && return
  fi
  local abs="$target"
  echo "${abs#$BASE_DIR/}"
}

print_file_header() {
  local f="$1"
  local rel name ext mime kind
  rel="$(relpath "$f")"
  name="${f##*/}"

  # extensión
  if [[ "$name" == "Dockerfile"* ]]; then
    ext="Dockerfile"
  elif [[ "$name" == .* && "$name" != *.* ]]; then
    # dotfile sin punto extra (p.ej. .gitignore lo tratamos como 'gitignore')
    ext="${name#.}"
  elif [[ "$name" == *.* && "$name" != .* ]]; then
    ext="${name##*.}"
  else
    ext="(sin extensión)"
  fi

  mime="$(get_mime "$f")"
  if is_text_file "$f"; then
    kind="texto"
  else
    kind="binario/no-texto"
  fi

  printf '------------------------------------------------------------------\n'
  printf 'Archivo: %s\n' "$rel"
  printf 'Nombre:  %s\n' "$name"
  printf 'Extensión: %s\n' "$ext"
  printf 'MIME:    %s\n' "$mime"
  printf 'Tipo:    %s\n' "$kind"
}

print_file_content() {
  local f="$1"
  local charset=""
  if have file && have iconv; then
    charset="$(get_charset "$f")"
    if [[ -n "$charset" && "$charset" != "binary" && "$charset" != "unknown" && "$charset" != "utf-8" && "$charset" != "utf8" ]]; then
      printf '------8<------ INICIO CONTENIDO (convertido desde %s a UTF-8) ------8<------\n' "$charset"
      if ! iconv -f "$charset" -t "UTF-8" "$f" 2>/dev/null; then
        echo "[Aviso] iconv falló; imprimiendo bytes tal cual:"
        cat "$f"
      fi
      printf '------8<------ FIN CONTENIDO ------8<------\n\n'
      return
    fi
  fi
  printf '------8<------ INICIO CONTENIDO ------8<------\n'
  cat "$f"
  printf '\n------8<------ FIN CONTENIDO ------8<------\n\n'
}

# Comienza a escribir el reporte
{
  print_tree "$BASE_DIR"

  echo
  echo
  echo "# LISTADO DE ARCHIVOS CON METADATOS Y CONTENIDO (SI APLICA)"
  echo "# Base: $BASE_DIR"
  echo

  # Recorre todos los archivos de forma estable y segura
  find "$BASE_DIR" -type f -print0 \
    | LC_ALL=C sort -z \
    | while IFS= read -r -d '' f; do
        print_file_header "$f"
        if is_text_file "$f"; then
          print_file_content "$f"
        else
          echo "(Contenido omitido por ser binario/no-texto)"
          echo
        fi
      done

} > "$OUT_FILE"

echo "Listo: reporte generado en '$OUT_FILE'"
