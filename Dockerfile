# Usamos Nginx liviano para servir archivos estáticos
FROM nginx:1.27-alpine

# Copiamos todo el sitio dentro de la carpeta pública de Nginx
COPY . /usr/share/nginx/html

# Exponemos el puerto 80 dentro del contenedor
EXPOSE 80
