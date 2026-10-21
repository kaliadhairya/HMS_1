#!/usr/bin/env bash
# Builds the FHIR validator the FHIR suites use (completion A1): the official HL7 validation
# engine 6.10.4 from Maven Central and the HmsValidate runner. Needs Java 17+ and Maven.
# Usage: tools/fhir-validator/build.sh [target-dir]   (default: ~/hms-tools/fhir/validator-6.10.4)
# Then run the suites with HMS_FHIR_VALIDATOR_DIR=<target-dir>.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/hms-tools/fhir/validator-6.10.4}"
mkdir -p "$DEST/src" "$DEST/classes"
cp "$SRC/pom.xml" "$DEST/"; cp "$SRC/src/HmsValidate.java" "$DEST/src/"
(cd "$DEST" && mvn -q dependency:copy-dependencies -DoutputDirectory=lib)
javac -cp "$DEST/lib/*" -d "$DEST/classes" "$DEST/src/HmsValidate.java"
echo "FHIR validator ready in $DEST"
