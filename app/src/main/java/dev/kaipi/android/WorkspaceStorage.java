package dev.kaipi.android;

import android.content.Context;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;

/** Access to user files only; app HOME and core's internal directories are never published. */
final class WorkspaceStorage {
    static File root(Context context, String workspace) throws IOException {
        try { UUID.fromString(workspace); } catch (RuntimeException error) { throw new IOException("invalid_workspace"); }
        return new File(context.getFilesDir(), "workspaces/" + workspace).getCanonicalFile();
    }
    static File resolve(File root, String path) throws IOException {
        if (path == null || path.indexOf('\0') >= 0) throw new IOException("invalid_path");
        if (path.startsWith("file:")) {
            Uri uri = Uri.parse(path);
            if (uri.getAuthority() != null && !uri.getAuthority().isEmpty()) throw new IOException("invalid_path");
            path = uri.getPath();
        }
        File file = new File(path);
        if (!file.isAbsolute()) file = new File(root, path);
        // Check both the lexical path and the target: links cannot expose other private data.
        check(root, file.toPath().normalize().toFile());
        file = file.getCanonicalFile();
        check(root, file);
        if (!file.exists() || !file.canRead()) throw new FileNotFoundException("missing_file");
        return file;
    }
    private static void check(File root, File file) throws IOException {
        if (!file.toPath().startsWith(root.toPath())) throw new IOException("outside_workspace");
        for (java.nio.file.Path part : root.toPath().relativize(file.toPath()))
            if (part.toString().equals(".git") || part.toString().equals(".kaipi")) throw new IOException("internal_file");
    }
    static String relative(File root, File file) { return root.toPath().relativize(file.toPath()).toString(); }
    static String mime(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        String extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : "";
        switch (extension) {
            case "html": case "htm": return "text/html";
            case "css": return "text/css";
            case "js": case "mjs": case "cjs": return "application/javascript";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "pdf": return "application/pdf";
            case "zip": return "application/zip";
        }
        if (Arrays.asList("txt","md","markdown","py","sh","bash","csv","tsv","log","ts","tsx","jsx","xml","yaml","yml","toml","ini","conf","cfg","sql","c","cpp","h","hpp","rs","go","java","kt","kts","swift","rb","php","vue","svelte","r","tex","env","gitignore").contains(extension)) return "text/plain";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
    }
    static boolean text(File file) {
        String mime = mime(file);
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("application/javascript") || mime.equals("application/xml");
    }
    static JSONObject list(File root, String path) throws IOException, JSONException {
        File directory = resolve(root, path);
        if (!directory.isDirectory()) throw new IOException("not_directory");
        File[] children = directory.listFiles();
        if (children == null) throw new IOException("unreadable_directory");
        Arrays.sort(children, Comparator.comparing((File f) -> !f.isDirectory()).thenComparing(File::getName, String.CASE_INSENSITIVE_ORDER));
        JSONArray entries = new JSONArray();
        for (File child : children) {
            if (Files.isSymbolicLink(child.toPath())) continue;
            try {
                File file = resolve(root, child.getPath());
                if (!file.isFile() && !file.isDirectory()) continue;
                entries.put(new JSONObject().put("name", file.getName()).put("path", relative(root, file))
                    .put("directory", file.isDirectory()).put("size", file.isDirectory() ? 0 : file.length()));
            } catch (IOException ignored) { }
        }
        return new JSONObject().put("path", relative(root, directory)).put("entries", entries);
    }
    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536]; int count;
        while ((count = in.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            out.write(buffer, 0, count);
        }
    }
    static void zip(File root, File directory, File destination) throws IOException {
        try (ZipOutputStream out = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(destination)))) {
            zipChildren(root, directory, directory, out);
        }
    }
    private static void zipChildren(File root, File base, File directory, ZipOutputStream out) throws IOException {
        File[] children = directory.listFiles();
        if (children == null) throw new IOException("unreadable_directory");
        Arrays.sort(children, Comparator.comparing(File::getName));
        for (File child : children) {
            if (Files.isSymbolicLink(child.toPath())) continue;
            File file;
            try { file = resolve(root, child.getPath()); } catch (IOException ignored) { continue; }
            String name = base.toPath().relativize(file.toPath()).toString();
            if (file.isDirectory()) {
                out.putNextEntry(new ZipEntry(name + "/")); out.closeEntry();
                zipChildren(root, base, file, out);
            } else if (file.isFile()) {
                out.putNextEntry(new ZipEntry(name));
                try (InputStream in = new FileInputStream(file)) { copy(in, out); }
                out.closeEntry();
            }
        }
    }
}
