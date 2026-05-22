#!/bin/bash
set -euo pipefail

APP_DIR="/home/bhawesh/rahul/CRM"
DOMAIN="nhaidevelopment.dic.org.in"
APP_PATH="/CRM"
NODE_PORT=3002
SMTP_PORT=3001

G='\033[0;32m' Y='\033[1;33m' R='\033[0;31m' B='\033[0;34m' NC='\033[0m'
info()    { echo -e "${G}[✓]${NC} $1"; }
warn()    { echo -e "${Y}[!]${NC} $1"; }
error()   { echo -e "${R}[✗]${NC} $1"; exit 1; }
section() { echo -e "\n${B}━━━ $1 ━━━${NC}"; }

[ "$EUID" -ne 0 ] && error "Run as root: sudo bash setup.sh"

if [ "${1:-}" = "--update" ]; then
    cd $APP_DIR && git pull origin main
    npm ci --omit=dev 2>&1 | tail -2
    pm2 reload nhai-crm-api 2>/dev/null || pm2 start ecosystem.config.js --env production
    pm2 save --force
    info "Done → https://$DOMAIN$APP_PATH/"; exit 0
fi

if [ "${1:-}" = "--status" ]; then
    node -v; pm2 -v; nginx -v 2>&1; psql --version
    pm2 list 2>/dev/null || true
    curl -sf http://127.0.0.1:$NODE_PORT/health && echo "API: UP" || echo "API: DOWN"
    exit 0
fi

section "1. Install nginx (skip apt if broken)"
if command -v nginx &>/dev/null; then
    info "Nginx already installed: $(nginx -v 2>&1)"
else
    info "Installing nginx..."
    apt-get install -y --allow-change-held-packages \
        -o APT::Update::Error-Mode=any \
        nginx 2>&1 | tail -3 || \
    apt-get install -y -f nginx 2>&1 | tail -3 || \
    { warn "apt failed — trying dpkg fix"; dpkg --configure -a 2>/dev/null; apt-get install -y nginx; }
    info "Nginx installed"
fi

section "2. Install certbot via snap"
if command -v certbot &>/dev/null; then
    info "Certbot already installed"
else
    snap install --classic certbot 2>/dev/null \
        && ln -sf /snap/bin/certbot /usr/bin/certbot \
        && info "Certbot installed" \
        || warn "Certbot install failed — SSL step will be skipped"
fi

section "3. Node + PM2"
node -v | grep -qE "v(18|20|22)" || error "Node 18+ required"
pm2 -v &>/dev/null || npm install -g pm2 --silent
info "Node $(node -v) | PM2 $(pm2 -v)"

section "4. PostgreSQL"
systemctl enable postgresql --now 2>/dev/null || true
DB_EXISTS=$(sudo -u postgres psql -tAc \
    "SELECT 1 FROM pg_database WHERE datname='nhai_crm'" 2>/dev/null || echo "")

if [ "$DB_EXISTS" = "1" ]; then
    info "Database nhai_crm exists"
    DB_PASS=$(grep "^DATABASE_URL=" $APP_DIR/.env 2>/dev/null \
        | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|' || echo "")
    if [ -z "$DB_PASS" ]; then
        read -sp "  Enter DB password for nhai_crm_user: " DB_PASS; echo
    fi
else
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    sudo -u postgres psql -c \
        "CREATE USER nhai_crm_user WITH PASSWORD '$DB_PASS';" 2>/dev/null \
        || sudo -u postgres psql -c \
        "ALTER USER nhai_crm_user WITH PASSWORD '$DB_PASS';" 2>/dev/null
    sudo -u postgres createdb -O nhai_crm_user nhai_crm 2>/dev/null
    info "Database created"
fi

section "5. npm install"
cd $APP_DIR
npm ci --omit=dev 2>&1 | tail -3
info "Dependencies installed"

section "6. Environment (.env)"
if [ -f "$APP_DIR/.env" ]; then
    info ".env exists — keeping it"
else
    JWT=$(openssl rand -hex 64)
    APASS=$(openssl rand -base64 12 | tr -d '/+=')
    cat > $APP_DIR/.env << EOF
NODE_ENV=production
PORT=$NODE_PORT
SMTP_SERVER_PORT=$SMTP_PORT
DATABASE_URL=postgresql://nhai_crm_user:${DB_PASS}@localhost:5432/nhai_crm
DB_SSL=false
JWT_SECRET=${JWT}
ADMIN_PASSWORD=${APASS}
ALLOWED_ORIGIN=https://${DOMAIN}
EOF
    chmod 600 $APP_DIR/.env
    warn "Admin → admin@crm.local / $APASS  ← SAVE THIS"
fi

section "7. Database migration"
cd $APP_DIR
node -e "
  require('dotenv').config({ path: '$APP_DIR/.env' });
  require('./server/db').init()
    .then(() => { console.log('  DB ready'); process.exit(0); })
    .catch(e => { console.error('  DB error:', e.message); process.exit(1); });
"
info "DB migrated and seeded"

section "8. Nginx config"
grep -q "api_limit" /etc/nginx/nginx.conf 2>/dev/null || \
    sed -i 's|http {|http {\n\tlimit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/m;|' \
    /etc/nginx/nginx.conf 2>/dev/null || true

cat > /etc/nginx/sites-available/nhai-crm << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    access_log /var/log/nginx/nhai-crm-access.log;
    error_log  /var/log/nginx/nhai-crm-error.log warn;

    add_header X-Frame-Options        "SAMEORIGIN"  always;
    add_header X-Content-Type-Options "nosniff"     always;
    add_header X-XSS-Protection       "1; mode=block" always;

    location ${APP_PATH}/ {
        alias ${APP_DIR}/;
        index index.html;
        try_files \$uri \$uri/ ${APP_PATH}/index.html;
        location ~* \.(css|js|svg|ico|png|woff2)\$ {
            alias ${APP_DIR}/;
            expires 30d;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:${NODE_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        limit_req          zone=api_limit burst=20 nodelay;
    }

    location /smtp/ {
        proxy_pass      http://127.0.0.1:${SMTP_PORT}/;
        proxy_set_header Host \$host;
    }

    location = /health { proxy_pass http://127.0.0.1:${NODE_PORT}/health; access_log off; }
    location ~* \.(env|git|sql|bak|log)\$ { return 404; }
    location ~ /\.     { return 404; }
    location = /       { return 301 \$scheme://\$host${APP_PATH}/; }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/nhai-crm /etc/nginx/sites-enabled/nhai-crm
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl enable nginx --now && systemctl reload nginx
info "Nginx configured"

section "9. SSL"
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    info "SSL cert exists"
elif command -v certbot &>/dev/null; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --email "webmaster@nhai.gov.in" --redirect 2>&1 | tail -5 \
        && info "SSL obtained" \
        || warn "SSL failed — run manually: sudo certbot --nginx -d $DOMAIN"
else
    warn "Certbot not found — skipping SSL"
fi

section "10. PM2 start"
cd $APP_DIR
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save --force
PM2_CMD=$(pm2 startup systemd 2>/dev/null | grep "^sudo" | tail -1 || echo "")
[ -n "$PM2_CMD" ] && eval "$PM2_CMD" 2>/dev/null || true

section "11. Firewall"
ufw --force enable 2>/dev/null || true
ufw allow 'Nginx Full' 2>/dev/null || true
ufw allow OpenSSH 2>/dev/null || true
ufw deny $NODE_PORT 2>/dev/null || true
ufw deny $SMTP_PORT 2>/dev/null || true
info "Firewall configured"

( crontab -l 2>/dev/null | grep -v certbot
  echo "0 3 * * * certbot renew -q --post-hook 'nginx -s reload'"
) | crontab - 2>/dev/null || true

sleep 4
API_UP=$(curl -sf http://127.0.0.1:$NODE_PORT/health 2>/dev/null && echo "yes" || echo "no")
APASS=$(grep "^ADMIN_PASSWORD=" $APP_DIR/.env 2>/dev/null | cut -d= -f2 || echo "")

echo ""
echo -e "${G}══════════════════════════════════════════════════${NC}"
echo -e "${G}  DIC-NHAI CRM — Ready!${NC}"
echo -e "${G}══════════════════════════════════════════════════${NC}"
echo "  URL:  https://$DOMAIN$APP_PATH/"
[ "$API_UP" = "yes" ] \
    && echo -e "  API:  ${G}✅ Running${NC}" \
    || echo -e "  API:  ${R}❌ Down — run: pm2 logs nhai-crm-api${NC}"
echo ""
[ -n "$APASS" ] && echo -e "  ${Y}Login: admin@crm.local / $APASS${NC}"
echo ""
echo "  pm2 status                    # process list"
echo "  pm2 logs nhai-crm-api         # live logs"
echo "  sudo bash setup.sh --update   # deploy updates"
echo ""
