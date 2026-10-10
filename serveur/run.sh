#!/bin/zsh
# Conforme : lance l'outil d'audit d'accessibilité sur http://127.0.0.1:8791
cd "$(dirname "$0")" || exit 1
echo "Conforme : outil d'audit RGAA"
echo "Démarrage sur http://127.0.0.1:8791 ..."
python3 app.py
