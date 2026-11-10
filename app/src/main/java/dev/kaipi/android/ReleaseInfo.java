package dev.kaipi.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.math.BigInteger;

/** Public Android release metadata, independent of model/core configuration. */
final class ReleaseInfo {
    static final String REPOSITORY = "jingchaoqi/kaipi-android";
    final String version, name, url, digest;
    final long assetId, size;

    private ReleaseInfo(String version, JSONObject asset) {
        this.version = version;
        assetId = asset.optLong("id"); size = asset.optLong("size");
        name = asset.optString("name"); url = asset.optString("browser_download_url");
        String hash = asset.optString("digest", "");
        digest = "null".equals(hash) ? "" : hash;
        URI uri = URI.create(url);
        if (assetId <= 0 || size <= 0 || size > 512L * 1024 * 1024
                || !"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost())
                || uri.getUserInfo() != null || uri.getPort() != -1
                || !uri.getPath().startsWith("/" + REPOSITORY + "/releases/download/")
                || (!digest.isEmpty() && !digest.matches("sha256:[0-9a-f]{64}")))
            throw new IllegalArgumentException("invalid_release");
    }
    static ReleaseInfo parse(JSONObject data) {
        if (data.optBoolean("draft") || data.optBoolean("prerelease")) throw new IllegalArgumentException("invalid_release");
        String version = data.optString("tag_name").replaceFirst("^[vV]", "");
        compareVersions(version, version);
        JSONArray assets = data.optJSONArray("assets");
        JSONObject candidate = null;
        if (assets != null) for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset == null || !asset.optString("name").endsWith(".apk")) continue;
            if (candidate != null) throw new IllegalArgumentException("ambiguous_apk");
            candidate = asset;
        }
        if (candidate == null) throw new IllegalArgumentException("missing_apk");
        return new ReleaseInfo(version, candidate);
    }
    static int compareVersions(String left, String right) {
        String[] a = components(left), b = components(right);
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int difference = new BigInteger(i < a.length ? a[i] : "0").compareTo(new BigInteger(i < b.length ? b[i] : "0"));
            if (difference != 0) return difference;
        }
        return 0;
    }
    private static String[] components(String version) {
        String value = version.replaceFirst("^[vV]", "");
        if (!value.matches("[0-9]+(?:\\.[0-9]+){0,3}")) throw new IllegalArgumentException("invalid_version");
        return value.split("\\.");
    }
    String cacheKey() { return "apk-" + assetId + "-" + size + "-" + digest; }
    String downloadName() { return "kaipi-android-" + version + "-" + assetId + ".apk"; }
}
