#!/bin/sh
set -eu
: "${JAVA_HOME:?Set JAVA_HOME to a JDK}"
cd "$(dirname "$0")/.."
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
c++ -std=c++17 -Wall -Wextra -Werror -shared -fPIC \
    -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" \
    app/src/main/cpp/pty.cpp -o "$build_dir/libkaipi_pty.so"
"$JAVA_HOME/bin/javac" -d "$build_dir" tests/native/dev/kaipi/android/LocalTerminal.java
timeout 15 "$JAVA_HOME/bin/java" -Djava.library.path="$build_dir" -cp "$build_dir" dev.kaipi.android.LocalTerminal
