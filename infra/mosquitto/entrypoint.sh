#!/bin/sh
# Create the password file from the environment, then start the broker.
set -e
touch /mosquitto/data/passwd
chmod 0700 /mosquitto/data/passwd
mosquitto_passwd -b /mosquitto/data/passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"
chown mosquitto:mosquitto /mosquitto/data/passwd 2>/dev/null || true
exec mosquitto -c /mosquitto/config/mosquitto.conf
