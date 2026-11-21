# Deploying on a Raspberry Pi

Assumptions (as in `deploy/walkhome.service`): code in `/home/pi/workspace/walkhome`,
systemd service `walkhome`, database `data/walkhome.db`. Adjust `PI` and the paths as needed.

## 1. Build the frontend on your computer

`frontend/dist` is not versioned: build it on a faster machine and copy it over
(this avoids installing Node on the Pi).

```bash
cd walkhome
(cd frontend && npm ci && npm run build)          # produces frontend/dist (card images included)
PI=pi@raspberrypi.local
```

## 2. Get the code on the Pi

```bash
ssh $PI
mkdir -p ~/workspace && cd ~/workspace
git clone <REPOSITORY_URL> walkhome
```

## 3. Python (3.9+; 3.11+ recommended)

```bash
cd ~/workspace/walkhome
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/build_content.py   # generate content/camino.json if missing
.venv/bin/python -m pytest tests -q        # optional
```
The interpreter needs `hashlib.scrypt` (any CPython built against OpenSSL, which is the case on Raspberry Pi OS).

## 4. Frontend

```bash
# from your computer
rsync -avz --delete frontend/dist/ $PI:workspace/walkhome/frontend/dist/
```

## 5. systemd service

```bash
sudo cp deploy/walkhome.service /etc/systemd/system/
sudo nano /etc/systemd/system/walkhome.service
#   WALKHOME_VAPID_SUBJECT=mailto:<your email>
#   WALKHOME_DEVICE_ADDRESS=<your treadmill's BLE address> (optional)
#   WALKHOME_REGISTRATION=invite, then set the code with:  sudo systemctl edit walkhome
#        [Service]
#        Environment=WALKHOME_INVITE_CODE=<secret code>
sudo systemctl daemon-reload
sudo systemctl enable --now walkhome
journalctl -u walkhome -f             # check: schema migration, no errors
curl -s localhost:8090/api/health
```

## 6. Upgrading a v1 database

v1 walkers become "claimable" accounts (username = slugified display name, no password).
The sign-in screen does not offer "claim" yet: do it once per person.

```bash
curl -s -X POST localhost:8090/api/auth/claim -H 'Content-Type: application/json' \
     -d '{"username":"<username>","password":"<new password, 8+ chars>"}'
```
(Exact usernames: `sqlite3 data/walkhome.db "select id,username,display_name from users"`.)
On claim, milestones and distance tiers already reached are paid out at once: expect a few dozen packs.
The first account claimed or created becomes admin. **Back up `data/` before upgrading**: the migration is
non-destructive but cannot be reverted.

## 7. Nightly backup + HTTPS (push on iPhone)

```bash
sudo apt install -y sqlite3
crontab -e   # 0 3 * * * /home/pi/workspace/walkhome/deploy/backup.sh
# HTTPS for Web Push / installable PWA (Tailscale):
sudo tailscale up && sudo tailscale cert <machine>.<tailnet>.ts.net
sudo tailscale serve --bg --https=443 http://localhost:8090
```
Then open `https://<machine>.<tailnet>.ts.net` on each phone, "Add to Home Screen",
and enable notifications in Profile → Settings.

## Later updates

```bash
# your computer
(cd frontend && npm run build) && rsync -avz --delete frontend/dist/ $PI:workspace/walkhome/frontend/dist/
# Pi
cd ~/workspace/walkhome && git pull --ff-only && .venv/bin/pip install -r requirements.txt && sudo systemctl restart walkhome
```
