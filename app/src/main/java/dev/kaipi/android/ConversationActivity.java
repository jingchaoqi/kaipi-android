package dev.kaipi.android;

import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;

/** Main-thread process state for foreground app windows; core still owns turn outcomes. */
final class ConversationActivity {
    private static boolean running;
    private static final Set<Consumer<Boolean>> listeners = new HashSet<>();
    static void update(boolean value) {
        if (running == value) return;
        running = value;
        for (Consumer<Boolean> listener : new HashSet<>(listeners)) listener.accept(value);
    }
    static void observe(Consumer<Boolean> listener) { listeners.add(listener); listener.accept(running); }
    static void remove(Consumer<Boolean> listener) { listeners.remove(listener); }
}
