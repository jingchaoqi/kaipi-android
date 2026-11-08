package dev.kaipi.android;

import android.content.Context;
import android.os.Build;
import android.system.Os;
import android.system.ErrnoException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import java.util.function.IntConsumer;

/** Installs the immutable APK payload; user configuration and workspaces stay outside it. */
final class RuntimeFiles {
    static synchronized File prepare(Context context, IntConsumer progress) throws IOException {
        File home = new File(context.getFilesDir(), "home");
        if (!new File(home, "tmp").isDirectory() && !new File(home, "tmp").mkdirs())
            throw new IOException("Cannot prepare home");
        File payload = new File(context.getFilesDir(), "runtime");
        String identity;
        try (InputStream in = context.getAssets().open("runtime-id")) {
            identity = new String(readAll(in), StandardCharsets.UTF_8);
        }
        File marker = new File(payload, ".installed");
        if (!marker.isFile() || !new String(java.nio.file.Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8).equals(identity)) {
            File staging = new File(context.getFilesDir(), "runtime-staging");
            remove(staging);
            extract(context, staging, progress);
            java.nio.file.Files.write(new File(staging, ".installed").toPath(), identity.getBytes(StandardCharsets.UTF_8));
            File previous = new File(context.getFilesDir(), "runtime-previous");
            remove(previous);
            if (payload.exists() && !payload.renameTo(previous)) throw new IOException("Cannot stage runtime update");
            if (!staging.renameTo(payload)) {
                if (previous.exists() && !previous.renameTo(payload)) throw new IOException("Cannot restore runtime");
                throw new IOException("Cannot install runtime");
            }
            Thread cleanup = new Thread(() -> { try { remove(previous); } catch (IOException ignored) { } }, "kaipi-runtime-cleanup");
            cleanup.setDaemon(true); cleanup.start();
        }
        File bin = new File(home, "bin");
        if (!bin.isDirectory() && !bin.mkdirs()) throw new IOException("Cannot prepare commands");
        for (String[] tool : new String[][]{{"python", "libkaipi_python.so"}, {"python3", "libkaipi_python.so"}, {"git", "libkaipi_git.so"}}) {
            File link = new File(bin, tool[0]);
            File target = new File(context.getApplicationInfo().nativeLibraryDir, tool[1]);
            if (!target.isFile()) throw new IOException("Missing " + tool[0]);
            try {
                java.nio.file.Files.deleteIfExists(link.toPath());
                Os.symlink(target.getAbsolutePath(), link.getAbsolutePath());
            } catch (ErrnoException error) { throw new IOException("Cannot prepare " + tool[0], error); }
        }
        return payload;
    }
    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384]; int count;
        while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        return out.toByteArray();
    }
    private static void extract(Context context, File staging, IntConsumer progress) throws IOException {
        String shared = "assets/runtime/", abi = "assets/runtime-abi/" + Build.SUPPORTED_ABIS[0] + "/";
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("Cannot prepare runtime");
        // Read the APK directory once instead of calling AssetManager.list for every file.
        // This also works for compressed assets and avoids a second bundled archive.
        try (ZipFile archive = new ZipFile(context.getApplicationInfo().sourceDir)) {
            java.util.List<ZipEntry> entries = new java.util.ArrayList<>();
            java.util.Enumeration<? extends ZipEntry> iterator = archive.entries();
            while (iterator.hasMoreElements()) {
                ZipEntry entry = iterator.nextElement();
                if (!entry.isDirectory() && (entry.getName().startsWith(shared) || entry.getName().startsWith(abi))) entries.add(entry);
            }
            int done = 0;
            byte[] buffer = new byte[32768];
            String base = staging.getCanonicalPath() + File.separator;
            for (ZipEntry entry : entries) {
                String name = entry.getName();
                File target = new File(staging, name.substring(name.startsWith(shared) ? shared.length() : abi.length()));
                if (!target.getCanonicalPath().startsWith(base)) throw new IOException("Invalid runtime path");
                File parent = target.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create runtime directory");
                try (InputStream in = archive.getInputStream(entry); OutputStream out = new FileOutputStream(target)) {
                    int count; while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                }
                if (++done % 128 == 0) progress.accept(done * 100 / entries.size());
            }
            if (entries.isEmpty()) throw new IOException("Missing packaged runtime");
            progress.accept(100);
        }
    }
    private static void remove(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove runtime file");
    }
}
