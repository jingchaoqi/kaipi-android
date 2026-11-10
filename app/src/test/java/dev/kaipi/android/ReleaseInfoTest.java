package dev.kaipi.android;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReleaseInfoTest {
    static JSONObject asset(long id) throws Exception {
        return new JSONObject().put("id", id).put("name", "kaipi-android-0.3.0.apk").put("size", 42)
                .put("browser_download_url", "https://github.com/jingchaoqi/kaipi-android/releases/download/v0.3.0/kaipi-android-0.3.0.apk");
    }
    static JSONObject release(JSONObject asset) throws Exception {
        return new JSONObject().put("tag_name", "v0.3.0").put("assets", new JSONArray().put(asset));
    }
    @Test public void compareUsesNumericVersionComponents() {
        assertTrue(ReleaseInfo.compareVersions("v0.10.0", "0.9.9") > 0);
        assertEquals(0, ReleaseInfo.compareVersions("v0.2.0", "0.2"));
        assertTrue(ReleaseInfo.compareVersions("0.2.0", "0.2.1") < 0);
    }
    @Test public void sourcesAndChecksumsAreNotMistakenForTheApk() throws Exception {
        JSONObject data = release(asset(7));
        data.getJSONArray("assets").put(new JSONObject().put("name", "git.tar.xz"));
        data.getJSONArray("assets").put(new JSONObject().put("name", "SHA256SUMS"));
        ReleaseInfo info = ReleaseInfo.parse(data);
        assertEquals(7, info.assetId); assertEquals("0.3.0", info.version);
        assertEquals(info.cacheKey(), ReleaseInfo.parse(data).cacheKey());
        assertNotEquals(info.cacheKey(), ReleaseInfo.parse(release(asset(8))).cacheKey());
    }
    @Test public void missingOrAmbiguousApksAndUntrustedLocationsAreRejected() throws Exception {
        JSONObject data = release(asset(7));
        data.getJSONArray("assets").put(asset(8));
        assertThrows(IllegalArgumentException.class, () -> ReleaseInfo.parse(data));
        assertThrows(IllegalArgumentException.class, () -> ReleaseInfo.parse(release(asset(7).put("name", "notes.txt"))));
        assertThrows(IllegalArgumentException.class, () -> ReleaseInfo.parse(release(asset(7).put("browser_download_url", "https://example.com/app.apk"))));
        assertThrows(IllegalArgumentException.class, () -> ReleaseInfo.parse(release(asset(7).put("digest", "sha256:invalid"))));
    }
}
