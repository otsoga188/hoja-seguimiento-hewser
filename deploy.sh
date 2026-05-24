#!/bin/bash
# ============================================================
#  deploy.sh — Hoja de Seguimiento Hewser
#  Crea repo en GitHub, sube los archivos, activa Pages.
# ============================================================
#
#  REQUISITOS
#  ──────────
#  • macOS (probado en zsh, también funciona en bash)
#  • git instalado
#  • gh (GitHub CLI) instalado y autenticado:
#      brew install gh
#      gh auth login
#
#  USO
#  ───
#  Copia este archivo + index.html + apps-script.gs + README.md
#  a una carpeta vacía, y ejecuta:
#
#      chmod +x deploy.sh
#      ./deploy.sh
#
#  El script te preguntará si el repo debe ser público o privado.
# ============================================================

set -e  # detener si cualquier comando falla

# ─── CONFIGURACIÓN ─────────────────────────────────────────
REPO_NAME="hoja-seguimiento-hewser"
REPO_DESC="Hoja de Seguimiento Semanal para coaching empresarial — Hewser Marketing"
DEFAULT_BRANCH="main"
COMMIT_MSG="Initial: hoja de seguimiento v2 (Sheets + Apps Script backend)"

# ─── COLORES ────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║   Hoja de Seguimiento — Deploy a GitHub Pages  ║${NC}"
echo -e "${BOLD}${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# ─── VERIFICAR REQUISITOS ──────────────────────────────────
echo -e "${DIM}Verificando requisitos…${NC}"

if ! command -v git &> /dev/null; then
  echo -e "${RED}✗ git no está instalado.${NC}"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo -e "${RED}✗ GitHub CLI (gh) no está instalado.${NC}"
  echo -e "   Instálalo con: ${BOLD}brew install gh${NC}"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo -e "${RED}✗ No estás autenticado en GitHub CLI.${NC}"
  echo -e "   Ejecuta: ${BOLD}gh auth login${NC}"
  exit 1
fi

# Verificar archivos requeridos
for f in index.html apps-script.gs README.md; do
  if [ ! -f "$f" ]; then
    echo -e "${RED}✗ Falta el archivo: $f${NC}"
    echo -e "   Asegúrate de tener los 3 archivos en esta carpeta antes de correr el script."
    exit 1
  fi
done

echo -e "${GREEN}✓ Requisitos OK${NC}"
echo ""

# ─── PREGUNTAR VISIBILIDAD ─────────────────────────────────
echo -e "${BOLD}¿El repo debe ser público o privado?${NC}"
echo -e "  ${DIM}(GitHub Pages funciona en ambos; si quieres URL pública sin login del coach, elige público)${NC}"
echo -e "  ${BOLD}1)${NC} Público  ${DIM}← recomendado${NC}"
echo -e "  ${BOLD}2)${NC} Privado"
read -p "  Opción [1]: " visibility_choice
visibility_choice=${visibility_choice:-1}

if [ "$visibility_choice" = "2" ]; then
  VISIBILITY="--private"
  echo -e "${YELLOW}  → Repo privado${NC}"
else
  VISIBILITY="--public"
  echo -e "${GREEN}  → Repo público${NC}"
fi
echo ""

# ─── NOMBRE DEL REPO ──────────────────────────────────────
echo -e "${BOLD}Nombre del repo en GitHub${NC} ${DIM}[default: $REPO_NAME]${NC}"
read -p "  > " custom_name
if [ -n "$custom_name" ]; then
  REPO_NAME="$custom_name"
fi
echo ""

# ─── INICIALIZAR GIT ──────────────────────────────────────
echo -e "${DIM}Inicializando repositorio local…${NC}"

if [ -d ".git" ]; then
  echo -e "${YELLOW}  ⚠ Ya existe un .git en esta carpeta.${NC}"
  read -p "  ¿Borrarlo y empezar limpio? [y/N]: " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    rm -rf .git
    echo -e "${DIM}  .git eliminado${NC}"
  else
    echo -e "${RED}  Aborta. Mueve la carpeta a una limpia y vuelve a correr.${NC}"
    exit 1
  fi
fi

git init -b "$DEFAULT_BRANCH" -q
echo -e "${GREEN}✓ Git inicializado${NC}"

# ─── .gitignore mínimo ───────────────────────────────────
cat > .gitignore <<'EOF'
.DS_Store
.env
.env.local
node_modules/
*.log
.vscode/
.idea/
EOF
echo -e "${GREEN}✓ .gitignore creado${NC}"

# ─── COMMIT ───────────────────────────────────────────────
git add -A
git commit -q -m "$COMMIT_MSG"
echo -e "${GREEN}✓ Commit inicial creado${NC}"
echo ""

# ─── CREAR REPO EN GITHUB ────────────────────────────────
echo -e "${DIM}Creando repo en GitHub y subiendo…${NC}"

if gh repo view "$REPO_NAME" &> /dev/null; then
  echo -e "${YELLOW}  ⚠ Ya existe un repo con ese nombre en tu cuenta.${NC}"
  read -p "  ¿Sobreescribir? Borrará el repo existente. [y/N]: " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    gh repo delete "$REPO_NAME" --yes
    echo -e "${DIM}  Repo anterior borrado${NC}"
  else
    echo -e "${RED}  Aborta. Cambia el nombre y vuelve a correr.${NC}"
    exit 1
  fi
fi

gh repo create "$REPO_NAME" \
  $VISIBILITY \
  --description "$REPO_DESC" \
  --source=. \
  --remote=origin \
  --push \
  -q

echo -e "${GREEN}✓ Repo creado y código subido${NC}"
echo ""

# ─── ACTIVAR GITHUB PAGES ─────────────────────────────────
echo -e "${DIM}Activando GitHub Pages…${NC}"

# Obtener el username
USERNAME=$(gh api user --jq .login)

# Activar Pages vía API
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "/repos/$USERNAME/$REPO_NAME/pages" \
  -f "source[branch]=$DEFAULT_BRANCH" \
  -f "source[path]=/" \
  &> /dev/null || echo -e "${YELLOW}  ⚠ Pages podría ya estar activado o tardar unos segundos${NC}"

PAGES_URL="https://${USERNAME}.github.io/${REPO_NAME}/"
echo -e "${GREEN}✓ GitHub Pages activado${NC}"
echo ""

# ─── RESUMEN FINAL ───────────────────────────────────────
echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║              DEPLOY COMPLETO ✨                ║${NC}"
echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Tu app:${NC}"
echo -e "  🌐  ${BLUE}${PAGES_URL}${NC}"
echo -e "      ${DIM}(puede tardar 1-2 minutos en estar disponible la primera vez)${NC}"
echo ""
echo -e "${BOLD}Tu repo:${NC}"
echo -e "  📦  ${BLUE}https://github.com/${USERNAME}/${REPO_NAME}${NC}"
echo ""
echo -e "${BOLD}Siguientes pasos:${NC}"
echo -e "  ${YELLOW}1.${NC} Abre ${BLUE}script.google.com${NC} y crea un proyecto nuevo."
echo -e "  ${YELLOW}2.${NC} Pega el contenido de ${BOLD}apps-script.gs${NC}."
echo -e "  ${YELLOW}3.${NC} Edita ${BOLD}SHEET_ID${NC} y ${BOLD}DEFAULT_COACH_EMAIL${NC} en el script."
echo -e "  ${YELLOW}4.${NC} Ejecuta ${BOLD}setup()${NC} una vez y publica como Web App."
echo -e "  ${YELLOW}5.${NC} Abre tu app en ${BLUE}${PAGES_URL}${NC} y pega la URL del backend."
echo ""
echo -e "${DIM}Consulta README.md para el detalle de cada paso.${NC}"
echo ""

# ─── COMANDOS ÚTILES PARA FUTURO ─────────────────────────
cat > deploy-update.sh <<EOF
#!/bin/bash
# Actualizar la app después de cambios
# Uso: ./deploy-update.sh "mensaje del commit"

set -e
MSG="\${1:-Update}"
git add -A
git commit -m "\$MSG"
git push
echo "✓ Cambios subidos. GitHub Pages se actualiza en ~1 minuto."
echo "  URL: ${PAGES_URL}"
EOF
chmod +x deploy-update.sh

echo -e "${DIM}También se creó ${BOLD}deploy-update.sh${NC}${DIM} para futuras actualizaciones:${NC}"
echo -e "${DIM}    ./deploy-update.sh \"Fix algún bug\"${NC}"
echo ""
