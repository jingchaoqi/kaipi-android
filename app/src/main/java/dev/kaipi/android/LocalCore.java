package dev.kaipi.android;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.*;

/** One isolated core process per workspace. Pipes are private and carry UTF-8 JSON lines. */
final class LocalCore implements AutoCloseable {
    interface Listener { void message(String json); void failed(String message); }
    private final Listener listener;
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private volatile Process process;
    private volatile boolean closed;
    private final CountDownLatch exited = new CountDownLatch(1);
    LocalCore(Listener listener) { this.listener = listener; }
    void start(Context context, File workspace) {
        writer.execute(() -> {
            try {
                File runtime = RuntimeFiles.prepare(context, percent -> {
                    if (!closed) listener.message("{\"event\":\"initializing\",\"data\":" + percent + "}");
                });
                if (!workspace.isDirectory() && !workspace.mkdirs()) throw new IOException("Cannot create workspace");
                File home = new File(context.getFilesDir(), "home");
                String libraries = context.getApplicationInfo().nativeLibraryDir;
                ProcessBuilder builder = new ProcessBuilder(libraries + "/libkaipi_python.so", "-u", new File(runtime, "main.py").getAbsolutePath());
                builder.directory(workspace);
                Map<String, String> env = builder.environment();
                env.clear();
                env.put("HOME", home.getAbsolutePath());
                env.put("TMPDIR", new File(home, "tmp").getAbsolutePath());
                env.put("PYTHONHOME", new File(runtime, "python").getAbsolutePath());
                env.put("LD_LIBRARY_PATH", libraries);
                env.put("PATH", new File(home, "bin").getAbsolutePath() + ":/system/bin");
                env.put("LANG", "C.UTF-8");
                synchronized (this) {
                    if (closed) return;
                    process = builder.start();
                }
                // Never forward stderr: dependency diagnostics can include private request data.
                Thread diagnostics = new Thread(() -> {
                    try (InputStream in = process.getErrorStream()) {
                        byte[] buffer = new byte[4096]; while (in.read(buffer) != -1) { /* drain */ }
                    } catch (IOException ignored) { }
                }, "kaipi-diagnostics");
                diagnostics.setDaemon(true); diagnostics.start();
                Thread reader = new Thread(() -> read(process), "kaipi-core-events");
                reader.setDaemon(true); reader.start();
            } catch (Exception error) {
                if (!closed) listener.failed("本地引擎启动失败，请重试。" + error.getClass().getSimpleName());
            }
        });
    }
    private void read(Process child) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null && !closed) {
                new JSONObject(line); // stdout must remain a data protocol, never terminal output.
                listener.message(line);
            }
            int exit = child.waitFor();
            if (!closed) listener.failed("本地引擎已结束（" + exit + "），请重新连接。");
        } catch (Exception error) {
            if (!closed) listener.failed("与本地引擎的连接已断开，请重新连接。");
        }
    }
    void send(String json) {
        if (closed) return;
        try { writer.execute(() -> {
            Process child = process;
            if (child == null || closed) return;
            try {
                OutputStream out = child.getOutputStream();
                out.write((json + "\n").getBytes(StandardCharsets.UTF_8)); out.flush();
            } catch (IOException error) { if (!closed) listener.failed("消息未能送达，请重新连接。"); }
        }); } catch (RejectedExecutionException ignored) { }
    }
    void awaitClosed() {
        try { exited.await(12, TimeUnit.SECONDS); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
    }
    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        Process child = process;
        writer.shutdownNow();
        if (child == null) { exited.countDown(); return; }
        Thread cleanup = new Thread(() -> {
            try {
                child.getOutputStream().write("{\"op\":\"shutdown\"}\n".getBytes(StandardCharsets.UTF_8));
                child.getOutputStream().flush();
                if (!child.waitFor(7, TimeUnit.SECONDS)) {
                    child.destroy();
                    if (!child.waitFor(2, TimeUnit.SECONDS)) child.destroyForcibly();
                }
            } catch (Exception error) { child.destroyForcibly(); }
            finally { exited.countDown(); }
        }, "kaipi-core-close");
        cleanup.setDaemon(true); cleanup.start();
    }
}
